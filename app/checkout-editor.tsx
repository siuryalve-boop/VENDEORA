"use client";

import { useState } from "react";
import { Data, useData } from "./panel";
import {
  Action,
  api,
  Empty,
  Feedback,
  money,
  useTask,
  type Product,
} from "./shared";

type Style = { headline: string; accent: string };
type Coupon = { id: string; code: string; percent: number; active: boolean };

export function CheckoutEditor() {
  const [selected, setSelected] = useState("");
  const products = useData<Product[]>("produtos");
  const id = selected || products.data?.[0]?.id;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Personalizar checkout</h2>
      </div>
      <Data state={products}>
        {(items) => {
          const product = items.find((item) => item.id === id);
          return product ? (
            <div className="panel-form form">
              <label className="field">
                <span>Produto</span>
                <select
                  value={id}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  {items.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>
              <CheckoutFields key={product.id} product={product} />
            </div>
          ) : (
            <Empty
              title="Sem produtos para personalizar"
              body="Cadastre um produto para editar o checkout ou criar um cupom."
            />
          );
        }}
      </Data>
    </section>
  );
}

export function CheckoutFields({ product }: { product: Product }) {
  const { id } = product;
  const [revision, refresh] = useState(0);
  const [color, setColor] = useState<string>();
  const [headline, setHeadline] = useState<string>();
  const task = useTask();
  const couponsTask = useTask();
  const settings = useData<{ style: Style | null; coupons: Coupon[] }>(
    `checkout/config?id=${id}`,
    revision,
  );
  const saved = () => refresh((value) => value + 1);
  return (
    <>
      <Feedback status={task} />
      <Feedback status={couponsTask} />
      <Data state={settings}>
        {({ style, coupons }) => (
          <>
            <form
              className="form"
              onSubmit={(event) =>
                task.submit(
                  event,
                  async (data) => {
                    await api("checkout/config", {
                      product_id: id,
                      headline: data.get("headline"),
                      accent: data.get("accent"),
                    });
                    saved();
                  },
                  "Checkout atualizado.",
                )
              }
            >
              <label className="field">
                <span>Chamada do checkout</span>
                <input
                  name="headline"
                  maxLength={140}
                  value={headline ?? style?.headline ?? ""}
                  onChange={(event) => setHeadline(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Cor de destaque</span>
                <input
                  name="accent"
                  type="color"
                  value={color ?? style?.accent ?? "#d94e0b"}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
              <Action type="submit" busy={task.busy}>
                Salvar aparência
              </Action>
            </form>
            <section
              aria-label="Prévia do checkout"
              className="panel panel-form form"
              style={{
                borderTop: `4px solid ${color ?? style?.accent ?? "#d94e0b"}`,
                overflowWrap: "anywhere",
              }}
            >
              <p className="muted">Prévia do checkout</p>
              <h2>{(headline ?? style?.headline)?.trim() || product.title}</h2>
              {(headline ?? style?.headline)?.trim() && (
                <strong>{product.title}</strong>
              )}
              {product.description && <p>{product.description}</p>}
              <p>
                <strong>{money(product.price_cents)}</strong>
              </p>
              <p className="muted">
                Preço antes de descontos. A prévia acompanha as alterações do
                editor.
              </p>
            </section>
            <h2>Cupons de desconto</h2>
            <form
              className="form"
              onSubmit={(event) => {
                const form = event.currentTarget;
                couponsTask.submit(
                  event,
                  async (data) => {
                    await api("cupons", {
                      product_id: id,
                      code: data.get("code"),
                      percent: data.get("percent"),
                    });
                    form.reset();
                    saved();
                  },
                  "Cupom criado.",
                );
              }}
            >
              <div className="form-grid">
                <label className="field">
                  <span>Código</span>
                  <input
                    name="code"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[A-Za-z0-9\-]{3,32}"
                    placeholder="PRIMEIRACOMPRA"
                  />
                </label>
                <label className="field">
                  <span>Desconto (%)</span>
                  <input
                    name="percent"
                    type="number"
                    min={1}
                    max={90}
                    required
                  />
                </label>
              </div>
              <Action type="submit" busy={couponsTask.busy}>
                Criar cupom
              </Action>
            </form>
            {coupons.map((coupon) => (
              <div className="list-row" key={coupon.id}>
                <div>
                  <strong>{coupon.code}</strong>
                  <p>
                    {coupon.percent}% de desconto ·{" "}
                    {coupon.active ? "Ativo" : "Pausado"}
                  </p>
                </div>
                <Action
                  className="button secondary"
                  busy={couponsTask.busy}
                  onClick={() =>
                    void couponsTask.run(async () => {
                      await api("cupons", {
                        id: coupon.id,
                        active: !coupon.active,
                      });
                      saved();
                    }, "Cupom atualizado.")
                  }
                >
                  {coupon.active ? "Pausar" : "Reativar"}
                </Action>
              </div>
            ))}
          </>
        )}
      </Data>
    </>
  );
}
