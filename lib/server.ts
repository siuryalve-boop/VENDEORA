import {
  digits,
  registrationErrors,
  termsVersion,
  validEmail,
  validPassword,
  type Registration,
} from "./identity.ts";

export type Environment = Record<string, string | undefined>;
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
type User = { id: string; email: string; email_confirmed_at?: string };
type Profile = {
  id: string;
  name: string;
  role: "producer" | "affiliate" | "student" | "admin";
  active: boolean;
};
type Session = { access: string; user: User; profile: Profile };
type Offer = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
};
type Order = { id: string; status: string; amount_cents: number };
type Json = Record<string, unknown>;

class Problem extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class SupabaseError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Supabase request failed");
    this.status = status;
    this.code = code;
  }
}

const cookieKeys = {
  access: "vendeora_access",
  refresh: "vendeora_refresh",
  remember: "vendeora_remember",
};
const orderFields =
  "id,product_id,seller_id,buyer_id,amount_cents,currency,status,created_at,paid_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const productTypes = [
  "Curso online",
  "E-book",
  "PDF",
  "Mentoria",
  "Consultoria",
  "Assinatura",
  "Comunidade",
  "Outros",
];

function cookieValue(request: Request, name: string) {
  return (
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(name + "="))
      ?.slice(name.length + 1) ?? ""
  );
}

function storeSession(
  headers: Headers,
  secure: boolean,
  tokens: Tokens | null,
  remember = false,
) {
  const flags = `; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  for (const [kind, key] of Object.entries(cookieKeys)) {
    const value = tokens
      ? {
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          remember: remember ? "1" : "0",
        }[kind]
      : "";
    const lifetime = tokens
      ? remember
        ? kind === "access"
          ? `; Max-Age=${tokens.expires_in}`
          : "; Max-Age=2592000"
        : ""
      : "; Max-Age=0";
    headers.append("Set-Cookie", `${key}=${value}${flags}${lifetime}`);
  }
}

async function bodyFrom(request: Request): Promise<Json> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new Problem(415, "Envie dados em JSON.");
  const raw = await request.text();
  if (raw.length > 24000)
    throw new Problem(413, "Os dados enviados são muito grandes.");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new Problem(400, "Os dados enviados são inválidos.");
  }
}

function client(env: Environment) {
  const origin = env.SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  return async <T>(
    path: string,
    init: RequestInit = {},
    token?: string,
    elevated = false,
  ): Promise<T> => {
    const apiKey = elevated ? env.SUPABASE_SERVICE_ROLE_KEY : key;
    if (!origin || !apiKey)
      throw new Problem(503, "O banco de dados ainda está sendo configurado.");
    const headers = new Headers(init.headers);
    headers.set("apikey", apiKey);
    if (token || (elevated && apiKey.startsWith("ey")))
      headers.set("Authorization", `Bearer ${token || apiKey}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(origin + path, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "error",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new SupabaseError(
        response.status,
        data?.error_code ?? data?.code ?? "",
      );
    return data as T;
  };
}

function jsonBody(
  value: unknown,
  method = "POST",
  representation = false,
): RequestInit {
  return {
    method,
    body: JSON.stringify(value),
    headers: representation ? { Prefer: "return=representation" } : {},
  };
}

const rows = (table: string, query: Record<string, string> = {}) =>
  `/rest/v1/${table}?${new URLSearchParams(query)}`;
const rpc = (fn: string) => `/rest/v1/rpc/${fn}`;

function requiredId(value: unknown) {
  const id = text(value);
  if (!uuid.test(id)) throw new Problem(400, "Identificador inválido.");
  return id;
}

function requireRole(session: Session, role: Profile["role"]) {
  if (session.profile.role !== role)
    throw new Problem(403, "Seu perfil não tem acesso a esta ação.");
}

async function signedStripeEvent(request: Request, secret: string) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const timestamp = signature.match(/(?:^|,)t=(\d+)(?:,|$)/)?.[1];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    throw new Problem(400, "Assinatura inválida.");
  const candidates = [
    ...signature.matchAll(/(?:^|,)v1=([a-f0-9]{64})(?=,|$)/g),
  ].map((match) => match[1]);
  const bytes = new TextEncoder();
  const raw = await request.text();
  if (raw.length > 262144) throw new Problem(413, "Evento muito grande.");
  const key = await crypto.subtle.importKey(
    "raw",
    bytes.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  for (const candidate of candidates) {
    const mac = Uint8Array.from(candidate.match(/../g) ?? [], (part) =>
      parseInt(part, 16),
    );
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        mac,
        bytes.encode(`${timestamp}.${raw}`),
      )
    )
      return JSON.parse(raw);
  }
  throw new Problem(400, "Assinatura inválida.");
}

