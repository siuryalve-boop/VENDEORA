export type StripeMode = "test" | "live";
export const platformFeePercent = 5;

export class StripeProblem extends Error {
  constructor(readonlyStatus: number, message: string) {
    super(message);
    this.status = readonlyStatus;
  }
  readonly status: number;
}

export function platformFee(amount: number) {
  return Math.round((amount * platformFeePercent) / 100);
}

export type ConnectedAccount = {
  id: string;
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  capabilities?: { transfers?: string; card_payments?: string };
  requirements?: { disabled_reason?: string | null; currently_due?: string[] };
  settings?: { payouts?: { schedule?: { interval?: string } } };
};

export type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  arrival_date: number;
  automatic: boolean;
};

export type BalanceAmount = {
  amount: number;
  currency: string;
  source_types?: { card?: number };
};
export type StripeBalance = {
  available: BalanceAmount[];
  pending: BalanceAmount[];
};

export const stripeConfig = (env: Record<string, string | undefined>) => {
  const mode: StripeMode =
    env.VENDEORA_STRIPE_MODE === "live" ? "live" : "test";
  const key = env.STRIPE_SECRET_KEY;
  const enabled = Boolean(
    (key?.startsWith(`sk_${mode}_`) || key?.startsWith(`rk_${mode}_`)) &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.STRIPE_WEBHOOK_SECRET,
  );
  return { mode, key, enabled };
};

const providerMessages: Record<string, string> = {
  balance_insufficient:
    "A Stripe informou que o saldo disponível não cobre este saque.",
  payouts_not_allowed: "A Stripe ainda não liberou os repasses desta conta.",
  account_invalid:
    "A Stripe não conseguiu acessar a conta vinculada. Verifique o cadastro de recebimento.",
  platform_account_required:
    "Habilite o Stripe Connect na conta da VENDEORA para usar os repasses.",
  payouts_not_enabled:
    "Conclua a verificação e cadastre a conta bancária na Stripe para receber repasses.",
};

export function stripeClient(secret: string) {
  return async <T>(
    path: string,
    options: {
      form?: URLSearchParams;
      account?: string;
      idempotency?: string;
    } = {},
  ): Promise<T> => {
    const headers = new Headers({ Authorization: `Bearer ${secret}` });
    if (options.account) headers.set("Stripe-Account", options.account);
    if (options.idempotency)
      headers.set("Idempotency-Key", options.idempotency);
    let response: Response;
    try {
      response = await fetch(`https://api.stripe.com${path}`, {
        method: options.form ? "POST" : "GET",
        headers,
        body: options.form,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new StripeProblem(
        503,
        "A conexão com a Stripe falhou. Tente novamente.",
      );
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const code =
        typeof payload?.error?.code === "string" ? payload.error.code : "";
      if (
        /signed up for Connect|Connect platform|enable Connect/i.test(
          payload?.error?.message ?? "",
        )
      )
        throw new StripeProblem(
          409,
          "Habilite o Stripe Connect na conta da VENDEORA para usar os repasses.",
        );
      throw new StripeProblem(
        response.status === 429 ? 429 : providerMessages[code] ? 409 : 502,
        providerMessages[code] ??
          "A Stripe não concluiu a operação. Confira a configuração da conta e tente novamente.",
      );
    }
    return payload as T;
  };
}

export function stripeLink(value: unknown, expectedHost: string) {
  if (typeof value !== "string")
    throw new StripeProblem(502, "A Stripe retornou um endereço inválido.");
  const link = new URL(value);
  if (link.origin !== `https://${expectedHost}`)
    throw new StripeProblem(502, "A Stripe retornou um endereço inválido.");
  return link.href;
}
