"use client";

import {
  ArrowLeft,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AuthFrame, Login, Recovery, Register } from "./auth";
import { Dashboard } from "./dashboard";
import {
  Action,
  api,
  Brand,
  Empty,
  Feedback,
  money,
  Notice,
  type Order,
  type Product,
  type Session,
  useTask,
} from "./shared";

const checkoutPath = /^\/checkout\/[\da-f-]{36}$/i;
const referralId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useLoad<T>(endpoint: string) {
  const [state, update] = useState<{ data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    api<T>(endpoint, undefined, controller.signal)
      .then((data) => update({ data }))
      .catch((error) => {
        if (!controller.signal.aborted) update({ error: error.message });
      });
    return () => controller.abort();
  }, [endpoint]);
  return state;
}

function Checkout({ path, id }: { path: string; id: string }) {
  const offer = useLoad<{
    offer: Product;
    style: { headline: string; accent: string } | null;
    payment: { enabled: boolean; mode: "test" | "live" };
  }>(`oferta?id=${encodeURIComponent(id)}`);
  const session = useLoad<Session>("auth/session");
  const [attempt, setAttempt] = useState("");
  const [referral, setReferral] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; amount: number }>();
  const discount = useTask();
  const task = useTask();
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref") ?? "";
    if (!referralId.test(code)) return;
    setReferral(code);
    const visit = `vendeora.visit.${id}.${code}`;
    if (sessionStorage.getItem(visit)) return;
    sessionStorage.setItem(visit, "1");
    void api("checkout/referral", { product_id: id, referral: code }).catch(
      () => sessionStorage.removeItem(visit),
    );
  }, [id]);
  return (
    <main className="simple-layout">
      <header>
        <Brand />
        <a className="text-link" href="/dashboard">
          Minha conta
        </a>
      </header>
      <div className="checkout-grid">
        <section
          className="panel checkout-panel"
          style={
            offer?.data?.style
              ? { borderTop: `4px solid ${offer.data.style.accent}` }
              : undefined
          }
        >
          <span className="section-label">CHECKOUT VENDEORA</span>
          {!offer && (
            <div
              className="skeleton"
              role="status"
              aria-label="Carregando produto"
            />
          )}
          {offer?.error && <Notice>{offer.error}</Notice>}
          {offer?.data && (
            <>
              <h1>{offer.data.offer.title}</h1>
              {offer.data.style?.headline && (
                <p>
                  <strong>{offer.data.style.headline}</strong>
                </p>
              )}
              <p>{offer.data.offer.description}</p>
              <span className="pill">{offer.data.offer.category}</span>
              <div className="checkout-price">
                <small>Total do pedido</small>
                <strong>
                  {money(coupon?.amount ?? offer.data.offer.price_cents)}
                </strong>
                {coupon && <small>Cupom {coupon.code} aplicado</small>}
              </div>
            </>
          )}
        </section>
        <section className="panel checkout-panel">
          <div className="metric-icon">
            <LockKeyhole size={22} />
          </div>
          <h2>Pagamento</h2>
          <Feedback status={task} />
          <Feedback status={discount} />
          {session?.error && <Notice>{session.error}</Notice>}
          {offer?.data && session?.data?.profile && (
            <form
              className="form"
              onSubmit={(event) =>
                discount.submit(
                  event,
                  async (form) => {
                    const code = String(form.get("coupon") ?? "")
                      .trim()
                      .toUpperCase();
                    const quote = await api<{ amount_cents: number }>(
                      "checkout/cotacao",
                      { product_id: id, code },
                    );
                    setCoupon({ code, amount: quote.amount_cents });
                    setAttempt("");
                  },
                  "Cupom aplicado.",
                )
              }
            >
              <label className="field">
                <span>Cupom de desconto</span>
                <input name="coupon" minLength={3} maxLength={32} required />
              </label>
              <div className="actions">
                <Action
                  type="submit"
                  className="button secondary"
                  busy={discount.busy}
                >
                  Aplicar
                </Action>
                {coupon && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setCoupon(undefined);
                      setAttempt("");
                    }}
                  >
                    Remover
                  </button>
                )}
              </div>
            </form>
          )}
          {offer?.data &&
            (offer.data.payment.enabled ? (
              <>
                <p>
                  {offer.data.payment.mode === "test"
                    ? "Ambiente de testes Stripe. Use um cartão de teste do gateway."
                    : "Pagamento com cartão pela Stripe."}
                </p>
                {session?.data &&
                  (session.data.profile ? (
                    <Action
                      busy={task.busy}
                      onClick={() =>
                        void task.run(async () => {
                          const key = attempt || crypto.randomUUID();
                          setAttempt(key);
                          const result = await api<{ url: string }>(
                            "checkout",
                            {
                              product_id: id,
                              attempt_id: key,
                              coupon: coupon?.code,
                              referral: referral || undefined,
                            },
                          );
                          window.location.assign(result.url);
                        })
                      }
                    >
                      <CreditCard size={19} /> Continuar para pagamento
                    </Action>
                  ) : (
                    <a
                      className="button primary"
                      href={`/entrar?next=${encodeURIComponent(path + (referral ? `?ref=${referral}` : ""))}`}
                    >
                      Entrar para continuar
                    </a>
                  ))}
              </>
            ) : (
              <p>
                O gateway de pagamento ainda está indisponível neste ambiente.
              </p>
            ))}
          <a className="text-link" href="/termos">
            Termos de uso
          </a>
        </section>
      </div>
    </main>
  );
}

