export const digits = (value: string) => value.replace(/\D/g, "");

export function validCpf(value: string) {
  if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value)) return false;
  const cpf = digits(value);
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  return [9, 10].every((position) => {
    const sum = [...cpf.slice(0, position)].reduce(
      (total, digit, index) => total + Number(digit) * (position + 1 - index),
      0,
    );
    return ((sum * 10) % 11) % 10 === Number(cpf[position]);
  });
}

export function brazilToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((item) => item.type === type)?.value)
    .join("-");
}

export function birthDateError(value: string, today = brazilToday()) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > today
  )
    return "Informe uma data de nascimento válida.";
  const parsed = new Date(value + "T00:00:00Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    return "Informe uma data de nascimento válida.";
  const years =
    Number(today.slice(0, 4)) -
    Number(value.slice(0, 4)) -
    Number(today.slice(5) < value.slice(5));
  return years < 18 ? "O cadastro exige 18 anos completos." : null;
}

export function validPhone(value: string) {
  return (
    /^[\d() +\-]+$/.test(value) &&
    /^(?:55)?[1-9][1-9](?:9\d{8}|[2-5]\d{7})$/.test(digits(value))
  );
}

export const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPassword = (value: string) =>
  value.length >= 10 && new TextEncoder().encode(value).length <= 72;
export const termsVersion = "2026-11-22";

export type Registration = {
  name: string;
  cpf: string;
  birth: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  role: string;
};

export function registrationErrors(data: Registration) {
  return {
    name:
      data.name.trim().length >= 3 &&
      data.name.trim().length <= 120 &&
      data.name.trim().includes(" ")
        ? null
        : "Informe seu nome completo.",
    cpf: validCpf(data.cpf) ? null : "Informe um CPF válido.",
    birth: birthDateError(data.birth),
    email: validEmail(data.email.trim()) ? null : "Informe um e-mail válido.",
    phone: validPhone(data.phone)
      ? null
      : "Informe um telefone válido com DDD.",
    password: validPassword(data.password)
      ? null
      : "Use pelo menos 10 caracteres (até 72 bytes).",
    confirm:
      data.password === data.confirm ? null : "As senhas precisam ser iguais.",
    role: ["producer", "affiliate", "student"].includes(data.role)
      ? null
      : "Escolha um tipo de conta válido.",
  };
}
