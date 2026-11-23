# VENDEORA

Plataforma de produtos digitais. A raiz abre a autenticação ou a visão geral da conta. Checkout, área de membros e documentos ficam no mesmo aplicativo.

## Rodar localmente

Requer Node.js 22 ou superior e um projeto Supabase vazio ou dedicado à VENDEORA.

```sh
npm install
npm run dev
npm test
npm run check
npm run build
```

Copie `.env.example` para `.env.local` e preencha a URL e a chave publicável do Supabase. `SITE_URL` deve ser a origem usada no navegador, incluindo a porta local quando houver. Acesse `http://localhost:3000`.

## Configurar o Supabase

1. Aplique as migrações em `supabase/migrations/` na ordem dos nomes, no projeto VENDEORA. Elas incluem gatilhos de cadastro em `auth.users`. Use o projeto dedicado.
2. Em Authentication, habilite e-mail com senha, confirmação de e-mail e uma senha mínima de 10 caracteres. Deixe login anônimo e provedores não usados desativados.
3. Configure a URL do Site em Authentication → URL Configuration. Atualize o template de cadastro para usar `<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirmar e-mail</a>` e o de recuperação para usar `<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Redefinir senha</a>`.
4. Configure SMTP próprio para os e-mails de produção. Teste o envio, a confirmação e a recuperação com uma conta de controle antes de liberar cadastros.
5. Configure Turnstile nas proteções do Supabase Auth. Coloque apenas a chave pública correspondente em `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. A validação do desafio precisa ficar ativa no Supabase Auth para também cobrir solicitações diretas.
6. Execute `tests/database.sql` com a função administrativa do SQL Editor. Os registros de teste ficam em uma transação revertida. Verifique também `GET /api/health` na aplicação publicada.

O Supabase armazena e verifica senhas. O CPF bruto sai dos metadados antes da inserção do usuário e é substituído por um HMAC com chave protegida no esquema `private`. Data de nascimento e telefone ficam no mesmo esquema. Preserve a chave de HMAC nos backups criptografados. A confirmação de e-mail e o perfil ativo são verificados no banco. O papel `admin` só pode ser atribuído por uma operação privilegiada e deve ter autenticação reforçada antes do uso administrativo em produção. Os campos internos de verificação de identidade permitem integrar um provedor futuro de titularidade.

## Stripe em testes

Configure `STRIPE_SECRET_KEY` com uma chave `sk_test_…`, `STRIPE_WEBHOOK_SECRET` com o segredo do endpoint de teste e `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor. No Stripe, cadastre `POST /api/stripe/webhook` para os eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` e `checkout.session.expired`. Use uma conta compradora diferente da conta produtora e um cartão de teste do Stripe. O webhook confirma o valor, a moeda, o identificador da sessão e o pedido antes de liberar aulas. O código restringe o checkout ao ambiente de testes.

## Publicar na Vercel

Conecte o repositório privado, selecione Next.js e configure as variáveis no painel da Vercel. Use a URL de produção em `SITE_URL` e no Supabase Auth. Adicione um domínio de sua titularidade e siga os registros DNS indicados pela Vercel. Revise o operador, o canal de atendimento de privacidade, a política de retenção e a integração de e-mail antes de disponibilizar o cadastro geral.

Confirme login, cadastro, recuperação de senha, regras de acesso, produto ativo, checkout no ambiente de testes e liberação de aulas antes de promover uma versão. Comunicação com o gateway acontece exclusivamente no servidor. Configure valores de produção no provedor e segredos fora do Git.

Para compilar para a hospedagem Sites, rode `npm run build:worker`. A saída é `dist/server/index.js` e usa os mesmos componentes e endpoints do aplicativo Next.js. Configure as variáveis no ambiente do Worker. Mantenha o `project_id` existente em `.openai/hosting.json` ao publicar no mesmo Site.

## Recuperar o projeto

Versione migrações e código junto de cada alteração. Mantenha a branch `main` protegida e envie os commits a `origin` após os testes. Crie uma tag para cada publicação validada. Restaure o código a partir da tag no GitHub e faça novo deploy usando o ambiente apropriado.

Se estiver usando o pacote de backup, extraia o ZIP. Para recuperar também os commits, execute `git clone backup/vendeora.bundle vendeora-restaurada` dentro da pasta extraída `vendeora`.

GitHub guarda o código. Para o banco, habilite os backups do plano Supabase ou agende exportações criptografadas com acesso restrito. A estratégia de recuperação deve incluir dados de autenticação, tabelas privadas, funções, configurações de Auth e, quando houver, os objetos do Storage. Teste a restauração periodicamente em um projeto separado. Evite colocar dumps, arquivos `.env` ou chaves no Git.

## Escopo desta versão

Inclui cadastro e login com Supabase, confirmação e recuperação por e-mail configurável, painel com pedidos reais do banco, produtos, links de checkout, pedidos Stripe em teste, afiliações com revisão, aulas de texto com progresso, consulta administrativa de perfis e solicitações de privacidade. Pagamentos reais, Pix, boleto, saques, rastreamento e comissões de afiliados, coprodução, uploads de mídia e verificação de titularidade exigem implementação ou configuração adicional.
