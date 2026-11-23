import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi } from "../lib/server.ts";

const base = "https://local.test";
const env = {
  SITE_URL: base,
  SUPABASE_URL: "https://db.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "test-key",
};

test("matches the browser loopback host when Next.js rewrites the request URL to localhost", async () => {
  const local = (host: string, origin: string, forwardedHost?: string) =>
    new Request("http://localhost:4177/api/auth/cadastro", {
      method: "POST",
      headers: {
        host,
        origin,
        "content-type": "application/json",
        ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
      },
      body: "{}",
    });

  const valid = await handleApi(
    local("127.0.0.1:4177", "http://127.0.0.1:4177"),
    {},
  );
  assert.equal(valid.status, 400);
  assert.match((await valid.json()).error, /nome completo/);

  const crossOrigin = await handleApi(
    local("127.0.0.1:4177", "http://localhost:4177"),
    {},
  );
  assert.equal(crossOrigin.status, 403);

  const forwarded = await handleApi(
    local("127.0.0.1:4177", "http://example.invalid", "example.invalid"),
    {},
  );
  assert.equal(forwarded.status, 403);

  const configured = await handleApi(
    local("127.0.0.1:4177", "http://127.0.0.1:4177"),
    env,
  );
  assert.equal(configured.status, 403);
});
const registration = {
  name: "Pessoa Teste",
  cpf: "12345678909",
  birth: "1990-01-01",
  email: "test@example.invalid",
  phone: "11912345678",
  password: "Senha de teste",
  confirm: "Senha de teste",
  role: "producer",
  terms: true,
  privacy: true,
};
const post = (path: string, body: unknown, origin = base) =>
  new Request(base + path, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("authenticates same-origin requests and rejects invalid signups before contacting Supabase", async () => {
  for (const data of [
    { ...registration, birth: "2020-01-01" },
    { ...registration, cpf: "12345678900" },
    { ...registration, role: "admin" },
    { ...registration, terms: false },
  ]) {
    const result = await handleApi(post("/api/auth/cadastro", data), env);
    assert.equal(result.status, 400);
  }
  assert.equal(
    (
      await handleApi(
        post("/api/auth/cadastro", registration, "https://other.invalid"),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handleApi(new Request(base + "/api/produtos"), env)).status,
    401,
  );
});

test("delegates signup and login to Supabase and only sets HTTP-only session cookies for active confirmed profiles", async (context) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const user = {
    id,
    email: registration.email,
    email_confirmed_at: "2026-11-22T00:00:00Z",
  };
  const tokens = {
    user,
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_in: 3600,
  };
  const mock = context.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(input));
      if (endpoint.pathname.endsWith("signup")) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.data.cpf, registration.cpf);
        assert.equal(body.data.terms_version, "2026-11-22");
        return Response.json({ user });
      }
      if (endpoint.pathname.endsWith("token")) return Response.json(tokens);
      if (endpoint.pathname.endsWith("profiles")) {
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Bearer test-access",
        );
        return Response.json([{ id, active: true }]);
      }
      return Response.json({}, { status: 404 });
    },
  );
  const signup = await handleApi(post("/api/auth/cadastro", registration), env);
  assert.equal(signup.status, 201);
  assert.equal(signup.headers.get("set-cookie"), null);
  const login = await handleApi(
    post("/api/auth/entrar", {
      email: registration.email,
      password: registration.password,
      remember: true,
    }),
    env,
  );
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie();
  assert.equal(cookies.length, 3);
  assert.ok(
    cookies.every((cookie) => /HttpOnly; SameSite=Lax; Secure/.test(cookie)),
  );
  assert.ok(cookies.some((cookie) => cookie.includes("Max-Age=2592000")));
  assert.equal(mock.mock.callCount(), 3);
});

test("rejects the unsigned payment webhook and rejects invalid email confirmation tokens", async () => {
  assert.equal(
    (
      await handleApi(post("/api/stripe/webhook", {}), {
        ...env,
        STRIPE_WEBHOOK_SECRET: "test-secret",
      })
    ).status,
    400,
  );
  const response = await handleApi(
    new Request(base + "/api/auth/confirm?token_hash=invalid&type=email"),
    env,
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    base + "/entrar?status=invalid",
  );
});
