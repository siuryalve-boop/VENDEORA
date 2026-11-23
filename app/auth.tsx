"use client";

import { ArrowLeft, Check, MailCheck, ShieldCheck } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { registrationErrors, type Registration } from "../lib/identity";
import {
  Action,
  api,
  AuthArt,
  Brand,
  Feedback,
  Notice,
  Password,
  useTask,
} from "./shared";

type Turnstile = {
  render: (element: HTMLDivElement, config: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
let captchaLoader: Promise<Turnstile> | null = null;

function loadCaptcha() {
  if (!captchaLoader)
    captchaLoader = new Promise<Turnstile>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => {
        const widget = (window as Window & { turnstile?: Turnstile }).turnstile;
        if (widget) resolve(widget);
        else reject(new Error("Turnstile indisponível"));
      };
      script.onerror = () => reject(new Error("Turnstile indisponível"));
      document.head.append(script);
    }).catch((error) => {
      captchaLoader = null;
      throw error;
    });
  return captchaLoader;
}

function Captcha({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!siteKey) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadCaptcha()
      .then((turnstile) => {
        if (!host.current || disposed) return;
        const id = turnstile.render(host.current, {
          sitekey: siteKey,
          theme: "light",
          language: "pt-br",
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
        cleanup = () => turnstile.remove(id);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [siteKey, onToken]);
  return siteKey ? (
    <div>
      <div ref={host} />
      {failed && (
        <Notice>
          A verificação de segurança não carregou. Atualize a página e tente
          novamente.
        </Notice>
      )}
    </div>
  ) : null;
}

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-main">
        <header className="auth-header">
          <Brand />
        </header>
        <div className="auth-content">{children}</div>
        <footer className="auth-footer">
          <span>© VENDEORA</span>
          <nav aria-label="Documentos da plataforma">
            <a href="/termos">Termos</a>
            <a href="/privacidade">Privacidade</a>
          </nav>
        </footer>
      </section>
      <AuthArt />
    </main>
  );
}

export function Login({
  captchaKey,
  status,
  next,
}: {
  captchaKey: string;
  status: string | null;
  next: string;
}) {
  const task = useTask();
  const [captcha, setCaptcha] = useState("");
  const [challenge, resetChallenge] = useState(0);
  return (
    <AuthFrame>
      <div className="auth-heading">
        <span className="section-label">ACESSE SUA CONTA</span>
        <h1>Boas-vindas de volta.</h1>
        <p>Entre para gerenciar seu negócio na VENDEORA.</p>
      </div>
      <form
        className="form"
        onSubmit={(event) =>
          task.submit(event, async (data) => {
            try {
              await api("auth/entrar", {
                email: data.get("email"),
                password: data.get("password"),
                remember: data.get("remember") === "on",
                captcha,
              });
              window.location.assign(next);
            } finally {
              setCaptcha("");
              resetChallenge((value) => value + 1);
            }
          })
        }
      >
        {status === "invalid" && (
          <Notice>
            Este link expirou ou já foi utilizado. Solicite um novo link se
            precisar alterar sua senha.
          </Notice>
        )}
        <Feedback status={task} />
        <label className="field">
          <span>E-mail</span>
          <input
            required
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            maxLength={254}
          />
        </label>
        <Password />
        <div className="form-row">
          <label className="check">
            <input name="remember" type="checkbox" /> Manter conectado
          </label>
          <a className="text-link" href="/recuperar-senha">
            Esqueci minha senha
          </a>
        </div>
        <Captcha key={challenge} siteKey={captchaKey} onToken={setCaptcha} />
        <Action busy={task.busy} type="submit">
          Entrar
        </Action>
        <p className="form-foot">
          Ainda não tem conta?{" "}
          <a className="text-link" href="/cadastro">
            Criar conta
          </a>
        </p>
      </form>
    </AuthFrame>
  );
}

const registrationFields: {
  name: keyof Registration;
  label: string;
  type?: string;
  auto?: string;
  maxLength?: number;
}[] = [
  { name: "name", label: "Nome completo", auto: "name", maxLength: 120 },
  { name: "cpf", label: "CPF", maxLength: 14 },
  { name: "birth", label: "Data de nascimento", type: "date", auto: "bday" },
  {
    name: "email",
    label: "E-mail",
    type: "email",
    auto: "email",
    maxLength: 254,
  },
  {
    name: "phone",
    label: "Telefone com DDD",
    type: "tel",
    auto: "tel",
    maxLength: 22,
  },
];
const initialData: Registration = {
  name: "",
  cpf: "",
  birth: "",
  email: "",
  phone: "",
  password: "",
  confirm: "",
  role: "producer",
};
const registrationSteps = ["Seus dados", "Validação", "Segurança", "Conclusão"];

export function Register({ captchaKey }: { captchaKey: string }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialData);
  const [checked, setChecked] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [challenge, resetChallenge] = useState(0);
  const task = useTask();
  const errors = checked ? registrationErrors(data) : null;
  const update = (name: keyof Registration, value: string) =>
    setData((previous) => ({ ...previous, [name]: value }));

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(true);
    if (Object.values(registrationErrors(data)).some(Boolean)) return;
    setStep(1);
  }

  return (
    <AuthFrame>
      <div className="auth-heading">
        <span className="section-label">COMECE NA VENDEORA</span>
        <h1>{step === 3 ? "Confirme seu e-mail" : "Crie sua conta."}</h1>
        <p>
          {step === 3
            ? "O link de confirmação libera o acesso ao seu painel."
            : "Preencha os dados para criar seu perfil na plataforma."}
        </p>
      </div>
      <ol className="steps" aria-label="Etapas do cadastro">
        {registrationSteps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={index <= step ? "step-current" : ""}
          >
            <span>{index < step ? <Check size={14} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <form className="form" onSubmit={next} noValidate>
          <div className="form-grid">
            {registrationFields.map(
              ({ name, label, type, auto, maxLength }) => (
                <label
                  key={name}
                  className={`field ${name === "name" ? "span-2" : ""}`}
                >
                  <span>{label}</span>
                  <input
                    name={name}
                    type={type ?? "text"}
                    inputMode={name === "cpf" ? "numeric" : undefined}
                    autoComplete={auto}
                    maxLength={maxLength}
                    value={data[name]}
                    onChange={(event) => update(name, event.target.value)}
                    required
                    aria-invalid={Boolean(errors?.[name])}
                    aria-describedby={
                      errors?.[name] ? `error-${name}` : undefined
                    }
                  />
                  {errors?.[name] && (
                    <small className="field-error" id={`error-${name}`}>
                      {errors[name]}
                    </small>
                  )}
                </label>
              ),
            )}
            <label className="field">
              <span>Tipo de conta</span>
              <select
                value={data.role}
                onChange={(event) => update("role", event.target.value)}
              >
                <option value="producer">Produtor</option>
                <option value="affiliate">Afiliado</option>
                <option value="student">Aluno</option>
              </select>
            </label>
            <div>
              <Password
                fresh
                value={data.password}
                onChange={(value) => update("password", value)}
              />
              {errors?.password && (
                <small className="field-error">{errors.password}</small>
              )}
            </div>
            <div>
              <Password
                fresh
                label="Confirmar senha"
                name="confirm"
                value={data.confirm}
                onChange={(value) => update("confirm", value)}
              />
              {errors?.confirm && (
                <small className="field-error">{errors.confirm}</small>
              )}
            </div>
          </div>
          <Action type="submit">Validar meus dados</Action>
        </form>
      )}
      {step === 1 && (
        <div className="form">
          <div className="review">
            <ShieldCheck size={24} />
            <div>
              <strong>Os dados informados passaram na validação.</strong>
              <p>
                CPF, data de nascimento, telefone e senha atendem aos
                requisitos. Você ainda precisa confirmar seu e-mail.
              </p>
            </div>
          </div>
          <dl className="details">
            <div>
              <dt>Nome</dt>
              <dd>{data.name}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{data.email}</dd>
            </div>
          </dl>
          <Action onClick={() => setStep(2)}>Continuar</Action>
          <button className="button secondary" onClick={() => setStep(0)}>
            <ArrowLeft size={15} /> Editar dados
          </button>
        </div>
      )}
      {step === 2 && (
        <form
          className="form"
          onSubmit={(event) =>
            task.submit(event, async (values) => {
              try {
                await api("auth/cadastro", {
                  ...data,
                  terms: values.get("terms") === "on",
                  privacy: values.get("privacy") === "on",
                  captcha,
                });
                setData({ ...initialData, email: data.email });
                setStep(3);
              } finally {
                setCaptcha("");
                resetChallenge((value) => value + 1);
              }
            })
          }
        >
          <Feedback status={task} />
          <label className="check consent">
            <input type="checkbox" name="terms" required />
            <span>
              Li e aceito os{" "}
              <a href="/termos" target="_blank" rel="noreferrer">
                Termos de uso
              </a>
              .
            </span>
          </label>
          <label className="check consent">
            <input type="checkbox" name="privacy" required />
            <span>
              Li e aceito a{" "}
              <a href="/privacidade" target="_blank" rel="noreferrer">
                Política de privacidade
              </a>{" "}
              e o tratamento de dados necessário ao cadastro.
            </span>
          </label>
          <Captcha key={challenge} siteKey={captchaKey} onToken={setCaptcha} />
          <Action busy={task.busy} type="submit">
            Confirmar cadastro
          </Action>
          <button
            className="button secondary"
            type="button"
            onClick={() => setStep(1)}
          >
            <ArrowLeft size={15} /> Voltar
          </button>
        </form>
      )}
      {step === 3 && (
        <div className="form">
          <div className="review">
            <MailCheck size={25} />
            <div>
              <strong>Solicitação de cadastro recebida</strong>
              <p>
                Se o e-mail {data.email} estiver disponível para cadastro, você
                receberá o link de confirmação.
              </p>
            </div>
          </div>
          <a className="button primary" href="/entrar">
            Ir para o login
          </a>
        </div>
      )}
      {step < 3 && (
        <p className="form-foot">
          Já tem conta?{" "}
          <a className="text-link" href="/entrar">
            Entrar
          </a>
        </p>
      )}
    </AuthFrame>
  );
}