function OrderPage({ id }: { id: string }) {
  const order = useLoad<Order>(`pedido?id=${encodeURIComponent(id)}`);
  const labels: Record<string, string> = {
    paid: "Pagamento aprovado",
    pending: "Pagamento pendente",
    failed: "Pagamento recusado",
    expired: "Pedido expirado",
    refunded: "Pagamento reembolsado",
  };
  return (
    <AuthFrame>
      <div className="auth-heading">
        <span className="section-label">SEU PEDIDO</span>
        <h1>
          {order?.data ? labels[order.data.status] : "Acompanhe seu pedido"}
        </h1>
      </div>
      <div className="form">
        {!order && (
          <div
            className="skeleton"
            role="status"
            aria-label="Carregando pedido"
          />
        )}
        {order?.error && <Notice>{order.error}</Notice>}
        {order?.data && (
          <div className="review">
            <ShieldCheck size={24} />
            <div>
              <strong>{money(order.data.amount_cents)}</strong>
              <p>
                Pedido #{order.data.id.slice(0, 8)}
                {order.data.payment_mode === "test"
                  ? " · Ambiente de testes"
                  : ""}
              </p>
            </div>
          </div>
        )}
        {order?.data?.status === "pending" && (
          <button
            className="button secondary"
            onClick={() => window.location.reload()}
          >
            Atualizar status
          </button>
        )}
        <a
          className="button primary"
          href={order?.data?.status === "paid" ? "/membros" : "/dashboard"}
        >
          {order?.data?.status === "paid"
            ? "Abrir área de membros"
            : "Ir para o painel"}
        </a>
      </div>
    </AuthFrame>
  );
}

