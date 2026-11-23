"use client";

import { Bell, Download, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { brazilToday } from "../lib/identity";
import { Data, Heading, useData } from "./panel";
import {
  Action,
  api,
  dateLabel,
  Empty,
  Feedback,
  money,
  useTask,
  type Order,
  type Product,
} from "./shared";

type Customer = {
  id: string;
  name: string;
  email: string;
  purchase_count: number;
  total_cents: number;
  last_purchase: string | null;
};
type Summary = {
  day: string;
  approved: number;
  pending: number;
  declined: number;
  refunded: number;
  gross_cents: number;
  refunded_cents: number;
};
type Ticket = {
  id: string;
  subject: string;
  message: string;
  status: string;
  response: string | null;
  created_at: string;
};
export type CourseModule = {
  id: string;
  product_id: string;
  title: string;
  position: number;
};

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const string = String(value);
    const safe = /^\s*[=+\-@\t\r]/.test(string) ? `'${string}` : string;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(
    ["\ufeff", rows.map((row) => row.map(escape).join(";")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Customers() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(
    () => setSelected(new URLSearchParams(location.search).get("id")),
    [],
  );
  const list = useData<Customer[]>(selected ? null : "clientes");
  const detail = useData<{ customer: Customer; orders: Order[] }>(
    selected ? `clientes?id=${encodeURIComponent(selected)}` : null,
  );
  const filtered =
    list.data?.filter((customer) =>
      `${customer.name} ${customer.email}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.trim().toLocaleLowerCase("pt-BR")),
    ) ?? [];
  if (selected)
    return (
      <>
        <Heading
          title="Histórico do cliente"
          subtitle="Consulte as compras feitas dos seus produtos."
        >
          <a className="button secondary" href="/clientes">
            Todos os clientes
          </a>
        </Heading>
        <Data state={detail}>
          {({ customer, orders }) => (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{customer.name}</h2>
                  <p>{customer.email}</p>
                </div>
                <strong>{money(customer.total_cents)}</strong>
              </div>
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
                          {{
                            paid: "Aprovado",
                            pending: "Pendente",
                            refunded: "Reembolsado",
                            failed: "Recusado",
                            expired: "Expirado",
                          }[order.status] ?? order.status}
                        </td>
                        <td>{money(order.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </Data>
      </>
    );
  return (
    <>
      <Heading
        title="Clientes"
        subtitle="Encontre compradores com pedidos aprovados dos seus produtos."
      />
      <section className="panel">
        <div className="panel-heading">
          <label className="field">
            <span className="sr-only">Buscar cliente por nome ou e-mail</span>
            <input
              type="search"
              placeholder="Buscar por nome ou e-mail"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {filtered.length > 0 && (
            <button
              className="button secondary"
              onClick={() =>
                downloadCsv("vendeora-clientes.csv", [
                  ["Nome", "E-mail", "Compras", "Total em BRL"],
                  ...filtered.map((customer) => [
                    customer.name,
                    customer.email,
                    customer.purchase_count,
                    (customer.total_cents / 100).toFixed(2),
                  ]),
                ])
              }
            >
              <Download size={16} /> Exportar CSV
            </button>
          )}
        </div>
        <Data state={list}>
          {() =>
            filtered.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Compras</th>
                      <th>Total</th>
                      <th>Última compra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((customer) => (
                      <tr key={customer.id}>
                        <td>
                          <a
                            className="text-link"
                            href={`/clientes?id=${customer.id}`}
                          >
                            {customer.name}
                          </a>
                          <p className="muted">{customer.email}</p>
                        </td>
                        <td>{customer.purchase_count}</td>
                        <td>{money(customer.total_cents)}</td>
                        <td>
                          {customer.last_purchase
                            ? dateLabel(customer.last_purchase)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Nenhum cliente encontrado"
                body="Os compradores aparecem depois que um pedido é aprovado."
              />
            )
          }
        </Data>
      </section>
    </>
  );
}

export function Reports() {
  const today = brazilToday();
  const startingDay = brazilToday(new Date(Date.now() - 29 * 86400000));
  const [period, setPeriod] = useState({ from: startingDay, to: today });
  const summary = useData<Summary[]>(
    `relatorios?de=${period.from}&ate=${period.to}`,
  );
  return (
    <>
      <Heading
        title="Relatórios"
        subtitle="Analise os pedidos registrados no banco por dia e por status."
      />
      <section className="panel">
        <form
          className="panel-form form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            setPeriod({
              from: String(values.get("from")),
              to: String(values.get("to")),
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>De</span>
              <input
                type="date"
                required
                name="from"
                defaultValue={startingDay}
                max={today}
              />
            </label>
            <label className="field">
              <span>Até</span>
              <input
                type="date"
                required
                name="to"
                defaultValue={today}
                max={today}
              />
            </label>
          </div>
          <Action type="submit">Aplicar período</Action>
        </form>
      </section>
      <Data state={summary}>
        {(list) =>
          list.length ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Vendas por dia</h2>
                <button
                  className="button secondary"
                  onClick={() =>
                    downloadCsv("vendeora-relatorio.csv", [
                      [
                        "Data",
                        "Aprovados",
                        "Pendentes",
                        "Recusados ou expirados",
                        "Reembolsados",
                        "Aprovados em BRL",
                        "Reembolsos em BRL",
                      ],
                      ...list.map((record) => [
                        record.day,
                        record.approved,
                        record.pending,
                        record.declined,
                        record.refunded,
                        (record.gross_cents / 100).toFixed(2),
                        (record.refunded_cents / 100).toFixed(2),
                      ]),
                    ])
                  }
                >
                  <Download size={16} /> Exportar CSV
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Dia</th>
                      <th>Aprovados</th>
                      <th>Pendentes</th>
                      <th>Recusados/expirados</th>
                      <th>Reembolsados</th>
                      <th>Total aprovado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((record) => (
                      <tr key={record.day}>
                        <td>{record.day.split("-").reverse().join("/")}</td>
                        <td>{record.approved}</td>
                        <td>{record.pending}</td>
                        <td>{record.declined}</td>
                        <td>{record.refunded}</td>
                        <td>{money(record.gross_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="panel">
              <Empty
                title="Sem pedidos neste período"
                body="Escolha um período diferente para consultar o histórico."
              />
            </section>
          )
        }
      </Data>
    </>
  );
}

const events: Record<string, { title: string; link: (id: string) => string }> =
  {
    payment_approved: {
      title: "Pagamento aprovado",
      link: (id) => `/pedido/${id}`,
    },
    payment_failed: {
      title: "Pagamento recusado",
      link: (id) => `/pedido/${id}`,
    },
    affiliate_requested: {
      title: "Nova solicitação de afiliação",
      link: () => "/afiliados",
    },
    affiliate_approved: {
      title: "Afiliação aprovada",
      link: () => "/afiliados",
    },
    affiliate_declined: {
      title: "Afiliação recusada",
      link: () => "/afiliados",
    },
    support_reply: { title: "Resposta do suporte", link: () => "/suporte" },
  };

export function Notifications() {
  const [revision, refresh] = useState(0);
  const [unread, showUnread] = useState(false);
  const task = useTask();
  const state = useData<
    {
      id: string;
      event: string;
      target_id: string;
      created_at: string;
      read_at: string | null;
    }[]
  >(unread ? "notificacoes?filtro=nao-lidas" : "notificacoes", revision);
  return (
    <>
      <Heading
        title="Notificações"
        subtitle="Acompanhe pagamentos, solicitações de afiliação e respostas de suporte."
      >
        <label className="check">
          <input
            type="checkbox"
            checked={unread}
            onChange={(event) => showUnread(event.target.checked)}
          />{" "}
          Apenas não lidas
        </label>
      </Heading>
      <Feedback status={task} />
      <Data state={state}>
        {(items) => (
          <section className="panel">
            {items.length ? (
              items.map((item) => {
                const event = events[item.event];
                return (
                  <div className="list-row" key={item.id}>
                    <div>
                      <strong>
                        <Bell size={15} /> {event?.title ?? "Atualização"}
                      </strong>
                      <p>{dateLabel(item.created_at)}</p>
                    </div>
                    <div className="actions">
                      {event && (
                        <a
                          className="button secondary"
                          href={event.link(item.target_id)}
                        >
                          Abrir
                        </a>
                      )}
                      {!item.read_at && (
                        <Action
                          className="button secondary"
                          busy={task.busy}
                          onClick={() =>
                            void task.run(async () => {
                              await api("notificacoes", { id: item.id });
                              refresh((previous) => previous + 1);
                            })
                          }
                        >
                          Marcar como lida
                        </Action>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty
                title="Tudo em dia"
                body="As novidades da sua conta aparecem aqui."
              />
            )}
          </section>
        )}
      </Data>
    </>
  );
}

type MfaStatus = { verified: boolean; factor: string | null };

export function MfaPanel({
  status,
  onVerified,
}: {
  status: MfaStatus;
  onVerified: () => void;
}) {
  const [enrollment, setEnrollment] = useState<{
    factor: string;
    secret: string;
  }>();
  const task = useTask();
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Verificação em duas etapas</h2>
        <ShieldCheck size={20} />
      </div>
      <div className="panel-form form">
        <Feedback status={task} />
        {status.verified ? (
          <p>Esta sessão já foi verificada.</p>
        ) : (
          <>
            {enrollment && (
              <div className="review">
                <div>
                  <strong>
                    Adicione a chave no seu aplicativo autenticador.
                  </strong>
                  <p>{enrollment.secret}</p>
                </div>
              </div>
            )}
            {status.factor || enrollment ? (
              <form
                className="form"
                onSubmit={(event) =>
                  task.submit(
                    event,
                    async (data) => {
                      await api("auth/mfa", {
                        action: "verify",
                        factor: enrollment?.factor ?? status.factor,
                        code: data.get("code"),
                      });
                      setEnrollment(undefined);
                      onVerified();
                    },
                    "Sessão verificada.",
                  )
                }
              >
                <label className="field">
                  <span>Código do autenticador</span>
                  <input
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                  />
                </label>
                <Action type="submit" busy={task.busy}>
                  Verificar código
                </Action>
              </form>
            ) : (
              <>
                <p>
                  Use um aplicativo autenticador para validar as ações
                  administrativas.
                </p>
                <Action
                  busy={task.busy}
                  onClick={() =>
                    void task.run(async () => {
                      setEnrollment(
                        await api("auth/mfa", { action: "enroll" }),
                      );
                    })
                  }
                >
                  Configurar autenticador
                </Action>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function Support({ admin }: { admin: boolean }) {
  const [revision, refresh] = useState(0);
  const [team, viewTeam] = useState(false);
  const task = useTask();
  const mfa = useData<MfaStatus>(team ? "auth/mfa" : null, revision);
  const tickets = useData<Ticket[]>(
    team ? (mfa.data?.verified ? "suporte?view=equipe" : null) : "suporte",
    revision,
  );
  const update = () => refresh((previous) => previous + 1);
  return (
    <>
      <Heading
        title="Suporte"
        subtitle="Abra chamados e acompanhe as respostas dentro da plataforma."
      >
        {admin && (
          <label className="check">
            <input
              type="checkbox"
              checked={team}
              onChange={(event) => viewTeam(event.target.checked)}
            />{" "}
            Atendimento da equipe
          </label>
        )}
      </Heading>
      <Feedback status={task} />
      {team && (!mfa.data?.verified || mfa.error) && (
        <Data state={mfa}>
          {(status) => <MfaPanel status={status} onVerified={update} />}
        </Data>
      )}
      {!team && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Novo chamado</h2>
          </div>
          <form
            className="panel-form form"
            onSubmit={(event) => {
              const form = event.currentTarget;
              task.submit(
                event,
                async (data) => {
                  await api("suporte", {
                    subject: data.get("subject"),
                    message: data.get("message"),
                  });
                  form.reset();
                  update();
                },
                "Chamado registrado.",
              );
            }}
          >
            <label className="field">
              <span>Assunto</span>
              <input name="subject" minLength={5} maxLength={120} required />
            </label>
            <label className="field">
              <span>Mensagem</span>
              <textarea
                name="message"
                rows={4}
                minLength={10}
                maxLength={5000}
                required
              />
            </label>
            <Action type="submit" busy={task.busy}>
              Enviar chamado
            </Action>
          </form>
        </section>
      )}
      {(!team || mfa.data?.verified) && (
        <Data state={tickets}>
          {(items) => (
            <section className="panel">
              {items.length ? (
                items.map((ticket) => (
                  <details key={ticket.id} className="lesson">
                    <summary>
                      {ticket.subject}{" "}
                      <span className="pill">
                        {{
                          open: "Aberto",
                          answered: "Respondido",
                          closed: "Encerrado",
                        }[ticket.status] ?? ticket.status}
                      </span>
                    </summary>
                    <p>{ticket.message}</p>
                    {ticket.response && (
                      <p>
                        <strong>Equipe VENDEORA: </strong>
                        {ticket.response}
                      </p>
                    )}
                    {team && ticket.status !== "closed" && (
                      <form
                        className="form"
                        onSubmit={(event) =>
                          task.submit(
                            event,
                            async (data) => {
                              await api("suporte", {
                                id: ticket.id,
                                response: data.get("response"),
                                close: data.get("close") === "on",
                              });
                              update();
                            },
                            "Resposta registrada.",
                          )
                        }
                      >
                        <label className="field">
                          <span>Resposta</span>
                          <textarea
                            name="response"
                            rows={3}
                            minLength={5}
                            maxLength={5000}
                            defaultValue={ticket.response ?? ""}
                            required
                          />
                        </label>
                        <label className="check">
                          <input name="close" type="checkbox" /> Encerrar após
                          responder
                        </label>
                        <Action busy={task.busy} type="submit">
                          Responder
                        </Action>
                      </form>
                    )}
                  </details>
                ))
              ) : (
                <Empty
                  title="Nenhum chamado"
                  body="O histórico de atendimento fica disponível aqui."
                />
              )}
            </section>
          )}
        </Data>
      )}
    </>
  );
}

export function CourseModules() {
  const [edit, setEdit] = useState<CourseModule | "new" | null>(null);
  const [revision, refresh] = useState(0);
  const task = useTask();
  const products = useData<Product[]>("produtos");
  const modules = useData<CourseModule[]>("modulos", revision);
  const update = () => {
    setEdit(null);
    refresh((previous) => previous + 1);
  };
  return (
    <>
      <Heading
        title="Módulos dos cursos"
        subtitle="Organize as aulas em módulos e escolha a ordem em que aparecem."
      >
        {Boolean(products.data?.length) && (
          <Action onClick={() => setEdit("new")}>
            <Plus size={18} /> Novo módulo
          </Action>
        )}
      </Heading>
      <Feedback status={task} />
      {edit && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{edit === "new" ? "Criar módulo" : "Editar módulo"}</h2>
            <button className="button secondary" onClick={() => setEdit(null)}>
              Cancelar
            </button>
          </div>
          <form
            className="panel-form form"
            key={edit === "new" ? "new" : edit.id}
            onSubmit={(event) =>
              task.submit(
                event,
                async (data) => {
                  await api("modulos", {
                    id: edit === "new" ? undefined : edit.id,
                    product_id: data.get("product"),
                    title: data.get("title"),
                    position: data.get("position"),
                  });
                  update();
                },
                "Módulo salvo.",
              )
            }
          >
            {edit === "new" && (
              <label className="field">
                <span>Produto</span>
                <select name="product" required>
                  {products.data?.map((product) => (
                    <option value={product.id} key={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Título</span>
              <input
                name="title"
                required
                minLength={3}
                maxLength={150}
                defaultValue={edit === "new" ? "" : edit.title}
              />
            </label>
            <label className="field">
              <span>Posição</span>
              <input
                name="position"
                type="number"
                min={1}
                max={200}
                required
                defaultValue={edit === "new" ? 1 : edit.position}
              />
            </label>
            <Action type="submit" busy={task.busy}>
              Salvar módulo
            </Action>
          </form>
        </section>
      )}
      <Data state={modules}>
        {(items) => (
          <section className="panel">
            {items.length ? (
              items.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {products.data?.find(
                        (product) => product.id === item.product_id,
                      )?.title ?? "Produto arquivado"}{" "}
                      · posição {item.position}
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => setEdit(item)}
                  >
                    Editar
                  </button>
                </div>
              ))
            ) : (
              <Empty
                title="Primeiro módulo"
                body="Crie um produto e adicione módulos para separar os assuntos do curso."
              />
            )}
          </section>
        )}
      </Data>
    </>
  );
}