export function Recovery({
  fresh = false,
  captchaKey,
}: {
  fresh?: boolean;
  captchaKey: string;
}) {
  const task = useTask();
  const [captcha, setCaptcha] = useState("");
  const [challenge, resetChallenge] = useState(0);
  return (
    <AuthFrame>
      <div className="auth-heading">
        <span className="section-label">SEGURANÇA DA CONTA</span>
        <h1>{fresh ? "Crie uma nova senha." : "Recupere seu acesso."}</h1>
        <p>
          {fresh
            ? "Escolha uma senha de pelo menos 10 caracteres."
            : "Indique o e-mail da conta para receber as instruções."}
        </p>
      </div>
      <form
        className="form"
        onSubmit={(event) =>
          task.submit(
            event,
            async (data) => {
              if (fresh) {
                await api("auth/senha", {
                  password: data.get("password"),
                  confirm: data.get("confirm"),
                });
                window.location.assign("/dashboard");
              } else {
                try {
                  await api("auth/recuperar", {
                    email: data.get("email"),
                    captcha,
                  });
                } finally {
                  setCaptcha("");
                  resetChallenge((value) => value + 1);
                }
              }
            },
            fresh
              ? "Senha atualizada."
              : "Se o e-mail estiver cadastrado, você receberá um link de recuperação.",
          )
        }
      >
        <Feedback status={task} />
        {fresh ? (
          <>
            <Password fresh />
            <Password fresh name="confirm" label="Confirmar senha" />
          </>
        ) : (
          <>
            <label className="field">
              <span>E-mail</span>
              <input
                required
                type="email"
                name="email"
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <Captcha
              key={challenge}
              siteKey={captchaKey}
              onToken={setCaptcha}
            />
          </>
        )}
        <Action busy={task.busy} type="submit">
          {fresh ? "Atualizar senha" : "Enviar link de recuperação"}
        </Action>
        <a className="text-link" href="/entrar">
          Voltar para o login
        </a>
      </form>
    </AuthFrame>
  );
}
