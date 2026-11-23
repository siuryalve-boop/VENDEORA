import { test } from "node:test";
import assert from "node:assert/strict";
import {
  birthDateError,
  brazilToday,
  registrationErrors,
  validCpf,
  validPhone,
} from "../lib/identity.ts";

test("CPF verifies both digits and rejects malformed and repeated values", () => {
  assert.equal(validCpf("123.456.789-09"), true);
  assert.equal(validCpf("12345678909"), true);
  for (const cpf of [
    "12345678900",
    "111.111.111-11",
    "123.45678909",
    "x12345678909",
    "123",
  ])
    assert.equal(validCpf(cpf), false);
});

test("age uses the Brazilian calendar and allows exactly 18", () => {
  assert.equal(brazilToday(new Date("2026-11-23T01:30:00Z")), "2026-11-22");
  assert.equal(birthDateError("2008-11-22", "2026-11-22"), null);
  assert.match(birthDateError("2008-11-23", "2026-11-22") ?? "", /18 anos/);
  assert.match(birthDateError("2007-02-29", "2026-11-22") ?? "", /válida/);
  assert.match(birthDateError("2027-01-01", "2026-11-22") ?? "", /válida/);
});

test("Brazilian registration accepts valid mobile and landline and checks confirmation", () => {
  assert.equal(validPhone("+55 (11) 91234-5678"), true);
  assert.equal(validPhone("(11) 3234-5678"), true);
  assert.equal(validPhone("(01) 91234-5678"), false);
  const data = {
    name: "Pessoa Teste",
    cpf: "12345678909",
    birth: "1990-01-01",
    email: "teste@example.invalid",
    phone: "11912345678",
    password: "Senha de teste",
    confirm: "Senha de teste",
    role: "producer",
  };
  assert.equal(
    Object.values(registrationErrors(data)).every((value) => value === null),
    true,
  );
  assert.match(
    registrationErrors({ ...data, confirm: "outra" }).confirm ?? "",
    /iguais/,
  );
  assert.match(
    registrationErrors({ ...data, role: "admin" }).role ?? "",
    /válido/,
  );
});
