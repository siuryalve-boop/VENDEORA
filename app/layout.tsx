import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./style.css";

export const metadata: Metadata = {
  title: "VENDEORA | Seu negócio digital",
  description:
    "Gerencie produtos digitais, vendas, afiliados e aulas na VENDEORA.",
  icons: { icon: "/marca.png" },
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
