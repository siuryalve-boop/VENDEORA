"use client";

import {
  Activity,
  BadgeDollarSign,
  Bell,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  CreditCard,
  ContactRound,
  House,
  LayoutGrid,
  Link2,
  LogOut,
  Menu,
  Package,
  Plus,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CheckoutEditor, CheckoutFields } from "./checkout-editor";
import { Marketplace } from "./marketplace";
import { PackCatalog, PackLibrary, StripePanel } from "./commerce";
import {
  CourseModules,
  Customers,
  MfaPanel,
  Notifications,
  Reports,
  Support,
  type CourseModule,
} from "./operations";
import { Data, Heading, useData } from "./panel";
import {
  Action,
  api,
  Brand,
  dateLabel,
  Empty,
  Feedback,
  money,
  Notice,
  Password,
  roleLabel,
  types,
  useTask,
  type Order,
  type Product,
  type Profile,
  type Session,
} from "./shared";

const navigation = [
  { id: "dashboard", label: "Visão geral", icon: House, roles: "all" },
  { id: "produtos", label: "Produtos", icon: Boxes, roles: "producer admin" },
  { id: "marketplace", label: "Marketplace", icon: Store, roles: "all" },
  { id: "packs", label: "Packs digitais", icon: Package, roles: "producer" },
  { id: "vendas", label: "Vendas", icon: ShoppingBag, roles: "producer admin" },
  { id: "clientes", label: "Clientes", icon: ContactRound, roles: "producer" },
  { id: "checkout", label: "Checkout", icon: CreditCard, roles: "producer" },
  {
    id: "afiliados",
    label: "Afiliados",
    icon: Users,
    roles: "producer affiliate",
  },
  { id: "membros", label: "Área de membros", icon: BookOpen, roles: "all" },
  {
    id: "modulos",
    label: "Módulos do curso",
    icon: LayoutGrid,
    roles: "producer",
  },
  {
    id: "financeiro",
    label: "Financeiro",
    icon: Wallet,
    roles: "producer affiliate",
  },
  { id: "usuarios", label: "Usuários", icon: ShieldCheck, roles: "admin" },
  {
    id: "relatorios",
    label: "Relatórios",
    icon: ChartNoAxesCombined,
    roles: "producer",
  },
  { id: "notificacoes", label: "Notificações", icon: Bell, roles: "all" },
  { id: "configuracoes", label: "Configurações", icon: Settings, roles: "all" },
  { id: "suporte", label: "Suporte", icon: CircleHelp, roles: "all" },
];

const orderStatus: Record<string, string> = {
  paid: "Aprovado",
  pending: "Pendente",
  failed: "Recusado",
  expired: "Expirado",
  refunded: "Reembolsado",
};
const affiliateStatus: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  declined: "Recusada",
};
const total = (orders: Order[]) =>
  orders
    .filter((order) => order.status === "paid")
    .reduce((amount, order) => amount + order.amount_cents, 0);

