import {
  digits,
  registrationErrors,
  termsVersion,
  validEmail,
  validPassword,
  type Registration,
} from "./identity.ts";
import { digitalPacks, type PackFile } from "./pack-catalog.ts";
import { createPackZip } from "./pack-zip.ts";
import {
  platformFee,
  platformFeePercent,
  stripeClient,
  stripeConfig,
  stripeLink,
  StripeProblem,
  type ConnectedAccount,
  type Payout,
  type StripeBalance,
} from "./stripe.ts";

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
  "id,product_id,seller_id,buyer_id,amount_cents,currency,status,created_at,paid_at,payment_mode,platform_fee_cents";
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

function hasVerifiedAuthenticator(access: string) {
  try {
    const claims = access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(claims)).aal === "aal2";
  } catch {
    return false;
  }
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

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

function getRequestOrigin(request: Request, url: URL, siteUrl?: string) {
  if (siteUrl) return new URL(siteUrl).origin;
  if (url.protocol !== "http:" || !loopbackHosts.includes(url.hostname))
    return url.origin;

  // Next.js can use localhost internally even when the browser visits a loopback IP.
  const host = request.headers.get("host")?.toLowerCase();
  const suffix = url.port ? `:${url.port}` : "";
  const browserHost = loopbackHosts.find(
    (alias) =>
      host === `${alias}${suffix}` || (!suffix && host === `${alias}:80`),
  );
  return browserHost ? `http://${browserHost}${suffix}` : url.origin;
}