export async function handleApi(request: Request, env: Environment) {
  const url = new URL(request.url);
  const origin = env.SITE_URL ? new URL(env.SITE_URL).origin : url.origin;
  const secure = origin.startsWith("https:");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  const send = (value: unknown, status = 200) =>
    Response.json(value, { headers, status });
  const go = (path: string) => {
    headers.set("Location", origin + path);
    return new Response(null, { status: 303, headers });
  };
  const sb = client(env);
  const auth = <T>(action: string, init?: RequestInit, token?: string) =>
    sb<T>(`/auth/v1/${action}`, init, token);

  async function session(): Promise<Session | null> {
    let access = cookieValue(request, cookieKeys.access);
    const refresh = cookieValue(request, cookieKeys.refresh);
    let user: User | null = null;
    if (access) {
      user = await auth<User>("user", {}, access).catch((error: unknown) => {
        if (error instanceof SupabaseError && [401, 403].includes(error.status))
          return null;
        throw error;
      });
    }
    if (!user && refresh) {
      try {
        const tokens = await auth<Tokens & { user: User }>(
          "token?grant_type=refresh_token",
          jsonBody({ refresh_token: refresh }),
        );
        access = tokens.access_token;
        user = tokens.user;
        storeSession(
          headers,
          secure,
          tokens,
          cookieValue(request, cookieKeys.remember) === "1",
        );
      } catch (error) {
        if (!(error instanceof SupabaseError) || error.status >= 429)
          throw error;
        storeSession(headers, secure, null);
      }
    }
    if (!user?.email_confirmed_at) return null;
    const [profile] = await sb<Profile[]>(
      rows("profiles", { id: `eq.${user.id}`, select: "id,name,role,active" }),
      {},
      access,
    );
    return profile?.active ? { access, user, profile } : null;
  }

  async function signedIn() {
    const current = await session();
    if (!current)
      throw new Problem(401, "Entre com uma conta confirmada para continuar.");
    return current;
  }

  async function getOffer(product: string) {
    const [offer] = await sb<Offer[]>(
      rpc("vendeora_offer"),
      jsonBody({ product }),
    );
    if (!offer) throw new Problem(404, "Produto indisponível.");
    return offer;
  }

  try {
    const route = `${request.method} ${url.pathname}`;
    if (route === "POST /api/stripe/webhook") {
      if (!env.STRIPE_WEBHOOK_SECRET)
        throw new Problem(503, "Gateway indisponível.");
      const event = await signedStripeEvent(request, env.STRIPE_WEBHOOK_SECRET);
      const result: Record<string, string> = {
        "checkout.session.completed": "paid",
        "checkout.session.async_payment_succeeded": "paid",
        "checkout.session.async_payment_failed": "failed",
        "checkout.session.expired": "expired",
      };
      const status = result[event.type];
      if (!status || event.livemode !== false) return send({ received: true });
      const payment = event.data.object;
      if (status === "paid" && payment.payment_status !== "paid")
        return send({ received: true });
      if (!uuid.test(text(payment.metadata?.order_id)))
        return send({ received: true });
      const processed = await sb<boolean>(
        rpc("vendeora_payment_event"),
        jsonBody({
          event_id: event.id,
          session_id: payment.id,
          order_id: payment.metadata.order_id,
          next_status: status,
          amount: payment.amount_total,
          payment_currency: payment.currency,
        }),
        undefined,
        true,
      );
      if (!processed)
        throw new Problem(409, "O pedido ainda não pôde ser conciliado.");
      return send({ received: true });
    }

    if (request.method !== "GET" && request.headers.get("origin") !== origin)
      throw new Problem(403, "Origem da solicitação inválida.");

    if (route === "GET /api/health") {
      await sb(
        rpc("vendeora_offer"),
        jsonBody({ product: "00000000-0000-0000-0000-000000000000" }),
      );
      return send({ ok: true, database: "connected" });
    }
    if (route === "GET /api/auth/session") {
      const current = await session();
      return send({
        profile: current?.profile ?? null,
        email: current?.user.email ?? null,
      });
    }
    if (route === "GET /api/auth/confirm") {
      const token_hash = url.searchParams.get("token_hash") ?? "";
      const type = url.searchParams.get("type");
      if (
        !/^[a-zA-Z0-9_-]{18,180}$/.test(token_hash) ||
        !type ||
        !["email", "signup", "recovery"].includes(type)
      )
        return go("/entrar?status=invalid");
      try {
        const tokens = await auth<Tokens>(
          "verify",
          jsonBody({ token_hash, type }),
        );
        storeSession(headers, secure, tokens);
        return go(
          type === "recovery" ? "/nova-senha" : "/dashboard?status=confirmed",
        );
      } catch {
        return go("/entrar?status=invalid");
      }
    }
    if (route === "POST /api/auth/entrar") {
      const body = await bodyFrom(request);
      const email = text(body.email).trim().toLowerCase();
      const password = text(body.password);
      if (!validEmail(email) || !password || password.length > 72)
        throw new Problem(400, "Confira seu e-mail e sua senha.");
      const captcha = text(body.captcha);
      if (env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captcha)
        throw new Problem(400, "Conclua a verificação de segurança.");
      const data = await auth<Tokens & { user: User }>(
        "token?grant_type=password",
        jsonBody({
          email,
          password,
          gotrue_meta_security: { captcha_token: captcha || undefined },
        }),
      );
      const [profile] = await sb<Profile[]>(
        rows("profiles", { id: `eq.${data.user.id}`, select: "id,active" }),
        {},
        data.access_token,
      );
      if (!data.user.email_confirmed_at || !profile?.active) {
        await auth(
          "logout?scope=local",
          { method: "POST" },
          data.access_token,
        ).catch(() => null);
        throw new Problem(403, "A conta ainda não tem acesso à plataforma.");
      }
      storeSession(headers, secure, data, body.remember === true);
      return send({ ok: true });
    }
    if (route === "POST /api/auth/cadastro") {
      const input = await bodyFrom(request);
      const data: Registration = {
        name: text(input.name),
        cpf: text(input.cpf),
        birth: text(input.birth),
        email: text(input.email),
        phone: text(input.phone),
        password: text(input.password),
        confirm: text(input.confirm),
        role: text(input.role),
      };
      const error = Object.values(registrationErrors(data)).find(Boolean);
      if (error) throw new Problem(400, error);
      if (input.terms !== true || input.privacy !== true)
        throw new Problem(
          400,
          "Confirme os termos e a política de privacidade.",
        );
      const captcha = text(input.captcha);
      if (env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captcha)
        throw new Problem(400, "Conclua a verificação de segurança.");
      const result = await auth<Partial<Tokens>>(
        "signup",
        jsonBody({
          email: data.email.trim().toLowerCase(),
          password: data.password,
          data: {
            name: data.name.trim(),
            cpf: digits(data.cpf),
            birth: data.birth,
            phone: digits(data.phone).replace(/^55(?=\d{10,11}$)/, ""),
            account_role: data.role,
            terms_version: termsVersion,
          },
          gotrue_meta_security: { captcha_token: captcha || undefined },
        }),
      );
      if (result.access_token) {
        await auth("logout", { method: "POST" }, result.access_token).catch(
          () => null,
        );
        throw new Problem(
          503,
          "A confirmação de e-mail precisa ser habilitada pelo operador da plataforma.",
        );
      }
      return send({ ok: true }, 201);
    }
    if (route === "POST /api/auth/recuperar") {
      const body = await bodyFrom(request);
      const email = text(body.email).trim().toLowerCase();
      if (!validEmail(email))
        throw new Problem(400, "Informe um e-mail válido.");
      const captcha = text(body.captcha);
      if (env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captcha)
        throw new Problem(400, "Conclua a verificação de segurança.");
      await auth(
        "recover",
        jsonBody({
          email,
          gotrue_meta_security: { captcha_token: captcha || undefined },
        }),
      );
      return send({ ok: true });
    }
    if (route === "POST /api/auth/sair") {
      const current = await session();
      if (current)
        await auth("logout?scope=local", { method: "POST" }, current.access);
      storeSession(headers, secure, null);
      return send({ ok: true });
    }
    if (route === "GET /api/oferta") {
      const id = requiredId(url.searchParams.get("id"));
      const [offer, styles] = await Promise.all([
        getOffer(id),
        sb<Json[]>(rpc("vendeora_checkout_style"), jsonBody({ product: id })),
      ]);
      return send({
        offer,
        style: styles[0] ?? null,
        testPayments:
          env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
          Boolean(env.STRIPE_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY),
      });
    }

    if (route === "POST /api/checkout/referral") {
      const body = await bodyFrom(request);
      const recorded = await sb<boolean>(
        rpc("vendeora_referral_click"),
        jsonBody({
          product: requiredId(body.product_id),
          referral: requiredId(body.referral),
        }),
      );
      return send({ recorded });
    }

    const current = await signedIn();
    const { access, user, profile } = current;
    const read = <T>(table: string, params?: Record<string, string>) =>
      sb<T>(rows(table, params), {}, access);
    const write = <T>(
      table: string,
      values: unknown,
      query?: Record<string, string>,
      method = "POST",
    ) => sb<T>(rows(table, query), jsonBody(values, method, true), access);
    const call = <T>(name: string, values: unknown) =>
      sb<T>(rpc(name), jsonBody(values), access);
    async function quote(product: string, code: unknown) {
      const normalized = text(code).trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,32}$/.test(normalized))
        throw new Problem(400, "Informe um código de cupom válido.");
      const [discount] = await call<
        { coupon_id: string; amount_cents: number }[]
      >("vendeora_checkout_quote", { product, requested_code: normalized });
      if (!discount)
        throw new Problem(
          404,
          "Este cupom não está disponível para o produto.",
        );
      return discount;
    }
    if (route === "GET /api/checkout/config") {
      requireRole(current, "producer");
      const id = requiredId(url.searchParams.get("id"));
      const [styles, coupons] = await Promise.all([
        read<Json[]>("checkouts", {
          product_id: `eq.${id}`,
          select: "headline,accent",
        }),
        read<Json[]>("coupons", {
          product_id: `eq.${id}`,
          select: "id,code,percent,active",
          order: "created_at.desc",
          limit: "100",
        }),
      ]);
      return send({ style: styles[0] ?? null, coupons });
    }
    if (route === "POST /api/checkout/config") {
      requireRole(current, "producer");
      const body = await bodyFrom(request);
      const headline = text(body.headline).trim();
      const accent = text(body.accent);
      if (headline.length > 140 || !/^#[0-9a-f]{6}$/i.test(accent))
        throw new Problem(400, "Confira o texto e a cor do checkout.");
      await call("vendeora_save_checkout", {
        product: requiredId(body.product_id),
        new_headline: headline,
        new_accent: accent,
      });
      return send({ ok: true });
    }
    if (route === "POST /api/cupons") {
      requireRole(current, "producer");
      const body = await bodyFrom(request);
      if (body.id) {
        if (typeof body.active !== "boolean")
          throw new Problem(400, "Status de cupom inválido.");
        const [updated] = await write<Json[]>(
          "coupons",
          { active: body.active },
          { id: `eq.${requiredId(body.id)}` },
          "PATCH",
        );
        if (!updated) throw new Problem(404, "Cupom não encontrado.");
        return send(updated);
      }
      const code = text(body.code).trim().toUpperCase();
      const percent = Number(body.percent);
      if (
        !/^[A-Z0-9-]{3,32}$/.test(code) ||
        !Number.isInteger(percent) ||
        percent < 1 ||
        percent > 90
      )
        throw new Problem(
          400,
          "Use um código alfanumérico e um desconto entre 1% e 90%.",
        );
      return send(
        await write("coupons", {
          product_id: requiredId(body.product_id),
          code,
          percent,
        }),
        201,
      );
    }
    if (route === "POST /api/checkout/cotacao") {
      const body = await bodyFrom(request);
      const offer = await getOffer(requiredId(body.product_id));
      const discount = await quote(offer.id, body.code);
      return send({ amount_cents: discount.amount_cents });
    }

    if (route === "GET /api/clientes") {
      requireRole(current, "producer");
      const customerId = url.searchParams.get("id");
      const customers = await call<Json[]>("vendeora_customers", {
        customer: customerId ? requiredId(customerId) : null,
      });
      if (!customerId) return send(customers);
      if (!customers[0]) throw new Problem(404, "Cliente não encontrado.");
      const orders = await read("orders", {
        select: orderFields,
        seller_id: `eq.${user.id}`,
        buyer_id: `eq.${customerId}`,
        order: "created_at.desc",
        limit: "100",
      });
      return send({ customer: customers[0], orders });
    }
    if (route === "GET /api/relatorios") {
      requireRole(current, "producer");
      const from = url.searchParams.get("de") ?? "";
      const to = url.searchParams.get("ate") ?? "";
      const calendarDay = (value: string) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return (
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(+date) &&
          date.toISOString().slice(0, 10) === value
        );
      };
      if (
        !calendarDay(from) ||
        !calendarDay(to) ||
        from > to ||
        (Date.parse(to) - Date.parse(from)) / 86400000 > 365
      )
        throw new Problem(400, "Informe um período válido de até 366 dias.");
      return send(
        await call("vendeora_sales_report", {
          from_day: from,
          through_day: to,
        }),
      );
    }
    if (route === "GET /api/notificacoes") {
      const onlyUnread = url.searchParams.get("filtro") === "nao-lidas";
      return send(
        await read("notifications", {
          select: "id,event,target_id,read_at,created_at",
          order: "created_at.desc",
          limit: "100",
          ...(onlyUnread ? { read_at: "is.null" } : {}),
        }),
      );
    }
    if (route === "POST /api/notificacoes") {
      const body = await bodyFrom(request);
      const id = requiredId(body.id);
      const [updated] = await write<Json[]>(
        "notifications",
        { read_at: new Date().toISOString() },
        { id: `eq.${id}` },
        "PATCH",
      );
      if (!updated) throw new Problem(404, "Notificação indisponível.");
      return send(updated);
    }
    if (route === "GET /api/suporte") {
      const team =
        profile.role === "admin" && url.searchParams.get("view") === "equipe";
      return send(
        await read("support_tickets", {
          select: "*",
          order: "created_at.desc",
          limit: "100",
          ...(team ? {} : { user_id: `eq.${user.id}` }),
        }),
      );
    }
    if (route === "POST /api/suporte") {
      const body = await bodyFrom(request);
      if (body.id) {
        requireRole(current, "admin");
        const reply = text(body.response).trim();
        if (reply.length < 5 || reply.length > 5000)
          throw new Problem(
            400,
            "Escreva uma resposta de 5 a 5.000 caracteres.",
          );
        const answered = await call<boolean>("vendeora_answer_ticket", {
          ticket: requiredId(body.id),
          reply,
          close_ticket: body.close === true,
        });
        if (!answered)
          throw new Problem(404, "Chamado indisponível ou encerrado.");
        return send({ ok: true });
      }
      const subject = text(body.subject).trim();
      const message = text(body.message).trim();
      if (
        subject.length < 5 ||
        subject.length > 120 ||
        message.length < 10 ||
        message.length > 5000
      )
        throw new Problem(
          400,
          "Confira o assunto e a mensagem antes de enviar.",
        );
      return send(await write("support_tickets", { subject, message }), 201);
    }
    if (route === "GET /api/modulos") {
      return send(
        await read("course_modules", {
          select: "id,product_id,title,position",
          order: "position.asc,created_at.asc",
          limit: "500",
        }),
      );
    }
    if (route === "POST /api/modulos") {
      requireRole(current, "producer");
      const body = await bodyFrom(request);
      const id = body.id ? requiredId(body.id) : null;
      if (id && body.remove === true) {
        await sb(
          rows("course_modules", { id: `eq.${id}` }),
          { method: "DELETE" },
          access,
        );
        return send({ ok: true });
      }
      const title = text(body.title).trim();
      const position = Number(body.position ?? 1);
      if (
        title.length < 3 ||
        title.length > 150 ||
        !Number.isInteger(position) ||
        position < 1 ||
        position > 200
      )
        throw new Problem(
          400,
          "Informe o nome do módulo e uma posição entre 1 e 200.",
        );
      const [saved] = await write<Json[]>(
        "course_modules",
        id
          ? { title, position }
          : { title, position, product_id: requiredId(body.product_id) },
        id ? { id: `eq.${id}` } : {},
        id ? "PATCH" : "POST",
      );
      if (!saved) throw new Problem(404, "Módulo não encontrado.");
      return send(saved, id ? 200 : 201);
    }
    if (route === "GET /api/auth/mfa") {
      const account = await auth<
        User & {
          factors?: { id: string; factor_type: string; status: string }[];
        }
      >("user", {}, access);
      const claims =
        access.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
      let verified = false;
      try {
        verified = JSON.parse(atob(claims)).aal === "aal2";
      } catch {
        /* Access was authenticated upstream. */
      }
      return send({
        verified,
        factor:
          account.factors?.find(
            (factor) =>
              factor.factor_type === "totp" && factor.status === "verified",
          )?.id ?? null,
      });
    }
    if (route === "POST /api/auth/mfa") {
      const body = await bodyFrom(request);
      if (body.action === "enroll") {
        const enrolled = await auth<{ id: string; totp: { secret: string } }>(
          "factors",
          jsonBody({ factor_type: "totp", issuer: "VENDEORA" }),
          access,
        );
        return send({ factor: enrolled.id, secret: enrolled.totp.secret });
      }
      const code = text(body.code);
      if (body.action !== "verify" || !/^\d{6}$/.test(code))
        throw new Problem(
          400,
          "Informe o código de seis dígitos do autenticador.",
        );
      const factor = requiredId(body.factor);
      const challenge = await auth<{ id: string }>(
        `factors/${factor}/challenge`,
        jsonBody({}),
        access,
      );
      const tokens = await auth<Tokens>(
        `factors/${factor}/verify`,
        jsonBody({ challenge_id: challenge.id, code }),
        access,
      );
      storeSession(
        headers,
        secure,
        tokens,
        cookieValue(request, cookieKeys.remember) === "1",
      );
      return send({ ok: true });
    }

    if (route === "POST /api/auth/senha") {
      const body = await bodyFrom(request);
      const password = text(body.password);
      if (!validPassword(password) || password !== text(body.confirm))
        throw new Problem(
          400,
          "Confira os requisitos e a confirmação da senha.",
        );
      await auth("user", jsonBody({ password }, "PUT"), access);
      return send({ ok: true });
    }
    if (route === "GET /api/pedidos") {
      const query: Record<string, string> = {
        select: orderFields,
        order: "created_at.desc",
        limit: "500",
      };
      if (profile.role !== "admin")
        query[
          profile.role === "producer" &&
          url.searchParams.get("view") !== "compras"
            ? "seller_id"
            : "buyer_id"
        ] = `eq.${user.id}`;
      return send(await read("orders", query));
    }
    if (route === "GET /api/produtos") {
      const query: Record<string, string> = {
        select: "*",
        archived: "eq.false",
        order: "created_at.desc",
        limit: "250",
      };
      if (profile.role === "producer") query.owner_id = `eq.${user.id}`;
      else if (profile.role === "affiliate") {
        query.active = "eq.true";
        query.affiliates_enabled = "eq.true";
      } else requireRole(current, "admin");
      return send(await read("products", query));
    }
    if (route === "POST /api/produtos") {
      requireRole(current, "producer");
      const body = await bodyFrom(request);
      const id = body.id ? requiredId(body.id) : null;
      if (body.archive === true && id) {
        const [updated] = await write<Offer[]>(
          "products",
          { archived: true, active: false },
          { id: `eq.${id}` },
          "PATCH",
        );
        if (!updated) throw new Problem(404, "Produto não encontrado.");
        return send(updated);
      }
      const title = text(body.title).trim();
      const description = text(body.description).trim();
      const category = text(body.category);
      const price_cents = Number(body.price_cents);
      const commission_percent =
        body.commission_percent === undefined
          ? undefined
          : Number(body.commission_percent);
      if (
        title.length < 3 ||
        title.length > 120 ||
        description.length > 3000 ||
        !productTypes.includes(category) ||
        !Number.isInteger(price_cents) ||
        price_cents < 500 ||
        price_cents > 10000000 ||
        (commission_percent !== undefined &&
          (!Number.isInteger(commission_percent) ||
            commission_percent < 0 ||
            commission_percent > 80))
      )
        throw new Problem(
          400,
          "Confira o título, o tipo e o preço do produto (mínimo de R$ 5,00).",
        );
      const [saved] = await write<Offer[]>(
        "products",
        {
          title,
          description,
          category,
          price_cents,
          commission_percent,
          active: body.active === true,
          affiliates_enabled: body.affiliates_enabled === true,
        },
        id ? { id: `eq.${id}`, archived: "eq.false" } : {},
        id ? "PATCH" : "POST",
      );
      if (!saved) throw new Problem(404, "Produto não encontrado.");
      return send(saved, id ? 200 : 201);
    }
    if (route === "GET /api/afiliacoes")
      return send(
        await read("affiliate_requests", {
          select: "id,product_id,affiliate_id,status,created_at,visits",
          order: "created_at.desc",
          limit: "250",
        }),
      );
    if (route === "GET /api/comissoes") {
      if (profile.role !== "producer" && profile.role !== "affiliate")
        throw new Problem(
          403,
          "Comissões não estão disponíveis para este perfil.",
        );
      return send(
        await read("commissions", {
          select: "order_id,product_id,amount_cents,created_at,status",
          order: "created_at.desc",
          limit: "250",
        }),
      );
    }
    if (route === "POST /api/afiliacoes") {
      const body = await bodyFrom(request);
      if (profile.role === "affiliate")
        return send(
          await write("affiliate_requests", {
            product_id: requiredId(body.product_id),
          }),
          201,
        );
      requireRole(current, "producer");
      if (body.status !== "approved" && body.status !== "declined")
        throw new Problem(400, "Status inválido.");
      const [updated] = await write<Json[]>(
        "affiliate_requests",
        { status: body.status },
        { id: `eq.${requiredId(body.id)}` },
        "PATCH",
      );
      if (!updated) throw new Problem(404, "Solicitação não encontrada.");
      return send(updated);
    }
    if (route === "GET /api/aulas")
      return send(
        await read("lessons", {
          select: "id,product_id,module_id,title,content,created_at",
          order: "created_at.asc",
          limit: "250",
        }),
      );
    if (route === "POST /api/aulas") {
      requireRole(current, "producer");
      const body = await bodyFrom(request);
      const id = body.id ? requiredId(body.id) : null;
      if (id && body.remove === true) {
        await sb(
          rows("lessons", { id: `eq.${id}` }),
          { method: "DELETE" },
          access,
        );
        return send({ ok: true });
      }
      const title = text(body.title).trim();
      const content = text(body.content).trim();
      if (
        title.length < 3 ||
        title.length > 150 ||
        !content ||
        content.length > 16000
      )
        throw new Problem(400, "Confira o título e o conteúdo da aula.");
      const assignment =
        body.module_id === undefined
          ? {}
          : { module_id: body.module_id ? requiredId(body.module_id) : null };
      const [saved] = await write<Json[]>(
        "lessons",
        id
          ? { title, content, ...assignment }
          : {
              title,
              content,
              ...assignment,
              product_id: requiredId(body.product_id),
            },
        id ? { id: `eq.${id}` } : {},
        id ? "PATCH" : "POST",
      );
      if (!saved) throw new Problem(404, "Aula não encontrada.");
      return send(saved, id ? 200 : 201);
    }
    if (route === "GET /api/progresso")
      return send(
        await read("lesson_progress", {
          select: "lesson_id,completed_at",
          limit: "500",
        }),
      );
    if (route === "POST /api/progresso") {
      const body = await bodyFrom(request);
      const lesson = requiredId(body.lesson_id);
      if (body.completed === false)
        await sb(
          rows("lesson_progress", { lesson_id: `eq.${lesson}` }),
          { method: "DELETE" },
          access,
        );
      else await write("lesson_progress", { lesson_id: lesson });
      return send({ ok: true });
    }
    if (route === "POST /api/perfil") {
      const body = await bodyFrom(request);
      const name = text(body.name).trim();
      if (name.length < 3 || name.length > 120)
        throw new Problem(400, "Informe um nome de 3 a 120 caracteres.");
      const [saved] = await write<Profile[]>(
        "profiles",
        { name },
        { id: `eq.${user.id}` },
        "PATCH",
      );
      return send(saved);
    }
    if (route === "GET /api/privacidade")
      return send(
        await read("privacy_requests", {
          select: "id,kind,status,created_at",
          order: "created_at.desc",
        }),
      );
    if (route === "POST /api/privacidade") {
      const body = await bodyFrom(request);
      if (!["export", "correction", "deletion"].includes(text(body.kind)))
        throw new Problem(400, "Escolha uma solicitação válida.");
      return send(await write("privacy_requests", { kind: body.kind }), 201);
    }
    if (route === "GET /api/usuarios") {
      requireRole(current, "admin");
      return send(
        await read("profiles", {
          select: "id,name,role,active,created_at",
          order: "created_at.desc",
          limit: "250",
        }),
      );
    }
    if (route === "POST /api/usuarios") {
      requireRole(current, "admin");
      const body = await bodyFrom(request);
      if (typeof body.active !== "boolean")
        throw new Problem(400, "Status de conta inválido.");
      const updated = await call<boolean>("vendeora_change_account", {
        account: requiredId(body.id),
        enable_account: body.active,
      });
      if (!updated)
        throw new Problem(
          404,
          "Essa conta não pode ser alterada neste painel.",
        );
      return send({ ok: true });
    }
    if (route === "GET /api/pedido") {
      const [order] = await read<Order[]>("orders", {
        select: orderFields,
        id: `eq.${requiredId(url.searchParams.get("id"))}`,
      });
      if (!order) throw new Problem(404, "Pedido não encontrado.");
      return send(order);
    }
    if (route === "POST /api/checkout") {
      if (
        !env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
        !env.STRIPE_WEBHOOK_SECRET ||
        !env.SUPABASE_SERVICE_ROLE_KEY
      )
        throw new Problem(
          503,
          "O gateway de testes ainda não foi configurado.",
        );
      const body = await bodyFrom(request);
      const offer = await getOffer(requiredId(body.product_id));
      const [product] = await sb<{ owner_id: string }[]>(
        rows("products", {
          select: "owner_id",
          id: `eq.${offer.id}`,
          active: "eq.true",
          archived: "eq.false",
        }),
        {},
        undefined,
        true,
      );
      if (!product) throw new Problem(404, "Produto indisponível.");
      if (product.owner_id === user.id)
        throw new Problem(
          400,
          "Use uma conta compradora diferente para testar este checkout.",
        );
      const orderId = requiredId(body.attempt_id);
      const discount = text(body.coupon)
        ? await quote(offer.id, body.coupon)
        : null;
      const [referral] = body.referral
        ? await call<{ id: string; commission_percent: number }[]>(
            "vendeora_checkout_referral",
            { product: offer.id, referral: requiredId(body.referral) },
          )
        : [];
      let order: Order & { product_id: string; buyer_id: string };
      try {
        [order] = await sb<(typeof order)[]>(
          rows("orders"),
          jsonBody(
            {
              id: orderId,
              product_id: offer.id,
              seller_id: product.owner_id,
              buyer_id: user.id,
              amount_cents: discount?.amount_cents ?? offer.price_cents,
              applied_coupon_id: discount?.coupon_id ?? null,
              referral_id: referral?.id ?? null,
              commission_percent: referral?.commission_percent ?? 0,
            },
            "POST",
            true,
          ),
          undefined,
          true,
        );
      } catch (error) {
        if (!(error instanceof SupabaseError) || error.code !== "23505")
          throw error;
        [order] = await sb<(typeof order)[]>(
          rows("orders", {
            id: `eq.${orderId}`,
            buyer_id: `eq.${user.id}`,
            product_id: `eq.${offer.id}`,
          }),
          {},
          undefined,
          true,
        );
        if (!order || order.status !== "pending")
          throw new Problem(
            409,
            "Atualize o checkout para iniciar um novo pedido.",
          );
      }
      const paymentForm = new URLSearchParams({
        mode: "payment",
        customer_email: user.email,
        success_url: `${origin}/pedido/${order.id}`,
        cancel_url: `${origin}/checkout/${offer.id}`,
        "payment_method_types[0]": "card",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "brl",
        "line_items[0][price_data][unit_amount]": String(order.amount_cents),
        "line_items[0][price_data][product_data][name]": offer.title,
        "metadata[order_id]": order.id,
      });
      const response = await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",
          body: paymentForm,
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Idempotency-Key": order.id,
          },
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new Problem(
          502,
          "O gateway não abriu o pagamento. Tente novamente.",
        );
      const payment = await response.json();
      if (
        typeof payment.url !== "string" ||
        new URL(payment.url).origin !== "https://checkout.stripe.com"
      )
        throw new Problem(502, "O gateway retornou um endereço inválido.");
      await sb(
        rows("orders", { id: `eq.${order.id}` }),
        jsonBody({ provider_session: payment.id }, "PATCH"),
        undefined,
        true,
      );
      return send({ url: payment.url });
    }
    return send({ error: "Rota não encontrada." }, 404);
  } catch (error) {
    if (error instanceof Problem)
      return send({ error: error.message }, error.status);
    if (error instanceof SupabaseError) {
      if (error.status === 429)
        return send(
          { error: "Muitas tentativas. Aguarde um pouco e tente novamente." },
          429,
        );
      if (error.code === "email_not_confirmed")
        return send({ error: "Confirme seu e-mail antes de entrar." }, 403);
      if (error.code === "invalid_credentials")
        return send({ error: "E-mail ou senha incorretos." }, 401);
      if (error.code === "captcha_failed")
        return send(
          { error: "A verificação de segurança falhou. Tente novamente." },
          400,
        );
      if (
        [
          "23505",
          "user_already_exists",
          "email_exists",
          "unexpected_failure",
        ].includes(error.code) &&
        url.pathname.endsWith("cadastro")
      )
        return send(
          {
            error:
              "Não foi possível concluir o cadastro. Se você já tem uma conta, entre ou recupere sua senha.",
          },
          409,
        );
      if (error.code === "23505")
        return send({ error: "Este registro já existe." }, 409);
      if (error.code === "42501")
        return send({ error: "Permissão insuficiente." }, 403);
      if (error.status === 400 || error.status === 422)
        return send(
          { error: "Confira os dados informados e tente novamente." },
          400,
        );
    }
    return send({ error: "O serviço está temporariamente indisponível." }, 503);
  }
}
