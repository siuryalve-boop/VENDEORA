"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, Notice } from "./shared";

export function useData<T>(endpoint: string | null, refresh = 0, interval = 0) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    setState({});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const data = await api<T>(endpoint, undefined, controller.signal);
        if (!controller.signal.aborted) setState({ data });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({ error: error instanceof Error ? error.message : "Falha ao carregar." });
      } finally {
        if (interval && !controller.signal.aborted)
          timer = setTimeout(load, interval);
      }
    };
    void load();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, refresh, interval]);
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