export async function handleApi(request: Request, env: Environment) {
  const url = new URL(request.url);
  const origin = getRequestOrigin(request, url, env.SITE_URL);
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
  const stripe = stripeConfig(env);
  const stripeIssue =
    stripe.issue ??
    (stripe.mode === "live" && (!env.SITE_URL || !secure) ? "site_url" : null);
  const manualPayouts = env.VENDEORA_STRIPE_MANUAL_PAYOUTS === "true";
  const provider = stripeClient(stripe.key ?? "");
  const serviceRpc = <T>(name: string, params: Json) =>
    sb<T>(rpc(name), jsonBody(params), undefined, true);
  const databaseMode = () =>
    sb<string>(rpc("vendeora_commerce_mode"), jsonBody({}));
  const binding = (producer: string, account?: string) =>
    serviceRpc<string | null>("vendeora_connect_binding", {
      producer,
      active_mode: stripe.mode,
      new_account: account ?? null,
    });
  const connectIssue = async () =>
    stripeIssue ??
    ((await databaseMode()) === stripe.mode ? null : "database_mode");
  const connectReady = async () => (await connectIssue()) === null;
  const canSell = (account: ConnectedAccount) =>
    account.details_submitted && account.capabilities?.transfers === "active";
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
      const eventMode =
        event.livemode === true
          ? "live"
          : event.livemode === false
            ? "test"
            : null;
      if (!eventMode || stripe.mode !== eventMode)
        return send({ received: true });
      const payment = event.data.object;
      if (
        event.type === "charge.refunded" &&
        uuid.test(text(payment.metadata?.vendeora_order))
      ) {
        const processed = await serviceRpc<boolean>("vendeora_refund_event", {
          event_id: event.id,
          payment_intent: payment.payment_intent,
          original_amount: payment.amount,
          amount_refunded: payment.amount_refunded,
          payment_currency: payment.currency,
          event_mode: eventMode,
        });
        if (!processed)
          throw new Problem(409, "O reembolso ainda não pôde ser conciliado.");
        return send({ received: true });
      }
      const result: Record<string, string> = {
        "checkout.session.completed": "paid",
        "checkout.session.async_payment_succeeded": "paid",
        "checkout.session.async_payment_failed": "failed",
        "checkout.session.expired": "expired",
      };
      const status = result[event.type];
      if (!status) return send({ received: true });
      if (status === "paid" && payment.payment_status !== "paid")
        return send({ received: true });
      if (!uuid.test(text(payment.metadata?.order_id)))
        return send({ received: true });
      const processed = await sb<boolean>(
        rpc("vendeora_payment_event_v2"),
        jsonBody({
          event_id: event.id,
          session_id: payment.id,
          order_id: payment.metadata.order_id,
          next_status: status,
          amount: payment.amount_total,
          payment_currency: payment.currency,
          payment_intent: payment.payment_intent ?? null,
          event_mode: eventMode,
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
        payment: { mode: stripe.mode, enabled: await connectReady() },
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
    if (route === "GET /api/packs") {
      requireRole(current, "producer");
      return send(
        digitalPacks.map(({ files, ...pack }) => ({
          ...pack,
          files: files.map(({ filename }) => filename),
        })),
      );
    }
    if (route === "POST /api/packs") {
      requireRole(current, "producer");
      const body = await bodyFrom(request);
      const pack = digitalPacks.find(({ slug }) => slug === body.slug);
      const price = body.price;
      if (
        !pack ||
        typeof price !== "number" ||
        !Number.isInteger(price) ||
        price < 500 ||
        price > 10000000
      )
        throw new Problem(400, "Escolha um pack e informe um preço válido.");
      try {
        const id = await call<string>("vendeora_create_pack", {
          template_slug: pack.slug,
          template_title: pack.title,
          template_description: pack.description,
          template_price: price,
          materials: pack.files,
        });
        return send({ id }, 201);
      } catch (error) {
        if (error instanceof SupabaseError && error.code === "23505")
          throw new Problem(409, "Este pack já está no seu catálogo.");
        throw error;
      }
    }
    if (route === "GET /api/packs/biblioteca")
      return send(await call("vendeora_pack_library", {}));
    if (route === "GET /api/packs/download") {
      const id = requiredId(url.searchParams.get("id"));
      const [pack] = await call<{ pack_slug: string }[]>(
        "vendeora_pack_library",
        { requested_product: id },
      );
      if (!pack) throw new Problem(404, "Pack indisponível.");
      const files = await read<PackFile[]>("pack_files", {
        product_id: `eq.${id}`,
        select: "filename,content",
        order: "filename",
      });
      if (!files.length) throw new Problem(404, "Pack indisponível.");
      headers.set("Content-Type", "application/zip");
      headers.set(
        "Content-Disposition",
        `attachment; filename="${pack.pack_slug}.zip"`,
      );
      return new Response(createPackZip(files), { headers });
    }
    if (
      route === "GET /api/stripe/conta" ||
      route === "POST /api/stripe/conta" ||
      route === "POST /api/stripe/saques"
    ) {
      requireRole(current, "producer");
      const issue = await connectIssue();
      const enabled = issue === null;
      const status = {
        mode: stripe.mode,
        enabled,
        issue,
        fee: platformFeePercent,
        verified: hasVerifiedAuthenticator(access),
      };
      if (route === "GET /api/stripe/conta") {
        const id = enabled ? await binding(user.id) : null;
        if (!id) return send({ ...status, account: null });
        const account = await provider<ConnectedAccount>(`/v1/accounts/${id}`);
        const money = account.payouts_enabled
          ? await Promise.all([
              provider<StripeBalance>("/v1/balance", { account: id }),
              provider<{ data: Payout[] }>("/v1/payouts?limit=25", {
                account: id,
              }),
            ])
          : null;
        return send({
          ...status,
          account: {
            canSell: canSell(account),
            canPayout: account.payouts_enabled,
            detailsSubmitted: account.details_submitted,
            manual:
              manualPayouts &&
              account.settings?.payouts?.schedule?.interval === "manual",
            available:
              money?.[0].available.find(({ currency }) => currency === "brl")
                ?.amount ?? 0,
            pending:
              money?.[0].pending.find(({ currency }) => currency === "brl")
                ?.amount ?? 0,
            payouts:
              money?.[1].data.filter(({ currency }) => currency === "brl") ??
              [],
          },
        });
      }
      if (!enabled)
        throw new Problem(
          503,
          "O Stripe Connect ainda aguarda configuração pela VENDEORA.",
        );
      let id = await binding(user.id);
      if (route === "POST /api/stripe/conta") {
        if (!id) {
          const account = await provider<ConnectedAccount>("/v1/accounts", {
            form: new URLSearchParams({
              type: "express",
              country: "BR",
              "capabilities[transfers][requested]": "true",
              ...(manualPayouts
                ? { "settings[payouts][schedule][interval]": "manual" }
                : {}),
            }),
            idempotency: `vendeora-account-${stripe.mode}-${user.id}`,
          });
          id = await binding(user.id, account.id);
        }
        if (!id)
          throw new Problem(
            503,
            "O vínculo com a Stripe ainda não está disponível.",
          );
        const onboard = await provider<{ url: string }>("/v1/account_links", {
          form: new URLSearchParams({
            account: id,
            type: "account_onboarding",
            return_url: `${origin}/financeiro`,
            refresh_url: `${origin}/financeiro`,
          }),
        });
        return send({ url: stripeLink(onboard.url, "connect.stripe.com") });
      }
      if (!status.verified)
        throw new Problem(
          403,
          "Confirme o autenticador para solicitar saques.",
        );
      if (!id || !manualPayouts)
        throw new Problem(
          409,
          "Saques pelo painel estão indisponíveis para esta conta.",
        );
      const account = await provider<ConnectedAccount>(`/v1/accounts/${id}`);
      if (
        !account.payouts_enabled ||
        account.settings?.payouts?.schedule?.interval !== "manual"
      )
        throw new Problem(
          409,
          "A Stripe ainda não liberou saques manuais para esta conta.",
        );
      const body = await bodyFrom(request);
      const attempt = requiredId(body.attempt);
      const amount = body.amount;
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 100 ||
        amount > 10000000
      )
        throw new Problem(400, "Informe um valor de saque válido.");
      const params = {
        producer: user.id,
        active_mode: stripe.mode,
        attempt,
        amount,
      };
      type RequestRow = {
        payout_id: string | null;
        original_amount: number;
        started_at: string;
      };
      const [saved] = await serviceRpc<RequestRow[]>(
        "vendeora_payout_request",
        params,
      );
      if (saved.original_amount !== amount)
        throw new Problem(409, "O valor desta solicitação já foi definido.");
      if (saved.payout_id) return send({ id: saved.payout_id });
      if (Date.now() - Date.parse(saved.started_at) > 23 * 60 * 60 * 1000)
        throw new Problem(
          409,
          "Confira o histórico de repasses antes de criar uma nova solicitação.",
        );
      const payout = await provider<Payout>("/v1/payouts", {
        account: id,
        idempotency: `vendeora-payout-${attempt}`,
        form: new URLSearchParams({
          amount: String(amount),
          currency: "brl",
          "metadata[vendeora_request]": attempt,
        }),
      });
      await serviceRpc<RequestRow[]>("vendeora_payout_request", {
        ...params,
        completed_payout: payout.id,
      });
      return send({ id: payout.id }, 201);
    }
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
        limit: url.searchParams.get("view") === "resumo" ? "6" : "500",
      };
      if (profile.role !== "admin")
        query[
          profile.role === "producer" &&
          url.searchParams.get("view") !== "compras"
            ? "seller_id"
            : "buyer_id"
        ] = `eq.${user.id}`;
      const status = url.searchParams.get("status");
      const product = url.searchParams.get("product");
      const id = url.searchParams.get("id");
      if (status) {
        if (
          !["pending", "paid", "failed", "expired", "refunded"].includes(status)
        )
          throw new Problem(400, "Status inválido.");
        query.status = `eq.${status}`;
      }
      if (product) query.product_id = `eq.${requiredId(product)}`;
      if (id) query.id = `eq.${requiredId(id)}`;
      const dateRange: string[] = [];
      for (const [param, operator] of [
        ["from", "gte"],
        ["to", "lt"],
      ]) {
        const day = url.searchParams.get(param);
        if (!day) continue;
        const boundary = new Date(`${day}T03:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          Number.isNaN(+boundary) ||
          boundary.toISOString().slice(0, 10) !== day
        )
          throw new Problem(400, "Data inválida.");
        if (param === "to") boundary.setUTCDate(boundary.getUTCDate() + 1);
        dateRange.push(`created_at.${operator}.${boundary.toISOString()}`);
      }
      if (dateRange.length) query.and = `(${dateRange.join(",")})`;
      return send(await read("orders", query));
    }
    if (route === "GET /api/marketplace") {
      const category = url.searchParams.get("category") ?? "";
      if (category && !productTypes.includes(category))
        throw new Problem(400, "Categoria inválida.");
      return send(
        await call("vendeora_marketplace", {
          search_term: (url.searchParams.get("q") ?? "").trim().slice(0, 120),
          product_category: category,
          ranking:
            url.searchParams.get("ranking") === "recent" ? "recent" : "popular",
        }),
      );
    }
    if (route === "GET /api/vendas/resumo") {
      requireRole(current, "producer");
      const days = Number(url.searchParams.get("days") ?? 30);
      if (![1, 7, 30, 90].includes(days))
        throw new Problem(400, "Período inválido.");
      const [summaries, metrics] = await Promise.all([
        call<Json[]>("vendeora_sales_overview", { period_days: days }),
        call<Json>("vendeora_producer_metrics", { period_days: days }),
      ]);
      return send({ ...summaries[0], ...metrics });
    }
    if (route === "GET /api/produtos") {
      const query: Record<string, string> = {
        select: "*",
        archived: "eq.false",
        order: "created_at.desc",
        limit: "250",
      };
      const id = url.searchParams.get("id");
      if (id) query.id = `eq.${requiredId(id)}`;
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
      if (body.copy === true) {
        const copy = await call<string | null>("vendeora_copy_product", {
          source: requiredId(id),
        });
        if (!copy) throw new Problem(404, "Produto não encontrado.");
        return send({ id: copy }, 201);
      }
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
    if (route === "GET /api/afiliacoes") {
      const product = url.searchParams.get("produto");
      return send(
        await read("affiliate_requests", {
          select: "id,product_id,affiliate_id,status,created_at,visits",
          order: "created_at.desc",
          limit: "250",
          ...(product ? { product_id: `eq.${requiredId(product)}` } : {}),
        }),
      );
    }
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
      if (profile.role === "affiliate") {
        try {
          return send(
            await write("affiliate_requests", {
              product_id: requiredId(body.product_id),
            }),
            201,
          );
        } catch (error) {
          if (error instanceof SupabaseError && error.code === "23505")
            throw new Problem(
              409,
              "Você já solicitou afiliação a este produto.",
            );
          throw error;
        }
      }
      requireRole(current, "producer");
      if (body.status !== "approved" && body.status !== "declined")
        throw new Problem(400, "Status inválido.");
      const [updated] = await write<Json[]>(
        "affiliate_requests",
        { status: body.status },
        { id: `eq.${requiredId(body.id)}`, status: "eq.pending" },
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
      const history = await read("order_history", {
        select: "id,status,occurred_at",
        order_id: `eq.${order.id}`,
        order: "occurred_at.asc,id.asc",
      });
      return send({ ...order, history });
    }
    if (route === "POST /api/checkout") {
      if (!(await connectReady()))
        throw new Problem(
          503,
          "O Stripe Connect ainda aguarda configuração pela VENDEORA.",
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
          "Use uma conta compradora diferente da conta produtora.",
        );
      const destination = await binding(product.owner_id);
      if (
        !destination ||
        !canSell(
          await provider<ConnectedAccount>(`/v1/accounts/${destination}`),
        )
      )
        throw new Problem(
          409,
          "O produtor precisa concluir a configuração de recebimentos.",
        );
      const orderId = requiredId(body.attempt_id);
      const discount = text(body.coupon)
        ? await quote(offer.id, body.coupon)
        : null;
      const [referral] =
        stripe.mode === "test" && body.referral
          ? await call<{ id: string; commission_percent: number }[]>(
              "vendeora_checkout_referral",
              { product: offer.id, referral: requiredId(body.referral) },
            )
          : [];
      const amount = discount?.amount_cents ?? offer.price_cents;
      let order: Order & {
        product_id: string;
        buyer_id: string;
        platform_fee_cents: number;
        provider_destination: string;
        checkout_title: string;
        created_at: string;
      };
      try {
        [order] = await sb<(typeof order)[]>(
          rows("orders"),
          jsonBody(
            {
              id: orderId,
              product_id: offer.id,
              seller_id: product.owner_id,
              buyer_id: user.id,
              amount_cents: amount,
              applied_coupon_id: discount?.coupon_id ?? null,
              referral_id: referral?.id ?? null,
              commission_percent: referral?.commission_percent ?? 0,
              payment_mode: stripe.mode,
              platform_fee_cents: platformFee(amount),
              provider_destination: destination,
              checkout_title: offer.title,
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
            payment_mode: `eq.${stripe.mode}`,
          }),
          {},
          undefined,
          true,
        );
        if (
          !order ||
          order.status !== "pending" ||
          order.provider_destination !== destination ||
          Date.now() - Date.parse(order.created_at) > 23 * 60 * 60 * 1000
        )
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
        "line_items[0][price_data][product_data][name]": order.checkout_title,
        "metadata[order_id]": order.id,
        "payment_intent_data[metadata][vendeora_order]": order.id,
        "payment_intent_data[application_fee_amount]": String(
          order.platform_fee_cents,
        ),
        "payment_intent_data[transfer_data][destination]":
          order.provider_destination,
      });
      const payment = await provider<{ id: string; url: string }>(
        "/v1/checkout/sessions",
        {
          form: paymentForm,
          idempotency: order.id,
        },
      );
      const checkout = stripeLink(payment.url, "checkout.stripe.com");
      await sb(
        rows("orders", { id: `eq.${order.id}` }),
        jsonBody({ provider_session: payment.id }, "PATCH"),
        undefined,
        true,
      );
      return send({ url: checkout });
    }
    return send({ error: "Rota não encontrada." }, 404);
  } catch (error) {
    if (error instanceof Problem || error instanceof StripeProblem)
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
