"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, Notice } from "./shared";

export function useData<T>(endpoint: string | null, refresh = 0) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    setState({});
    api<T>(endpoint, undefined, controller.signal)
      .then((data) => setState({ data }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error.message });
      });
    return () => controller.abort();
  }, [endpoint, refresh]);
  return state;
}

export function Data<T>({
  state,
  children,
}: {
  state: { data?: T; error?: string };
  children: (value: T) => ReactNode;
}) {
  if (state.error) return <Notice>{state.error}</Notice>;
  if (state.data === undefined)
    return (
      <div className="skeleton" role="status" aria-label="Carregando dados" />
    );
  return children(state.data);
}

export function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
