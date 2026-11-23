"use client";

import {
  AlertCircle,
  ArrowUpRight,
  Box,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

export type Profile = {
  id: string;
  name: string;
  role: "producer" | "affiliate" | "student" | "admin";
  active: boolean;
};
export type Session = { profile: Profile | null; email: string | null };
export type Product = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  active: boolean;
  affiliates_enabled: boolean;
  commission_percent?: number;
};
export type Order = {
  id: string;
  product_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  paid_at: string | null;
  payment_mode: "test" | "live";
  platform_fee_cents: number;
};

export const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(
    new Date(date),
  );
export const roleLabel: Record<Profile["role"], string> = {
  producer: "Produtor",
  affiliate: "Afiliado",
  student: "Aluno",
  admin: "Administrador",
};
export const types = [
  "Curso online",
  "E-book",
  "PDF",
  "Mentoria",
  "Consultoria",
  "Assinatura",
  "Comunidade",
  "Outros",
];

export async function api<T>(
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null)
    throw new Error(data?.error ?? "Não foi possível completar a solicitação.");
  return data as T;
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <a
      className={`brand ${light ? "brand-light" : ""}`}
      href="/"
      aria-label="VENDEORA, início"
    >
      <img src="/marca.png" width="39" height="39" alt="" />
      <span>
        vendeora<span className="brand-dot">.</span>
      </span>
    </a>
  );
}

export function Notice({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`notice ${success ? "notice-success" : ""}`}
      role={success ? "status" : "alert"}
    >
      {success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{children}</span>
    </div>
  );
}

export function Password({
  name = "password",
  label = "Senha",
  fresh = false,
  onChange,
  value,
}: {
  name?: string;
  label?: string;
  fresh?: boolean;
  onChange?: (value: string) => void;
  value?: string;
}) {
  const [visible, show] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="password-wrap">
        <input
          required
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={fresh ? "new-password" : "current-password"}
          minLength={fresh ? 10 : 1}
          maxLength={72}
          placeholder={fresh ? "Pelo menos 10 caracteres" : "Sua senha"}
          value={value}
          onChange={onChange && ((event) => onChange(event.target.value))}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => show(!visible)}
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function run(action: () => Promise<void>, message = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "A solicitação falhou.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(
    event: FormEvent<HTMLFormElement>,
    action: (data: FormData) => Promise<void>,
    message = "",
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => action(form), message);
  }
  return { busy, error, success, run, submit, setError };
}

export function Feedback({
  status,
}: {
  status: { error: string; success: string };
}) {
  return (
    <>
      {status.error && <Notice>{status.error}</Notice>}
      {status.success && <Notice success>{status.success}</Notice>}
    </>
  );
}

export function Action({
  children,
  busy,
  className = "button primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className={className} {...props} disabled={busy || props.disabled}>
      {busy && <LoaderCircle className="spin" size={17} />}
      {children}
    </button>
  );
}

export function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Box size={23} />
      </span>
      <strong>{title}</strong>
      <p>{body}</p>
      {children}
    </div>
  );
}

export function AuthArt() {
  return (
    <aside className="auth-art" aria-label="VENDEORA">
      <div className="art-inner">
        <span className="art-label">
          <span /> PLATAFORMA DE PRODUTOS DIGITAIS
        </span>
        <h2>
          Seu conhecimento.
          <br />
          Seu negócio.
          <br />
          <em>Seu crescimento.</em>
        </h2>
        <p>
          Organize seus produtos, acompanhe vendas e cuide da experiência dos
          seus alunos em um só lugar.
        </p>
      </div>
      <div className="growth-art" aria-hidden="true">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-chart">
          <span className="art-chart-icon">
            <TrendingUp size={22} />
          </span>
          <div className="graphic-line" />
          <div className="graphic-line short" />
          <div className="art-bars">
            {[22, 35, 30, 53, 46, 73, 64, 93, 84, 115].map((height, i) => (
              <i key={i} style={{ height }} />
            ))}
          </div>
        </div>
        <div className="art-float art-wallet">
          <Wallet size={26} />
        </div>
        <div className="art-float art-arrow">
          <ArrowUpRight size={31} />
        </div>
        <span className="art-spark spark-one">✦</span>
        <span className="art-spark spark-two">✧</span>
      </div>
    </aside>
  );
}