function OrderTable({ orders }: { orders: Order[] }) {
  if (!orders.length)
    return (
      <Empty
        title="Nenhum pedido encontrado"
        body="Os pedidos feitos pelo checkout aparecem aqui."
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Data</th>
            <th>Status</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <a className="text-link" href={`/pedido/${order.id}`}>
                  #{order.id.slice(0, 8)}
                </a>
              </td>
              <td>{dateLabel(order.created_at)}</td>
              <td>
                <span
                  className={`pill ${order.status === "paid" ? "pill-green" : ""}`}
                >
                  {orderStatus[order.status]}
                </span>
              </td>
              <td>{money(order.amount_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SalesSummary = {
  approved: number;
  pending: number;
  gross_cents: number;
  fee_cents: number;
  refunded: number;
  buckets: number[];
  payment_mode: "test" | "live";
};

function Overview({ profile }: { profile: Profile }) {
  const [period, setPeriod] = useState("30");
  const producer = profile.role === "producer";
  const orders = useData<Order[]>(
    producer ? "pedidos?view=resumo" : "pedidos", 0, 30000,
  );
  const summary = useData<SalesSummary>(
    producer ? `vendas/resumo?days=${period}` : null, 0, 30000,
  );
  const seller = profile.role === "producer" || profile.role === "admin";
  return (
    <>
      <Heading
        title="Visão geral"
        subtitle={`Olá, ${profile.name.split(" ")[0]}. Acompanhe a atividade da sua conta.`}
      >
        <label className="period">
          <span className="sr-only">Período</span>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="1">Últimas 24 horas</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </Heading>
      {producer && summary.error && <Notice>{summary.error}</Notice>}
      <Data state={orders}>
        {(list) => {
          if (producer && !summary.data)
            return summary.error ? null : (
              <div className="skeleton" role="status" aria-label="Carregando vendas" />
            );
          const start = Date.now() - Number(period) * 86400000;
          const filtered = list.filter(
            (order) => new Date(order.created_at).getTime() >= start,
          );
          const paid = filtered.filter((order) => order.status === "paid");
          const buckets = Array.from(
            { length: Math.min(10, Number(period)) },
            () => 0,
          );
          for (const order of paid) {
            const distance = new Date(order.created_at).getTime() - start;
            const index = Math.min(
              buckets.length - 1,
              Math.max(
                0,
                Math.floor(
                  distance / ((Number(period) * 86400000) / buckets.length),
                ),
              ),
            );
            buckets[index] += order.amount_cents;
          }
          const overview = summary.data;
          const chart = overview?.buckets ?? buckets;
          const ceiling = Math.max(1, ...chart);
          const gross = overview?.gross_cents ?? total(filtered);
          const approved = overview?.approved ?? paid.length;
          const metrics = [
            {
              icon: BadgeDollarSign,
              title: seller ? "Faturamento aprovado" : "Compras aprovadas",
              value: money(gross),
            },
            {
              icon: ShoppingBag,
              title: "Pedidos aprovados",
              value: approved,
            },
            {
              icon: Activity,
              title: "Pedidos pendentes",
              value: overview?.pending ?? filtered.filter((order) => order.status === "pending").length,
            },
            {
              icon: ChartNoAxesCombined,
              title: "Ticket médio",
              value: money(approved ? Math.round(gross / approved) : 0),
            },
          ];
          return (
            <>
              <div className="metrics">
                {metrics.map(({ icon: Icon, title, value }) => (
                  <article className="panel metric" key={title}>
                    <span className="metric-icon">
                      <Icon size={20} />
                    </span>
                    <p>{title}</p>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
              {overview && (
                <div className="overview-summary">
                  {overview.payment_mode === "test" && (
                    <span className="pill">Vendas em ambiente de teste</span>
                  )}
                  <span>Taxa VENDEORA nas vendas aprovadas <strong>{money(overview.fee_cents)}</strong></span>
                  <span>Reembolsos <strong>{overview.refunded}</strong></span>
                  <a className="text-link" href="/financeiro">Consultar saldo e saques</a>
                </div>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    {seller ? "Faturamento no período" : "Compras no período"}
                  </h2>
                </div>
                {approved ? (
                  <div
                    className="bar-chart"
                    role="img"
                    aria-label={`Total de ${money(gross)} no período`}
                  >
                    {chart.map((amount, index) => (
                      <div
                        className="bar-column"
                        key={index}
                        title={money(amount)}
                      >
                        <span
                          style={{
                            height: `${Math.max(2, (amount * 100) / ceiling)}%`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Sem movimentação no período"
                    body="O gráfico aparece quando houver pedidos aprovados."
                  />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Últimas transações</h2>
                </div>
                <OrderTable orders={filtered.slice(0, 6)} />
              </section>
            </>
          );
        }}
      </Data>
    </>
  );
}

function ProductEditor({
  product,
  onSave,
  onClose,
}: {
  product: Product | null;
  onSave: (product: Product | null) => void;
  onClose: () => void;
}) {
  const task = useTask();
  const [archive, confirmArchive] = useState(false);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{product ? "Editar produto" : "Novo produto"}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar editor"
        >
          <X size={22} />
        </button>
      </div>
      <form
        className="form panel-form"
        onSubmit={(event) =>
          task.submit(event, async (data) => {
            const saved = await api<Product>("produtos", {
              id: product?.id,
              title: data.get("title"),
              description: data.get("description"),
              category: data.get("category"),
              price_cents: Math.round(Number(data.get("price")) * 100),
              active: data.get("active") === "on",
              affiliates_enabled: data.get("affiliates_enabled") === "on",
              commission_percent: Number(data.get("commission_percent")),
            });
            onSave(saved);
          }, "Produto atualizado.")
        }
      >
        <Feedback status={task} />
        <div className="form-grid">
          <label className="field span-2">
            <span>Nome do produto</span>
            <input
              required
              name="title"
              minLength={3}
              maxLength={120}
              defaultValue={product?.title}
            />
          </label>
          <label className="field">
            <span>Tipo de produto</span>
            <select name="category" defaultValue={product?.category}>
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Preço em reais</span>
            <input
              type="number"
              name="price"
              min="5"
              max="100000"
              step="0.01"
              required
              defaultValue={product ? product.price_cents / 100 : undefined}
            />
          </label>
          <label className="field span-2">
            <span>Descrição</span>
            <textarea
              name="description"
              rows={4}
              maxLength={3000}
              defaultValue={product?.description}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={product?.active}
          />{" "}
          Publicar no marketplace e no checkout
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="affiliates_enabled"
            defaultChecked={product?.affiliates_enabled}
          />{" "}
          Aceitar solicitações de afiliados
        </label>
        <label className="field">
          <span>Comissão de afiliado (%)</span>
          <input
            type="number"
            name="commission_percent"
            min={0}
            max={80}
            defaultValue={product?.commission_percent ?? 0}
            required
          />
        </label>
        <div className="actions">
          <Action busy={task.busy} type="submit">
            Salvar produto
          </Action>
          {product && (
            <button
              type="button"
              className="button secondary"
              onClick={() => confirmArchive(!archive)}
            >
              Arquivar
            </button>
          )}
        </div>
        {archive && product && (
          <div className="review">
            <div>
              <strong>Arquivar este produto?</strong>
              <p>
                O link de checkout deixa de aceitar novos pedidos. O histórico
                continua disponível.
              </p>
              <Action
                type="button"
                className="button secondary"
                busy={task.busy}
                onClick={() =>
                  void task.run(async () => {
                    await api("produtos", { id: product.id, archive: true });
                    onSave(null);
                  })
                }
              >
                Confirmar arquivamento
              </Action>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function ProductDetail({ id }: { id: string }) {
  const [tab, setTab] = useState("details");
  const [revision, refresh] = useState(0);
  const data = useData<Product[]>(`produtos?id=${id}`, revision);
  useEffect(() => {
    if (window.location.hash === "#checkout") setTab("checkout");
  }, []);
  return (
    <Data state={data}>
      {([product]) => !product ? (
        <section className="panel">
          <Empty title="Produto indisponível" body="Selecione um produto do seu catálogo.">
            <a className="text-link" href="/produtos">Voltar a Produtos</a>
          </Empty>
        </section>
      ) : (
        <>
          <Heading title={product.title} subtitle={product.active ? "Produto publicado" : "Produto em rascunho"}>
            <a className="button secondary" href="/produtos">Voltar ao catálogo</a>
          </Heading>
          <div className="product-sections" role="group" aria-label="Seções do produto">
            <button className="button secondary" type="button" aria-pressed={tab === "details"} onClick={() => setTab("details")}>Dados do produto</button>
            <button className="button secondary" type="button" aria-pressed={tab === "checkout"} onClick={() => setTab("checkout")}>Editar checkout</button>
            <a className="button secondary" href={`/afiliados?produto=${id}`}>Solicitações de afiliados</a>
          </div>
          {tab === "details" ? (
            <ProductEditor product={product} onClose={() => window.location.assign("/produtos")} onSave={(saved) => {
              if (saved) refresh((value) => value + 1);
              else window.location.assign("/produtos");
            }} />
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <h2>Checkout do produto</h2>
                {product.active && (
                  <a className="text-link" href={`/checkout/${id}`} target="_blank" rel="noreferrer">Abrir checkout</a>
                )}
              </div>
              <div className="panel-form form"><CheckoutFields id={id} /></div>
            </section>
          )}
        </>
      )}
    </Data>
  );
}

function Products({ canEdit }: { canEdit: boolean }) {
  const [creating, setCreating] = useState(false);
  const products = useData<Product[]>("produtos");
  return (
    <>
      <Heading
        title="Produtos"
        subtitle="Cadastre e gerencie seus produtos digitais."
      >
        {canEdit && (
          <Action onClick={() => setCreating(true)}>
            <Plus size={18} /> Novo produto
          </Action>
        )}
      </Heading>
      {creating && (
        <ProductEditor
          product={null}
          onClose={() => setCreating(false)}
          onSave={(saved) => {
            if (saved) window.location.assign(`/produtos/${saved.id}#checkout`);
          }}
        />
      )}
      <Data state={products}>
        {(list) =>
          list.length ? (
            <div className="product-grid">
              {list.map((product) => (
                <article className="panel product-card" key={product.id}>
                  <div
                    className={`product-art art-${types.indexOf(product.category) % 4}`}
                  >
                    <Boxes size={37} />
                  </div>
                  <div className="product-body">
                    <div className="form-row">
                      <span className="product-type">{product.category}</span>
                      <span
                        className={`pill ${product.active ? "pill-green" : ""}`}
                      >
                        {product.active ? "Ativo" : "Rascunho"}
                      </span>
                    </div>
                    <h2>{product.title}</h2>
                    <strong>{money(product.price_cents)}</strong>
                    {canEdit && (
                      <div className="actions">
                        <a className="button secondary" href={`/produtos/${product.id}`}>Gerenciar</a>
                        <a className="button secondary" href={`/produtos/${product.id}#checkout`}>Editar checkout</a>
                        {product.active && (
                          <a
                            className="button secondary"
                            href={`/checkout/${product.id}`}
                          >
                            <Link2 size={16} /> Checkout
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="panel">
              <Empty
                title="Nenhum produto cadastrado"
                body="Crie seu primeiro produto para disponibilizar um link de checkout."
              />
            </section>
          )
        }
      </Data>
    </>
  );
}

function CheckoutLinks() {
  const products = useData<Product[]>("produtos");
  const task = useTask();
  return (
    <>
      <Heading
        title="Checkout"
        subtitle="Abra e compartilhe os links dos seus produtos ativos."
      />
      <Feedback status={task} />
      <Data state={products}>
        {(items) => {
          const products = items.filter((product) => product.active);
          return (
            <section className="panel">
              {products.length ? (
                products.map((product) => (
                  <div className="list-row" key={product.id}>
                    <div>
                      <strong>{product.title}</strong>
                      <p>{money(product.price_cents)}</p>
                    </div>
                    <div className="actions">
                      <a
                        className="button secondary"
                        href={`/checkout/${product.id}`}
                      >
                        Abrir checkout
                      </a>
                      <button
                        className="button secondary"
                        onClick={() =>
                          void task.run(
                            () =>
                              navigator.clipboard.writeText(
                                `${window.location.origin}/checkout/${product.id}`,
                              ),
                            "Link copiado.",
                          )
                        }
                      >
                        <Link2 size={16} /> Copiar link
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <Empty
                  title="Nenhum checkout disponível"
                  body="Ative um produto para gerar seu link."
                >
                  <a className="text-link" href="/produtos">
                    Gerenciar produtos
                  </a>
                </Empty>
              )}
            </section>
          );
        }}
      </Data>
    </>
  );
}

type AffiliateRequest = {
  id: string;
  product_id: string;
  affiliate_id: string;
  status: string;
  visits: number;
};
type Commission = {
  order_id: string;
  product_id: string;
  amount_cents: number;
  created_at: string;
  status: "approved" | "reversed";
};

function Affiliates({ producer, productId }: { producer: boolean; productId?: string }) {
  const [revision, refresh] = useState(0);
  const products = useData<Product[]>("produtos");
  const requests = useData<AffiliateRequest[]>(
    producer && productId ? `afiliacoes?produto=${productId}` : "afiliacoes",
    revision,
  );
  const commissions = useData<Commission[]>("comissoes");
  const task = useTask();
  const mutate = (data: Record<string, unknown>) =>
    void task.run(async () => {
      await api("afiliacoes", data);
      refresh((value) => value + 1);
    }, "Solicitação atualizada.");
  return (
    <>
      <Heading
        title="Afiliados"
        subtitle={
          producer
            ? "Revise pedidos de afiliação aos seus produtos."
            : "Solicite afiliação a produtos disponíveis."
        }
      >
        {producer && productId && <a className="button secondary" href="/afiliados">Ver todas as solicitações</a>}
      </Heading>
      <Feedback status={task} />
      <Data state={products}>
        {(list) => (
          <Data state={requests}>
            {(applications) => (
              <section className="panel">
                {producer ? (
                  applications.length ? (
                    applications.map((entry) => (
                      <div className="list-row" key={entry.id}>
                        <div>
                          <strong>
                            {list.find(
                              (product) => product.id === entry.product_id,
                            )?.title ?? "Produto arquivado"}
                          </strong>
                          <p>
                            Solicitação #{entry.id.slice(0, 8)} ·{" "}
                            {affiliateStatus[entry.status]}
                          </p>
                        </div>
                        {entry.status === "pending" && (
                          <div className="actions">
                            <Action
                              busy={task.busy}
                              onClick={() =>
                                mutate({ id: entry.id, status: "approved" })
                              }
                            >
                              Aprovar
                            </Action>
                            <Action
                              className="button secondary"
                              busy={task.busy}
                              onClick={() =>
                                mutate({ id: entry.id, status: "declined" })
                              }
                            >
                              Recusar
                            </Action>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="Nenhuma solicitação recebida"
                      body="Ative a opção de afiliados em um produto para receber pedidos."
                    />
                  )
                ) : list.length ? (
                  list.map((product) => {
                    const entry = applications.find(
                      (request) => request.product_id === product.id,
                    );
                    return (
                      <div className="list-row" key={product.id}>
                        <div>
                          <strong>{product.title}</strong>
                          <p>
                            {product.category} · {money(product.price_cents)} ·{" "}
                            {product.commission_percent ?? 0}% de comissão
                          </p>
                        </div>
                        {entry ? (
                          <div className="actions">
                            <span className="pill">
                              {affiliateStatus[entry.status]}
                            </span>
                            {entry.status === "approved" && (
                              <>
                                <span className="pill">
                                  {entry.visits} visitas
                                </span>
                                <Action
                                  className="button secondary"
                                  busy={task.busy}
                                  onClick={() =>
                                    void task.run(async () => {
                                      await navigator.clipboard.writeText(
                                        `${location.origin}/checkout/${product.id}?ref=${entry.id}`,
                                      );
                                    }, "Link de afiliado copiado.")
                                  }
                                >
                                  Copiar link
                                </Action>
                              </>
                            )}
                          </div>
                        ) : (
                          <Action
                            busy={task.busy}
                            onClick={() => mutate({ product_id: product.id })}
                          >
                            Solicitar afiliação
                          </Action>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <Empty
                    title="Nenhum produto disponível"
                    body="Os produtos que aceitam novas afiliações aparecem aqui."
                  />
                )}
              </section>
            )}
          </Data>
        )}
      </Data>
      <section className="panel">
        <div className="panel-heading">
          <h2>Comissões em testes</h2>
        </div>
        <Data state={commissions}>
          {(entries) =>
            entries.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Produto</th>
                      <th>Status</th>
                      <th>Comissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((commission) => (
                      <tr key={commission.order_id}>
                        <td>{dateLabel(commission.created_at)}</td>
                        <td>
                          {products.data?.find(
                            (product) => product.id === commission.product_id,
                          )?.title ?? "Produto indisponível"}
                        </td>
                        <td>
                          {commission.status === "approved"
                            ? "Aprovada em teste"
                            : "Estornada"}
                        </td>
                        <td>{money(commission.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Sem comissões registradas"
                body="As comissões aparecem quando um pedido atribuído a um afiliado é aprovado em teste."
              />
            )
          }
        </Data>
      </section>
    </>
  );
}

type Lesson = {
  id: string;
  title: string;
  content: string;
  product_id: string;
  module_id: string | null;
};
type Progress = { lesson_id: string };

function Members({ producer }: { producer: boolean }) {
  const task = useTask();
  const [revision, refresh] = useState(0);
  const [editing, edit] = useState<Lesson | "new" | null>(null);
  const [removing, remove] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState("");
  const lessons = useData<Lesson[]>("aulas", revision);
  const modules = useData<CourseModule[]>("modulos");
  const products = useData<Product[]>(producer ? "produtos" : null);
  const progress = useData<Progress[]>(producer ? null : "progresso", revision);
  const productId =
    editing === "new"
      ? newProduct || products.data?.[0]?.id
      : editing?.product_id;
  const forLesson =
    modules.data?.filter((module) => module.product_id === productId) ?? [];
  const moduleById = new Map(
    modules.data?.map((module) => [module.id, module]),
  );
  return (
    <>
      <Heading
        title="Área de membros"
        subtitle={
          producer
            ? "Crie aulas e disponibilize conteúdo aos seus compradores."
            : "Acesse suas aulas e acompanhe seu progresso."
        }
      >
        {producer && Boolean(products.data?.length) && (
          <Action onClick={() => edit("new")}>
            <Plus size={18} /> Nova aula
          </Action>
        )}
      </Heading>
      <Feedback status={task} />
      {editing && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{editing === "new" ? "Criar aula" : "Editar aula"}</h2>
            <button
              className="icon-button"
              onClick={() => edit(null)}
              aria-label="Fechar editor"
            >
              <X size={20} />
            </button>
          </div>
          <form
            key={editing === "new" ? editing : editing.id}
            className="form panel-form"
            onSubmit={(event) =>
              task.submit(
                event,
                async (data) => {
                  await api("aulas", {
                    id: editing === "new" ? undefined : editing.id,
                    product_id: data.get("product"),
                    module_id: data.has("module")
                      ? data.get("module")
                      : undefined,
                    title: data.get("title"),
                    content: data.get("content"),
                  });
                  edit(null);
                  refresh((value) => value + 1);
                },
                "Aula salva.",
              )
            }
          >
            {editing === "new" && (
              <label className="field">
                <span>Produto</span>
                <select
                  name="product"
                  value={productId ?? ""}
                  required
                  onChange={(event) => setNewProduct(event.target.value)}
                >
                  {products.data?.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modules.data && (
              <label className="field">
                <span>Módulo</span>
                <select
                  name="module"
                  key={productId}
                  defaultValue={
                    editing === "new" ? "" : (editing.module_id ?? "")
                  }
                >
                  <option value="">Sem módulo</option>
                  {forLesson.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Título</span>
              <input
                required
                name="title"
                minLength={3}
                maxLength={150}
                defaultValue={editing === "new" ? "" : editing.title}
              />
            </label>
            <label className="field">
              <span>Conteúdo da aula</span>
              <textarea
                required
                name="content"
                rows={8}
                maxLength={16000}
                defaultValue={editing === "new" ? "" : editing.content}
              />
            </label>
            <Action busy={task.busy} type="submit">
              Salvar aula
            </Action>
          </form>
        </section>
      )}
      {progress.error && <Notice>{progress.error}</Notice>}
      {modules.error && <Notice>{modules.error}</Notice>}
      <Data state={lessons}>
        {(items) => (
          <section className="panel">
            {items.length ? (
              items
                .toSorted(
                  (a, b) =>
                    a.product_id.localeCompare(b.product_id) ||
                    (moduleById.get(a.module_id ?? "")?.position ?? 201) -
                      (moduleById.get(b.module_id ?? "")?.position ?? 201),
                )
                .map((lesson) => {
                  const completed =
                    progress.data?.some(
                      (entry) => entry.lesson_id === lesson.id,
                    ) ?? false;
                  return (
                    <details className="lesson" key={lesson.id}>
                      <summary>
                        <BookOpen size={18} /> {lesson.title}
                        {lesson.module_id &&
                          moduleById.has(lesson.module_id) && (
                            <span className="pill">
                              {moduleById.get(lesson.module_id)?.title}
                            </span>
                          )}
                        {completed && (
                          <span className="pill pill-green">Concluída</span>
                        )}
                      </summary>
                      <p>{lesson.content}</p>
                      {producer ? (
                        <div className="actions">
                          <button
                            className="button secondary"
                            onClick={() => edit(lesson)}
                          >
                            Editar
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => remove(lesson.id)}
                          >
                            Excluir aula
                          </button>
                          {removing === lesson.id && (
                            <Action
                              busy={task.busy}
                              onClick={() =>
                                void task.run(async () => {
                                  await api("aulas", {
                                    id: lesson.id,
                                    remove: true,
                                  });
                                  remove(null);
                                  refresh((value) => value + 1);
                                }, "Aula excluída.")
                              }
                            >
                              Confirmar exclusão
                            </Action>
                          )}
                        </div>
                      ) : (
                        <Action
                          className="button secondary"
                          busy={task.busy}
                          onClick={() =>
                            void task.run(async () => {
                              await api("progresso", {
                                lesson_id: lesson.id,
                                completed: !completed,
                              });
                              refresh((value) => value + 1);
                            })
                          }
                        >
                          {completed ? "Desmarcar conclusão" : "Concluir aula"}
                        </Action>
                      )}
                    </details>
                  );
                })
            ) : (
              <Empty
                title="Nenhuma aula disponível"
                body={
                  producer
                    ? "Cadastre um produto e adicione sua primeira aula."
                    : "As aulas dos seus produtos adquiridos aparecem aqui após a aprovação do pagamento."
                }
              />
            )}
          </section>
        )}
      </Data>
    </>
  );
}

function Orders({ financial }: { financial: boolean }) {
  const orders = useData<Order[]>("pedidos");
  const [status, setStatus] = useState("all");
  return (
    <>
      <Heading
        title={financial ? "Financeiro" : "Vendas"}
        subtitle={
          financial
            ? "Consulte o resumo de vendas e as taxas registradas neste ambiente."
            : "Consulte as vendas registradas e acompanhe o status dos pedidos."
        }
      >
        <label className="period">
          <span className="sr-only">Filtrar por status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Todos os status</option>
            {Object.entries(orderStatus).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} />
        </label>
      </Heading>
      <Data state={orders}>
        {(list) => (
          <>
            {financial && (
              <div className="metrics">
                <article className="panel metric">
                  <span className="metric-icon">
                    <Wallet size={20} />
                  </span>
                  <p>Volume de vendas aprovadas</p>
                  <strong>{money(total(list))}</strong>
                </article>
                <article className="panel metric">
                  <p>Taxa da VENDEORA em vendas aprovadas</p>
                  <strong>
                    {money(
                      list
                        .filter((order) => order.status === "paid")
                        .reduce(
                          (sum, order) => sum + order.platform_fee_cents,
                          0,
                        ),
                    )}
                  </strong>
                </article>
              </div>
            )}
            <section className="panel">
              <OrderTable
                orders={
                  status === "all"
                    ? list
                    : list.filter((order) => order.status === status)
                }
              />
            </section>
          </>
        )}
      </Data>
    </>
  );
}

const privacyLabels: Record<string, string> = {
  export: "Acesso aos dados",
  correction: "Correção de dados",
  deletion: "Exclusão da conta",
};

function Account({ session }: { session: Session & { profile: Profile } }) {
  const profileTask = useTask();
  const passwordTask = useTask();
  const privacyTask = useTask();
  const [revision, refresh] = useState(0);
  const requests = useData<{ id: string; kind: string; status: string }[]>(
    "privacidade",
    revision,
  );
  return (
    <>
      <Heading
        title="Configurações"
        subtitle="Gerencie seu perfil, sua senha e suas solicitações de privacidade."
      />
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Dados do perfil</h2>
          </div>
          <form
            className="form panel-form"
            onSubmit={(event) =>
              profileTask.submit(
                event,
                async (data) => {
                  await api("perfil", { name: data.get("name") });
                },
                "Nome atualizado.",
              )
            }
          >
            <Feedback status={profileTask} />
            <label className="field">
              <span>Nome</span>
              <input
                required
                name="name"
                minLength={3}
                maxLength={120}
                defaultValue={session.profile.name}
              />
            </label>
            <label className="field">
              <span>E-mail da conta</span>
              <input readOnly value={session.email ?? ""} />
            </label>
            <Action type="submit" busy={profileTask.busy}>
              Salvar perfil
            </Action>
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Alterar senha</h2>
          </div>
          <form
            className="form panel-form"
            onSubmit={(event) =>
              passwordTask.submit(
                event,
                async (data) => {
                  await api("auth/senha", {
                    password: data.get("password"),
                    confirm: data.get("confirm"),
                  });
                },
                "Senha atualizada.",
              )
            }
          >
            <Feedback status={passwordTask} />
            <Password fresh />
            <Password fresh name="confirm" label="Confirmar senha" />
            <Action type="submit" busy={passwordTask.busy}>
              Atualizar senha
            </Action>
          </form>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Privacidade</h2>
          <a href="/privacidade" className="text-link">
            Ler política
          </a>
        </div>
        <form
          className="form panel-form"
          onSubmit={(event) =>
            privacyTask.submit(
              event,
              async (data) => {
                await api("privacidade", { kind: data.get("kind") });
                refresh((value) => value + 1);
              },
              "Solicitação registrada para análise.",
            )
          }
        >
          <Feedback status={privacyTask} />
          <label className="field">
            <span>Tipo de solicitação</span>
            <select required name="kind">
              {Object.entries(privacyLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Action type="submit" busy={privacyTask.busy}>
            Enviar solicitação
          </Action>
        </form>
        <Data state={requests}>
          {(list) =>
            list.map((request) => (
              <div className="list-row" key={request.id}>
                <strong>{privacyLabels[request.kind]}</strong>
                <span className="pill">
                  {request.status === "resolved" ? "Concluída" : "Em análise"}
                </span>
              </div>
            ))
          }
        </Data>
      </section>
    </>
  );
}

function AdminUsers() {
  const [revision, refresh] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const task = useTask();
  const mfa = useData<{ verified: boolean; factor: string | null }>(
    "auth/mfa",
    revision,
  );
  const profiles = useData<Profile[]>(
    mfa.data?.verified ? "usuarios" : null,
    revision,
  );
  const updated = () => refresh((value) => value + 1);
  return (
    <>
      <Heading
        title="Usuários"
        subtitle="Consulte os perfis e gerencie o acesso após validar a sessão."
      />
      <Feedback status={task} />
      {!mfa.data?.verified && (
        <Data state={mfa}>
          {(status) => <MfaPanel status={status} onVerified={updated} />}
        </Data>
      )}
      {mfa.data?.verified && (
        <Data state={profiles}>
          {(list) => (
            <section className="panel">
              {list.map((entry) => (
                <div className="list-row" key={entry.id}>
                  <div>
                    <strong>{entry.name}</strong>
                    <p>{roleLabel[entry.role]}</p>
                  </div>
                  <div className="actions">
                    <span className="pill">
                      {entry.active ? "Ativo" : "Suspenso"}
                    </span>
                    {entry.role !== "admin" &&
                      (confirm === entry.id ? (
                        <>
                          <Action
                            className="button secondary"
                            busy={task.busy}
                            onClick={() =>
                              void task.run(
                                async () => {
                                  await api("usuarios", {
                                    id: entry.id,
                                    active: !entry.active,
                                  });
                                  setConfirm(null);
                                  updated();
                                },
                                entry.active
                                  ? "Conta suspensa."
                                  : "Conta reativada.",
                              )
                            }
                          >
                            Confirmar
                          </Action>
                          <button
                            className="button secondary"
                            onClick={() => setConfirm(null)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          className="button secondary"
                          onClick={() => setConfirm(entry.id)}
                        >
                          {entry.active ? "Suspender" : "Reativar"}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </Data>
      )}
    </>
  );
}

export function Dashboard({
  page,
  session,
  confirmed,
  affiliateProductId,
}: {
  page: string;
  affiliateProductId?: string;
  session: Session & { profile: Profile };
  confirmed: boolean;
}) {
  const [open, showMenu] = useState(false);
  const logout = useTask();
  const profile = session.profile;
  const items = navigation.filter(
    (item) =>
      item.roles === "all" || item.roles.split(" ").includes(profile.role),
  );
  const productId = /^produtos\/([\da-f-]{36})$/i.exec(page)?.[1];
  const active = items.find((item) => item.id === (productId ? "produtos" : page));
  const products = active?.id === "produtos" && (
    productId && profile.role === "producer" ?
      <ProductDetail key={productId} id={productId} /> :
      <Products canEdit={profile.role === "producer"} />
  );
  return (
    <div className="dashboard">
      <button
        className={`mobile-overlay ${open ? "is-open" : ""}`}
        onClick={() => showMenu(false)}
        aria-label="Fechar navegação"
        tabIndex={open ? 0 : -1}
      />
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            <LayoutGrid size={19} />
          </span>
          <div>
            <strong>Meu espaço</strong>
            <small>{roleLabel[profile.role]}</small>
          </div>
        </div>
        <nav aria-label="Menu principal">
          {items.map(({ id, label, icon: Icon }) => (
            <a
              href={`/${id}`}
              key={id}
              className={active?.id === id ? "nav-current" : ""}
              aria-current={active?.id === id ? "page" : undefined}
            >
              <Icon size={19} /> {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="/ajuda">
            <CircleHelp size={18} /> Ajuda
          </a>
          <button
            onClick={() =>
              void logout.run(async () => {
                await api("auth/sair", {});
                window.location.assign("/entrar");
              })
            }
            disabled={logout.busy}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              aria-expanded={open}
              onClick={() => showMenu(!open)}
            >
              <Menu size={23} />
            </button>
            <span>{active?.label ?? "VENDEORA"}</span>
          </div>
          <a
            href="/configuracoes"
            className="top-profile"
            aria-label="Configurações da conta"
          >
            <span className="avatar">
              {profile.name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase()}
            </span>
            <span>{profile.name}</span>
          </a>
        </header>
        <main className="dashboard-content">
          <Feedback status={logout} />
          {confirmed && (
            <Notice success>
              E-mail confirmado. Sua conta está pronta para uso.
            </Notice>
          )}
          {!active && (
            <section className="panel">
              <Empty
                title="Página indisponível"
                body="Seu perfil pode acessar os módulos listados no menu."
              >
                <a className="text-link" href="/dashboard">
                  Voltar à visão geral
                </a>
              </Empty>
            </section>
          )}
          {active?.id === "dashboard" && <Overview profile={profile} />}
          {products}
          {active?.id === "marketplace" && <Marketplace role={profile.role} />}
          {active?.id === "checkout" && (
            <>
              <CheckoutLinks />
              <CheckoutEditor />
            </>
          )}
          {active?.id === "afiliados" && (
            <Affiliates producer={profile.role === "producer"} productId={affiliateProductId} />
          )}
          {active?.id === "membros" && (
            <>
              <Members producer={profile.role === "producer"} />
              <PackLibrary />
            </>
          )}
          {active?.id === "packs" && <PackCatalog />}
          {active?.id === "vendas" && <Orders financial={false} />}
          {active?.id === "financeiro" && (
            <>
              <Orders financial />
              {profile.role === "producer" && <StripePanel />}
            </>
          )}
          {active?.id === "configuracoes" && <Account session={session} />}
          {active?.id === "usuarios" && <AdminUsers />}
          {active?.id === "clientes" && <Customers />}
          {active?.id === "relatorios" && <Reports />}
          {active?.id === "notificacoes" && <Notifications />}
          {active?.id === "suporte" && (
            <Support admin={profile.role === "admin"} />
          )}
          {active?.id === "modulos" && <CourseModules />}
        </main>
      </div>
    </div>
  );
}
