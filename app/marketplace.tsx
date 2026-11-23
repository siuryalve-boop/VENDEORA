"use client";

import { Boxes, ExternalLink, Search, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Data, Heading, useData } from "./panel";
import { Action, api, Empty, Feedback, money, Notice, types, useTask, type Profile } from "./shared";

type MarketProduct = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  sales_count: number;
  affiliates_enabled: boolean;
  commission_percent: number;
  owned: boolean;
  application_status: "pending" | "approved" | "declined" | null;
  affiliate_link_id: string | null;
};

const applicationLabels = {
  pending: "Afiliação pendente",
  approved: "Afiliação aprovada",
  declined: "Afiliação recusada",
};

export function Marketplace({ role }: { role: Profile["role"] }) {
  const [filter, setFilter] = useState("");
  const [revision, refresh] = useState(0);
  const products = useData<MarketProduct[]>(`marketplace?${filter}`, revision);
  const task = useTask();

  return (
    <>
      <Heading title="Marketplace" subtitle="Explore produtos digitais e encontre oportunidades de afiliação." />
      <form
        className="panel panel-form marketplace-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setFilter(new URLSearchParams({
            q: String(data.get("q") ?? "").trim(),
            category: String(data.get("category") ?? ""),
            ranking: String(data.get("ranking") ?? "popular"),
          }).toString());
        }}
      >
        <label className="field">
          <span>Buscar produto</span>
          <input name="q" type="search" maxLength={120} placeholder="Nome ou descrição" />
        </label>
        <label className="field">
          <span>Categoria</span>
          <select name="category">
            <option value="">Todas as categorias</option>
            {types.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Ordenar por</span>
          <select name="ranking">
            <option value="popular">Mais vendidos</option>
            <option value="recent">Mais recentes</option>
          </select>
        </label>
        <Action type="submit"><Search size={17} /> Buscar</Action>
      </form>
      {role === "affiliate" && (
        <Notice>As solicitações e os links de afiliação estão disponíveis. O repasse de comissões ainda está em testes.</Notice>
      )}
      <Feedback status={task} />
      <Data state={products}>
        {(items) => !items.length ? (
          <section className="panel">
            <Empty title="Nenhum produto encontrado" body="Os produtos publicados aparecem aqui de acordo com os filtros." />
          </section>
        ) : (
          <div className="product-grid">
            {items.map((product) => (
              <article key={product.id} className="panel product-card">
                <div className={`product-art art-${types.indexOf(product.category) % 4}`}>
                  <Boxes size={36} aria-hidden="true" />
                </div>
                <div className="product-body marketplace-product">
                  <span className="product-type">{product.category}</span>
                  <h2>{product.title}</h2>
                  {product.description && <p>{product.description}</p>}
                  <strong>{money(product.price_cents)}</strong>
                  <div className="actions">
                    {product.sales_count > 0 && (
                      <span className="marketplace-sales">
                        <TrendingUp size={15} aria-hidden="true" />
                        {product.sales_count} {product.sales_count === 1 ? "venda" : "vendas"}
                      </span>
                    )}
                    {product.affiliates_enabled && (
                      <span className="pill">{product.commission_percent}% de comissão configurada</span>
                    )}
                  </div>
                  <div className="actions">
                    <a className="button secondary" href={product.owned ? `/produtos/${product.id}` : `/checkout/${product.id}`}>
                      {product.owned ? "Gerenciar produto" : "Ver oferta"} <ExternalLink size={15} />
                    </a>
                    {role === "affiliate" && product.application_status && (
                      <span className="pill">{applicationLabels[product.application_status]}</span>
                    )}
                    {role === "affiliate" && product.affiliates_enabled && !product.application_status && (
                      <Action busy={task.busy} onClick={() => void task.run(async () => {
                        await api("afiliacoes", { product_id: product.id });
                        refresh((value) => value + 1);
                      }, "Solicitação enviada ao produtor.")}>
                        Solicitar afiliação
                      </Action>
                    )}
                    {role === "affiliate" && product.affiliates_enabled && product.affiliate_link_id && (
                      <Action className="button secondary" busy={task.busy} onClick={() => void task.run(async () => {
                        await navigator.clipboard.writeText(`${location.origin}/checkout/${product.id}?ref=${product.affiliate_link_id}`);
                      }, "Link de afiliado copiado.")}>
                        Copiar link de afiliado
                      </Action>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Data>
    </>
  );
}
