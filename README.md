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

Copie `.env.example` para `.env.local` e preencha a URL e a chave publicável do Supabase. Deixe `SITE_URL` vazio no desenvolvimento para usar `http://localhost:3000` ou `http://127.0.0.1:3000`. Se definir `SITE_URL`, abra o aplicativo nessa origem exata, incluindo a porta.

## Configurar o Supabase

1. Aplique as migrações em `supabase/migrations/` na ordem dos nomes, no projeto VENDEORA. Elas incluem gatilhos de cadastro em `auth.users`. Use o projeto dedicado.
2. Em Authentication, habilite e-mail com senha, confirmação de e-mail e uma senha mínima de 10 caracteres. Deixe login anônimo e provedores não usados desativados.
3. Configure a URL do Site em Authentication → URL Configuration. Atualize o template de cadastro para usar `<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirmar e-mail</a>` e o de recuperação para usar `<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Redefinir senha</a>`.
4. Configure SMTP próprio para os e-mails de produção. Teste o envio, a confirmação e a recuperação com uma conta de controle antes de liberar cadastros.
5. Configure Turnstile nas proteções do Supabase Auth. Coloque apenas a chave pública correspondente em `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. A validação do desafio precisa ficar ativa no Supabase Auth para também cobrir solicitações diretas.
6. Execute `tests/database.sql` e `tests/operations.sql` com a função administrativa do SQL Editor. Os registros de teste ficam em transações revertidas. Verifique também `GET /api/health` na aplicação publicada.

O Supabase armazena e verifica senhas. O CPF bruto sai dos metadados antes da inserção do usuário e é substituído por um HMAC com chave protegida no esquema `private`. Data de nascimento e telefone ficam no mesmo esquema. Preserve a chave de HMAC nos backups criptografados. A confirmação de e-mail e o perfil ativo são verificados no banco. O papel `admin` só pode ser atribuído por uma operação privilegiada e deve ter autenticação reforçada antes do uso administrativo em produção. Os campos internos de verificação de identidade permitem integrar um provedor futuro de titularidade.

## Stripe Connect e packs digitais

O servidor aceita chaves padrão (`sk_…`) e restritas (`rk_…`) do mesmo ambiente. Uma chave restrita deve permitir as operações usadas no Connect, no Checkout e nos saques da conta conectada. Configure todas as permissões no painel da Stripe e armazene a chave em `STRIPE_SECRET_KEY`.

1. Aplique as migrações do Supabase em ordem. O banco inicia em modo `test`.
2. Na hospedagem, configure `SITE_URL` com a origem HTTPS, `STRIPE_SECRET_KEY` com a chave `sk_test_…` da plataforma Connect e `SUPABASE_SERVICE_ROLE_KEY`. Cadastre `/api/stripe/webhook` na Stripe e salve o segredo `whsec_…` em `STRIPE_WEBHOOK_SECRET`.
3. Selecione os eventos da plataforma `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` e `charge.refunded`.
4. No painel Financeiro, configure o recebimento como produtor. A Stripe verifica o produtor e solicita os dados bancários. As vendas por cartão usam a conta conectada como destino e reservam 5% do valor pago para a VENDEORA. O custo de processamento da Stripe é debitado da plataforma.
5. Crie um pack em **Packs digitais**, publique em **Produtos** e abra o link de checkout em uma conta compradora diferente. Após a confirmação pelo webhook, o ZIP aparece na biblioteca da conta compradora. O reembolso integral cancela o acesso.
6. Para testar saques manuais, defina `VENDEORA_STRIPE_MANUAL_PAYOUTS=true` antes de conectar as contas de teste. Saques exigem autenticação por aplicativo e conta com calendário manual habilitado.

Após aprovação da plataforma Connect e validação em testes, use a chave live, o segredo do webhook live, `VENDEORA_STRIPE_MODE=live` e ajuste `private.commerce_settings.payment_mode` para `live` no Supabase. O modo separa as contas conectadas, os pedidos e os acessos pagos.

## Publicar na Vercel

Conecte o repositório privado, selecione Next.js e configure as variáveis no painel da Vercel. Use a URL de produção em `SITE_URL` e no Supabase Auth. Adicione um domínio de sua titularidade e siga os registros DNS indicados pela Vercel. Revise o operador, o canal de atendimento de privacidade, a política de retenção e a integração de e-mail antes de disponibilizar o cadastro geral.

Confirme login, cadastro, recuperação de senha, regras de acesso, produto ativo, checkout no ambiente de testes e liberação de aulas antes de promover uma versão. Comunicação com o gateway acontece exclusivamente no servidor. Configure valores de produção no provedor e segredos fora do Git.

Para compilar para a hospedagem Sites, rode `npm run build:worker`. A saída é `dist/server/index.js` e usa os mesmos componentes e endpoints do aplicativo Next.js. Configure as variáveis no ambiente do Worker. Mantenha o `project_id` existente em `.openai/hosting.json` ao publicar no mesmo Site.

## Recuperar o projeto

Versione migrações e código junto de cada alteração. Mantenha a branch `main` protegida e envie os commits a `origin` após os testes. Crie uma tag para cada publicação validada. Restaure o código a partir da tag no GitHub e faça novo deploy usando o ambiente apropriado.

Se estiver usando o pacote de backup, extraia o ZIP. Para recuperar também os commits, execute `git clone backup/vendeora.bundle vendeora-restaurada` dentro da pasta extraída `vendeora`.

GitHub guarda o código. Para o banco, habilite os backups do plano Supabase ou agende exportações criptografadas com acesso restrito. A estratégia de recuperação deve incluir dados de autenticação, tabelas privadas, funções, configurações de Auth e, quando houver, os objetos do Storage. Teste a restauração periodicamente em um projeto separado. Evite colocar dumps, arquivos `.env` ou chaves no Git.

## Escopo desta versão

Stack atual: Next.js e TypeScript na Vercel, PostgreSQL e autenticação no Supabase e Stripe Connect para checkout e repasses. Os módulos compartilham o mesmo domínio e banco.

### Produtos, vendas e pagamentos

- **Produtos → Duplicar como rascunho** copia os dados do produto, estilo do checkout, módulos, aulas e materiais de packs. Pedidos, permissões de afiliados e cupons continuam vinculados ao produto de origem.
- **Vendas** filtra no servidor por data, produto, status e código completo. O CSV exporta os pedidos retornados pela consulta, até 500 registros. As datas seguem o horário de Brasília.
- **Pedido** mostra o histórico registrado no banco com acesso restrito à compra. Para pedidos anteriores à migração, as datas existentes de criação e aprovação são recuperadas. Alterações futuras de status são registradas sem reproduzir eventos antigos desconhecidos.
- **Financeiro** informa a primeira pendência de configuração da Stripe e mantém as credenciais no servidor. Chaves precisam estar no mesmo ambiente do webhook. Confira a configuração do modo e faça um novo deploy após alterar variáveis. Salvar as chaves habilita a configuração técnica quando o ambiente coincide, mas a Stripe confirma a elegibilidade da conta e o produtor conclui seu cadastro bancário.

Execute `tests/order_history.sql` no SQL Editor após as migrações e `npm test` localmente. Os registros SQL de teste são revertidos.

### Dependências e módulos em desenvolvimento

- Vendas e saques reais dependem de hospedagem comercial, credenciais live e validação da Stripe. Recorrência, chargebacks, conciliação completa, repasses de afiliados e coprodução precisam de integração e testes específicos.
- E-mail, WhatsApp, emissão fiscal, IA, vídeo, domínios e backups do banco exigem configurar serviços externos antes da operação. Automações, eventos, equipes, licenças, fidelidade e demais módulos empresariais ainda precisam de implementação.

Inclui cadastro e login com Supabase, confirmação e recuperação por e-mail configurável, painel com pedidos do banco, produtos, packs com download privado, checkout por cartão via Stripe Connect, afiliações com revisão, aulas de texto com progresso, consulta administrativa de perfis e solicitações de privacidade. O checkout e os saques dependem da configuração da Stripe. Pix, boleto, assinaturas, repasses de afiliados, coprodução, uploads de mídia e verificação de titularidade na VENDEORA exigem implementação adicional.

O painel do produtor também traz CRM com histórico de compradores e exportação CSV, relatórios de vendas, edição de texto e cor do checkout, cupons e módulos de cursos. Notificações internas registram mudanças de pagamentos, afiliações e atendimento. A equipe pode responder a chamados e suspender ou reativar contas pelo painel após verificar a sessão com um aplicativo autenticador.

Afiliados aprovados podem copiar links exclusivos, ver as visitas registradas e consultar as comissões calculadas sobre pedidos do ambiente de testes. O percentual é definido no produto, e a comissão é registrada no banco após o pagamento ser aprovado pelo webhook de testes.
