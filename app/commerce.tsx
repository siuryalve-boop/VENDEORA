"use client";

import {
  Braces,
  Clapperboard,
  Download,
  Globe,
  Megaphone,
  MessagesSquare,
  Package,
  PackageOpen,
  ScanFace,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { MfaPanel } from "./operations";
import { Data, Heading, useData } from "./panel";
import {
  Action,
  api,
  dateLabel,
  Empty,
  Feedback,
  money,
  Notice,
  useTask,
} from "./shared";

type Template = {
  slug: string;
  title: string;
  description: string;
  price: number;
  files: string[];
};
type OwnedPack = {
  product_id: string;
  title: string;
  pack_slug: string;
  file_count: number;
};

const packThemes = {
  "afiliado-sem-rosto": {
    icon: ScanFace,
    theme: "Marketing de afiliados",
    tone: "violet",
  },
  "primeiro-produto-digital": {
    icon: PackageOpen,
    theme: "Criação de produtos digitais",
    tone: "orange",
  },
  "social-media-e-conteudo": {
    icon: Megaphone,
    theme: "Redes sociais e conteúdo",
    tone: "rose",
  },
  "sites-freelancer": { icon: Globe, theme: "Criação de sites", tone: "blue" },
  "saas-primeira-versao": {
    icon: Braces,
    theme: "Desenvolvimento de SaaS",
    tone: "violet",
  },
  "video-curto-e-edicao": {
    icon: Clapperboard,
    theme: "Edição e roteiros de vídeo",
    tone: "rose",
  },
  "vendas-e-atendimento": {
    icon: MessagesSquare,
    theme: "Vendas e atendimento",
    tone: "green",
  },
};

function cents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  const parsed = /^\d{1,6}([.,]\d{1,2})?$/.test(raw)
    ? Number(raw.replace(",", "."))
    : NaN;
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
}