function Documents({ path }: { path: string }) {
  const terms = path === "/termos";
  const privacy = path === "/privacidade";
  return (
    <main className="simple-layout">
      <header>
        <Brand />
        <a href="/" className="text-link">
          <ArrowLeft size={15} /> Voltar à plataforma
        </a>
      </header>
      <article className="panel document">
        <h1>
          {terms
            ? "Termos de uso"
            : privacy
              ? "Política de privacidade"
              : "Central de ajuda"}
        </h1>
        {(terms || privacy) && (
          <p className="muted">
            Versão de 22 de novembro de 2026 · Ambiente de teste
          </p>
        )}
        {terms && (
          <>
            <h2>Conta e acesso</h2>
            <p>
              Para criar uma conta, é preciso ter 18 anos completos, fornecer
              dados corretos e confirmar o endereço de e-mail. Mantenha suas
              credenciais protegidas e use apenas o perfil que corresponde à sua
              atividade.
            </p>
            <h2>Produtos e conteúdo</h2>
            <p>
              Publique somente materiais que você tenha direito de distribuir.
              As aulas disponibilizadas pelo produtor ficam acessíveis às contas
              com pedidos aprovados.
            </p>
            <h2>Pagamentos</h2>
            <p>
              Este ambiente permite testar o fluxo com o gateway em modo de
              teste. Os pedidos do ambiente de teste não geram valores a sacar.
            </p>
            <h2>Dados pessoais</h2>
            <p>
              As finalidades do tratamento e o canal de solicitações estão na{" "}
              <a className="text-link" href="/privacidade">
                Política de privacidade
              </a>
              .
            </p>
          </>
        )}
        {privacy && (
          <>
            <h2>Dados de cadastro</h2>
            <p>
              O cadastro usa nome, e-mail, telefone e data de nascimento para
              criar a conta, verificar a idade informada e habilitar o acesso. O
              CPF é validado e transformado em um identificador protegido para
              detectar duplicidade. Esta validação matemática não confirma
              titularidade.
            </p>
            <h2>Uso da plataforma</h2>
            <p>
              Registros de produtos, pedidos, afiliações e progresso são
              utilizados para prestar as funções que você solicita. A sessão usa
              cookies necessários à autenticação. Dados do cartão são fornecidos
              diretamente ao gateway quando o checkout de teste está habilitado.
            </p>
            <h2>Seus dados</h2>
            <p>
              Use{" "}
              <a className="text-link" href="/configuracoes">
                Configurações
              </a>{" "}
              para solicitar acesso, correção ou exclusão dos dados. As
              solicitações ficam registradas para análise do operador da
              plataforma.
            </p>
          </>
        )}
        {!terms && !privacy && (
          <>
            <h2>Acesso à conta</h2>
            <p>
              Confirme seu e-mail pelo link do cadastro. Se precisar alterar sua
              senha, use a página{" "}
              <a className="text-link" href="/recuperar-senha">
                Recuperar senha
              </a>
              .
            </p>
            <h2>Primeiro produto</h2>
            <p>
              No painel do produtor, abra Produtos, selecione Novo produto e
              preencha os dados. Publique o produto para gerar um link de
              checkout.
            </p>
            <h2>Suas aulas</h2>
            <p>
              Abra a Área de membros para acessar as aulas vinculadas aos seus
              pedidos aprovados.
            </p>
          </>
        )}
      </article>
    </main>
  );
}

export function Vendeora({
  path,
  captchaKey,
}: {
  path: string;
  captchaKey: string;
}) {
  const normalized = path.replace(/\/$/, "") || "/";
  if (["/termos", "/privacidade", "/ajuda"].includes(normalized))
    return <Documents path={normalized} />;
  if (checkoutPath.test(normalized))
    return <Checkout path={normalized} id={normalized.split("/")[2]} />;
  if (/^\/pedido\/[\da-f-]{36}$/i.test(normalized))
    return <OrderPage id={normalized.split("/")[2]} />;
  if (normalized === "/cadastro") return <Register captchaKey={captchaKey} />;
  if (normalized === "/recuperar-senha" || normalized === "/nova-senha")
    return (
      <Recovery fresh={normalized === "/nova-senha"} captchaKey={captchaKey} />
    );
  return <SessionGate path={normalized} captchaKey={captchaKey} />;
}

function SessionGate({
  path,
  captchaKey,
}: {
  path: string;
  captchaKey: string;
}) {
  const session = useLoad<Session>("auth/session");
  const [query, update] = useState<URLSearchParams>();
  useEffect(() => {
    update(new URLSearchParams(window.location.search));
  }, []);
  const requested = query?.get("next") ?? "";
  const [destination, parameters] = requested.split("?", 2);
  const referral = new URLSearchParams(parameters).get("ref") ?? "";
  const next = checkoutPath.test(destination)
    ? destination + (referralId.test(referral) ? `?ref=${referral}` : "")
    : "/dashboard";
  const profile = session?.data?.profile;
  if (profile && session?.data)
    return (
      <Dashboard
        page={path === "/" || path === "/entrar" ? "dashboard" : path.slice(1)}
        session={{ ...session.data, profile }}
        confirmed={query?.get("status") === "confirmed"}
      />
    );
  if (!session && path !== "/" && path !== "/entrar")
    return (
      <AuthFrame>
        <Empty
          title="Verificando sua sessão"
          body="Aguarde enquanto conferimos o acesso ao painel."
        >
          <LoaderCircle className="spin" size={22} />
        </Empty>
      </AuthFrame>
    );
  return (
    <Login
      captchaKey={captchaKey}
      status={query?.get("status") ?? null}
      next={next}
    />
  );
}
