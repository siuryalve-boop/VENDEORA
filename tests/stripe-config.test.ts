import assert from "node:assert/strict";
import { test } from "node:test";
import { stripeConfig } from "../lib/stripe.ts";

const base = {
  STRIPE_SECRET_KEY: "rk_test_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  SUPABASE_SERVICE_ROLE_KEY: "test fixture",
};

test("identifies the first missing payment setting without activating live payments", () => {
  assert.equal(stripeConfig({}).issue, "missing_key");
  assert.equal(stripeConfig({ ...base, STRIPE_SECRET_KEY: "rk_live_fixture" }).issue, "key_mode");
  assert.equal(stripeConfig({ ...base, STRIPE_WEBHOOK_SECRET: "fixture" }).issue, "webhook");
  assert.equal(stripeConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" }).issue, "database_credentials");
  assert.equal(stripeConfig(base).enabled, true);
  assert.equal(stripeConfig(base).mode, "test");
});
