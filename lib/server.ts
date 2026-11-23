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
    if (route === "GET /api/oferta")
      return send({
        offer: await getOffer(requiredId(url.searchParams.get("id"))),
        testPayments:
          env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
          Boolean(env.STRIPE_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY),
      });

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
      if (
        title.length < 3 ||
        title.length > 120 ||
        description.length > 3000 ||
        !productTypes.includes(category) ||
        !Number.isInteger(price_cents) ||
        price_cents < 500 ||
        price_cents > 10000000
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
          select: "id,product_id,affiliate_id,status,created_at",
          order: "created_at.desc",
          limit: "250",
        }),
      );
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
          select: "id,product_id,title,content,created_at",
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
      const [saved] = await write<Json[]>(
        "lessons",
        id
          ? { title, content }
          : { title, content, product_id: requiredId(body.product_id) },
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
              amount_cents: offer.price_cents,
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