export function PackCatalog() {
  const templates = useData<Template[]>("packs");
  const [pick, setPick] = useState<Template | null>(null);
  const [saved, setSaved] = useState(false);
  const task = useTask();
  return (
    <>
      <Heading
        title="Packs digitais"
        subtitle="Adicione pacotes prontos ao seu catálogo e ajuste o preço antes de publicar."
      />
      <Feedback status={task} />
      {saved && (
        <a className="button secondary" href="/produtos">
          Gerenciar packs em Produtos
        </a>
      )}
      {pick && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{pick.title}</h2>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPick(null)}
            >
              Fechar
            </button>
          </div>
          <form
            key={pick.slug}
            className="panel-form form"
            onSubmit={(event) =>
              task.submit(
                event,
                async (form) => {
                  const price = cents(form.get("price"));
                  if (price < 500 || !Number.isFinite(price))
                    throw new Error(
                      "Informe um preço válido a partir de R$ 5,00.",
                    );
                  await api("packs", { slug: pick.slug, price });
                  setPick(null);
                  setSaved(true);
                },
                "Pack cadastrado como rascunho. Publique em Produtos quando estiver pronto.",
              )
            }
          >
            <p>{pick.description}</p>
            <ul>
              {pick.files.map((filename) => (
                <li key={filename}>{filename}</li>
              ))}
            </ul>
            <label className="field">
              <span>Preço em reais</span>
              <input
                name="price"
                inputMode="decimal"
                defaultValue={(pick.price / 100).toFixed(2).replace(".", ",")}
                required
              />
            </label>
            <Action type="submit" busy={task.busy}>
              Adicionar ao meu catálogo
            </Action>
          </form>
        </section>
      )}
      <Data state={templates}>
        {(items) => (
          <div className="product-grid">
            {items.map((item) => {
              const {
                icon: Icon,
                theme,
                tone,
              } = packThemes[item.slug as keyof typeof packThemes] ?? {
                icon: Package,
                theme: "Produtos digitais",
                tone: "orange",
              };
              return (
                <article key={item.slug} className="panel">
                  <div className={`pack-art pack-art-${tone}`}>
                    <Icon size={35} strokeWidth={1.7} aria-hidden="true" />
                    <span>{theme}</span>
                  </div>
                  <div className="panel-form form">
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                    <p className="muted">
                      {item.files.length} arquivos · preço sugerido{" "}
                      {money(item.price)}
                    </p>
                    <Action onClick={() => setPick(item)}>Ver materiais</Action>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Data>
    </>
  );
}

export function PackLibrary() {
  const library = useData<OwnedPack[]>("packs/biblioteca");
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Packs da biblioteca</h2>
        <Package size={19} />
      </div>
      <Data state={library}>
        {(items) =>
          items.length ? (
            items.map((pack) => (
              <div className="list-row" key={pack.product_id}>
                <div>
                  <strong>{pack.title}</strong>
                  <p>{pack.file_count} arquivos para baixar</p>
                </div>
                <a
                  className="button secondary"
                  download
                  href={`/api/packs/download?id=${pack.product_id}`}
                >
                  <Download size={16} /> Baixar ZIP
                </a>
              </div>
            ))
          ) : (
            <Empty
              title="Nenhum pack disponível"
              body="Os packs que você criar ou comprar aparecem aqui."
            />
          )
        }
      </Data>
    </section>
  );
}

type PayStatus = {
  mode: "test" | "live";
  enabled: boolean;
  issue: keyof typeof stripeIssues | null;
  fee: number;
  verified: boolean;
  account: null | {
    canSell: boolean;
    canPayout: boolean;
    detailsSubmitted: boolean;
    manual: boolean;
    available: number;
    pending: number;
    payouts: {
      id: string;
      amount: number;
      currency: string;
      status: string;
      created: number;
      arrival_date: number;
      automatic: boolean;
    }[];
  };
};

const stripeIssues = {
  missing_key:
    "A hospedagem ainda não recebeu uma chave da Stripe para esta versão.",
  key_mode:
    "A chave da Stripe cadastrada é inválida ou pertence a outro ambiente. A chave e o modo de pagamentos precisam corresponder.",
  webhook:
    "A hospedagem precisa do segredo de assinatura do webhook da Stripe.",
  database_credentials:
    "A integração ainda precisa da credencial de servidor do Supabase.",
  site_url:
    "O modo real requer o endereço HTTPS oficial da VENDEORA configurado na hospedagem.",
  database_mode:
    "O modo de pagamentos da hospedagem é diferente do modo configurado no banco.",
};

const payoutLabels: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  in_transit: "Em trânsito",
  canceled: "Cancelado",
  failed: "Recusado",
};

export function StripePanel() {
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState<{ id: string; amount: number }>();
  const [confirm, setConfirm] = useState<number | null>(null);
  const stripe = useData<PayStatus>("stripe/conta", revision);
  const mfa = useData<{ verified: boolean; factor: string | null }>(
    stripe.data?.account?.manual && !stripe.data.verified ? "auth/mfa" : null,
    revision,
  );
  const task = useTask();
  const update = () => setRevision((value) => value + 1);
  return (
    <>
      <Feedback status={task} />
      <Data state={stripe}>
        {({ mode, enabled, issue, account, fee, verified }) => (
          <>
            <section className="panel">
              <div className="panel-heading">
                <h2>Recebimentos da Stripe</h2>
                <span className="pill">
                  {mode === "live" ? "Ambiente real" : "Ambiente de testes"}
                </span>
              </div>
              <div className="panel-form form">
                <p>
                  Taxa da VENDEORA por venda: <strong>{fee}%</strong>.
                </p>
                {!enabled ? (
                  <Notice>
                    {issue
                      ? stripeIssues[issue]
                      : "O Stripe Connect ainda aguarda ativação pela VENDEORA."}
                  </Notice>
                ) : (
                  <>
                    {!account?.canSell && (
                      <p>
                        {account?.detailsSubmitted
                          ? "A Stripe está analisando os dados de recebimento."
                          : "Conclua a verificação na Stripe para habilitar o checkout e informar a conta bancária de recebimento."}
                      </p>
                    )}
                    {(!account?.canSell || !account.canPayout) && (
                      <Action
                        busy={task.busy}
                        onClick={() =>
                          void task.run(async () => {
                            const link = await api<{ url: string }>(
                              "stripe/conta",
                              {},
                            );
                            window.location.assign(link.url);
                          })
                        }
                      >
                        {account
                          ? "Continuar verificação na Stripe"
                          : "Configurar recebimentos"}
                      </Action>
                    )}
                    {account?.canSell && (
                      <p>
                        Seu checkout está habilitado para receber por cartão.
                      </p>
                    )}
                    <button
                      type="button"
                      className="button secondary"
                      onClick={update}
                    >
                      Atualizar status
                    </button>
                  </>
                )}
              </div>
            </section>
            {enabled && account?.canPayout && (
              <>
                <div className="metrics">
                  <article className="panel metric">
                    <span className="metric-icon">
                      <Wallet size={20} />
                    </span>
                    <p>Saldo disponível na Stripe</p>
                    <strong>{money(account.available)}</strong>
                  </article>
                  <article className="panel metric">
                    <p>Saldo a receber na Stripe</p>
                    <strong>{money(account.pending)}</strong>
                  </article>
                </div>
                {!account.manual && (
                  <Notice success>
                    O saldo é repassado pela Stripe conforme o calendário
                    automático desta conta.
                  </Notice>
                )}
                {account.manual && !verified && (
                  <Data state={mfa}>
                    {(status) => (
                      <MfaPanel status={status} onVerified={update} />
                    )}
                  </Data>
                )}
                {account.manual && verified && (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Solicitar saque</h2>
                      <ShieldCheck size={20} />
                    </div>
                    <div className="panel-form form">
                      <form
                        className="form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const amount = cents(
                            new FormData(event.currentTarget).get("amount"),
                          );
                          if (
                            !Number.isFinite(amount) ||
                            amount < 100 ||
                            amount > account.available
                          ) {
                            task.setError(
                              "Informe um valor entre R$ 1,00 e o saldo disponível.",
                            );
                            return;
                          }
                          task.setError("");
                          setConfirm(amount);
                        }}
                      >
                        <label className="field">
                          <span>Valor em reais</span>
                          <input
                            name="amount"
                            inputMode="decimal"
                            autoComplete="off"
                            required
                            disabled={task.busy}
                          />
                        </label>
                        <Action
                          type="submit"
                          disabled={account.available < 100 || task.busy}
                        >
                          Revisar saque
                        </Action>
                      </form>
                      {confirm !== null && (
                        <div className="review">
                          <div>
                            <strong>
                              {mode === "test"
                                ? "Simular saque de "
                                : "Confirmar saque de "}
                              {money(confirm)}
                            </strong>
                            <p>
                              Destino: conta bancária padrão cadastrada na
                              Stripe.
                            </p>
                            <div className="actions">
                              <Action
                                busy={task.busy}
                                onClick={() =>
                                  void task.run(
                                    async () => {
                                      const id =
                                        attempt?.amount === confirm
                                          ? attempt.id
                                          : crypto.randomUUID();
                                      setAttempt({ id, amount: confirm });
                                      await api("stripe/saques", {
                                        attempt: id,
                                        amount: confirm,
                                      });
                                      setConfirm(null);
                                      setAttempt(undefined);
                                      update();
                                    },
                                    mode === "test"
                                      ? "Saque de teste solicitado."
                                      : "Saque solicitado. Acompanhe o status abaixo.",
                                  )
                                }
                              >
                                Confirmar {mode === "test" ? "teste" : "saque"}
                              </Action>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={task.busy}
                                onClick={() => setConfirm(null)}
                              >
                                Voltar
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Histórico de repasses</h2>
                  </div>
                  {account.payouts.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Solicitado em</th>
                            <th>Previsão de chegada</th>
                            <th>Status</th>
                            <th>Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {account.payouts.map((payout) => (
                            <tr key={payout.id}>
                              <td>
                                {dateLabel(
                                  new Date(payout.created * 1000).toISOString(),
                                )}
                              </td>
                              <td>
                                {dateLabel(
                                  new Date(
                                    payout.arrival_date * 1000,
                                  ).toISOString(),
                                )}
                              </td>
                              <td>
                                {payoutLabels[payout.status] ?? payout.status}
                              </td>
                              <td>{money(payout.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="Nenhum repasse"
                      body="Os repasses confirmados pela Stripe aparecem aqui."
                    />
                  )}
                </section>
              </>
            )}
          </>
        )}
      </Data>
    </>
  );
}
