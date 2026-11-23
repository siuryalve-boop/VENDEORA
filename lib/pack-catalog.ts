export type PackFile = { filename: string; content: string };
type PackTemplate = {
  slug: string;
  title: string;
  description: string;
  price: number;
  files: PackFile[];
};

export const digitalPacks: PackTemplate[] = [
  {
    slug: "afiliado-sem-rosto",
    title: "Afiliado sem aparecer",
    description:
      "Roteiros de demonstração, calendário de publicações e planilha para acompanhar links de afiliado.",
    price: 2900,
    files: [
      {
        filename: "roteiros-sem-rosto.md",
        content:
          "# Roteiros de demonstração\n\n## Mostre um uso real\n1. Grave o produto em uso por três segundos.\n2. Mostre um detalhe que resolva uma dificuldade concreta.\n3. Demonstre uma limitação observada.\n4. Informe que o link é de afiliado e convide a conferir os detalhes.\n\n## Compare duas opções\nOrganize a demonstração por espaço, material, preço consultado e facilidade de uso. Informe a data do preço. Finalize com o público indicado para cada opção.\n\n## Pergunta comum\nUse uma pergunta que você de fato recebeu. Grave a resposta em três cortes curtos, com legenda e um exemplo em vídeo.\n",
      },
      {
        filename: "calendario-de-publicacoes.csv",
        content:
          "Dia;Tarefa;Entrega\n1;Escolher um produto que possa demonstrar;Lista de usos e limites\n2;Gravar três cenas próprias;Pasta de takes\n3;Publicar um vídeo curto;Link com identificação de afiliado\n4;Responder comentários;Lista de dúvidas\n5;Regravar a cena que gerou mais dúvidas;Segundo vídeo\n6;Comparar retenção;Registro de métricas\n7;Definir o próximo teste;Uma hipótese de conteúdo\n",
      },
      {
        filename: "controle-de-links.csv",
        content:
          "Data;Canal;Produto;Link de divulgação;Cliques;Vendas confirmadas;Comissão confirmada;Observações\n;;;;;;;\n",
      },
    ],
  },
  {
    slug: "primeiro-produto-digital",
    title: "Primeiro produto digital",
    description:
      "Modelos para planejar, montar e validar um e-book ou um pack de templates.",
    price: 3900,
    files: [
      {
        filename: "plano-do-produto.md",
        content:
          "# Plano do produto\n\nPúblico: [quem tem a dificuldade].\nProblema observado: [relato de uma pessoa real].\nResultado de uso: [tarefa que o material ajuda a concluir].\nFormato: [guia, planilha ou template].\n\n## Versão inicial\nDefina uma entrega que você consiga demonstrar em menos de dois minutos. Mostre uma página ou capítulo antes de pedir opinião. Pergunte onde o leitor travou e anote as palavras usadas.\n\n## Revisão\nTeste com três pessoas. Priorize os problemas repetidos. Atualize a data de versão e mantenha uma cópia de cada entrega vendida.\n",
      },
      {
        filename: "pagina-de-vendas.md",
        content:
          "# Nome do produto\n\nUma frase com o problema que o material resolve.\n\n## O que vem no pacote\n- [Item 1 e formato].\n- [Item 2 e formato].\n- [Exemplo de aplicação].\n\n## Para quem serve\n[Perfil beneficiado e pré-requisitos].\n\n## Como acessar\n[Prazo, dispositivos compatíveis e canal de suporte].\n\n## Preço e condições\n[Preço confirmado, política de reembolso e contato].\n",
      },
      {
        filename: "checklist-de-entrega.md",
        content:
          "# Checklist antes de publicar\n- [ ] Abra cada arquivo em outro dispositivo.\n- [ ] Confira nomes, links e créditos de conteúdo.\n- [ ] Leia a descrição lado a lado com os arquivos entregues.\n- [ ] Teste pagamento, cancelamento e acesso no ambiente de testes.\n- [ ] Publique uma amostra que possa ser aberta sem pagamento.\n- [ ] Confirme o contato para suporte.\n",
      },
    ],
  },
  {
    slug: "social-media-e-conteudo",
    title: "Social media e conteúdo",
    description:
      "Briefing, calendário editorial e modelos de legendas para trabalhar com conteúdo.",
    price: 3900,
    files: [
      {
        filename: "briefing-social-media.md",
        content:
          "# Briefing de conteúdo\n\n**Objetivo do mês:** [exemplo: aumentar pedidos de orçamento].\n**Público:** [perfil e principais dúvidas].\n**Oferta:** [serviço, condição e prazo].\n**Voz da marca:** [três adjetivos e exemplos].\n**Limites:** [temas sensíveis e materiais que pedem autorização].\n**Aprovação:** [pessoa, canal e prazo].\n\n## Em cada peça\nAnote a mensagem principal, o formato, o prazo, a origem dos assets, a chamada para ação e a informação que precisa ser confirmada.\n",
      },
      {
        filename: "calendario-editorial.csv",
        content:
          "Semana;Pilar;Formato;Ideia;Ação desejada;Métrica\n1;Educar;Carrossel;Erro comum e solução;Salvar;Salvamentos\n1;Prova;Vídeo curto;Demonstração de um processo;Ver detalhes;Cliques\n2;Conversa;Story;Pergunta da audiência;Responder;Respostas\n2;Oferta;Post;Lista do que está incluído;Enviar mensagem;Mensagens\n3;Educar;Vídeo;Tutorial em três partes;Compartilhar;Compartilhamentos\n4;Prova;Carrossel;Resultado autorizado e contexto;Pedir orçamento;Contatos\n",
      },
      {
        filename: "modelos-de-legenda.md",
        content:
          "# Modelos de legenda\n\n## Tutorial\nSe você trava em [tarefa], teste [ação]. Primeiro [passo 1]. Depois [passo 2]. Confira [sinal de sucesso]. Salve para revisar.\n\n## Oferta\n[Entrega] ajuda [perfil] a fazer [tarefa]. Inclui [itens concretos]. Confira [condição] e veja os detalhes em [destino].\n\n## Bastidores\nHoje o maior ajuste foi [mudança]. A gente decidiu isso porque [evidência]. O próximo teste é [tarefa].\n",
      },
    ],
  },
  {
    slug: "sites-freelancer",
    title: "Criação de sites para clientes",
    description:
      "Diagnóstico de negócios, modelo de proposta e roteiro de entrega para vender serviços de sites.",
    price: 4900,
    files: [
      {
        filename: "diagnostico-de-site.md",
        content:
          "# Diagnóstico de presença digital\n\n1. Abra o site no celular e tente concluir a ação mais importante.\n2. Conte quantos cliques são necessários para entrar em contato.\n3. Verifique se endereço, horário e telefone estão corretos.\n4. Identifique uma página com conteúdo desatualizado.\n5. Proponha uma melhoria concreta e explique como validar o resultado.\n\nEnvie um exemplo personalizado e apresente-se. Respeite pedidos de não receber novas mensagens.\n",
      },
      {
        filename: "proposta-de-site.md",
        content:
          "# Proposta comercial\n\nCliente: [nome]\nObjetivo: [ação principal do visitante]\n\n- Entregas: [páginas, formulários e integrações].\n- Responsável pelo domínio e hospedagem: [parte].\n- Conteúdo e fotos: [quem fornece e autoriza].\n- Prazo e etapas de aprovação: [datas].\n- Revisões incluídas: [quantidade e limites].\n- Valor e etapas de pagamento: [valores acordados].\n- Suporte após entrega: [prazo e canais].\n",
      },
      {
        filename: "entrega-do-projeto.md",
        content:
          "# Entrega de um site\n- [ ] Testar desktop, celular e formulários.\n- [ ] Validar o envio de mensagens e a página de erro.\n- [ ] Registrar URL, responsáveis e acessos concedidos.\n- [ ] Entregar backup do código e explicar como publicar.\n- [ ] Demonstrar como editar textos e fotos.\n- [ ] Confirmar suporte e próximas manutenções.\n",
      },
    ],
  },
  {
    slug: "saas-primeira-versao",
    title: "SaaS da ideia à primeira versão",
    description:
      "Template de entrevista, roteiro de validação e backlog para organizar o primeiro SaaS.",
    price: 4900,
    files: [
      {
        filename: "entrevista-com-usuario.md",
        content:
          "# Entrevista de descoberta\n\n1. Conte sobre a última vez que enfrentou [problema].\n2. O que você fez e quanto tempo levou?\n3. Qual parte você repetiu ou refez?\n4. Você tentou alguma ferramenta? O que funcionou?\n5. Como saberia se um fluxo novo economizou trabalho?\n\nRegistre o relato sem apresentar a ferramenta até entender o cenário. Compare padrões entre conversas.\n",
      },
      {
        filename: "backlog-do-mvp.csv",
        content:
          "História;Critério de aceite;Prioridade;Status\nCriar conta;Acesso exige confirmação de e-mail;Alta;Planejado\nConcluir tarefa central;Usuário termina a tarefa e vê o resultado;Alta;Planejado\nConsultar histórico;Usuário encontra seus próprios registros;Média;Planejado\nExportar dados;Usuário baixa apenas seus dados;Média;Planejado\nRegistrar feedback;Usuário descreve o que travou;Baixa;Planejado\n",
      },
      {
        filename: "roteiro-de-validacao.md",
        content:
          "# Teste da primeira versão\n\n## Antes\nPrepare um cenário com uma tarefa real, três participantes e uma definição de sucesso. Use dados fictícios quando houver informações pessoais.\n\n## Durante\nPeça que a pessoa pense em voz alta. Anote perguntas, etapas em que parou e mensagens de erro literais. Evite guiar cada clique.\n\n## Depois\nCorrija o primeiro obstáculo que se repetiu. Teste de novo com outro participante e compare o tempo e a conclusão da tarefa.\n",
      },
    ],
  },
  {
    slug: "video-curto-e-edicao",
    title: "Vídeos curtos e edição",
    description:
      "Guia de gravação vertical, roteiro em blocos e ficha de edição de vídeos curtos.",
    price: 2900,
    files: [
      {
        filename: "roteiro-de-video-curto.md",
        content:
          "# Roteiro vertical de 15 segundos\n\n0–3 s: apresente uma pergunta ou resultado visível.\n3–8 s: demonstre a etapa central com dois cortes.\n8–12 s: mostre o antes/depois ou detalhe relevante.\n12–15 s: diga qual ação o público pode tomar.\n\nMantenha legendas fora das áreas cobertas pelos botões das redes sociais. Use som licenciado e verifique o volume com fones.\n",
      },
      {
        filename: "lista-de-takes.csv",
        content:
          "Cena;Plano;Duração;Texto na tela;Áudio;Status\n1;Detalhe;3s;Problema;Trilha baixa;Pendente\n2;Plano médio;5s;Ação central;Voz;Pendente\n3;Detalhe;4s;Resultado;Efeito suave;Pendente\n4;Tela cheia;3s;Próxima ação;Trilha baixa;Pendente\n",
      },
      {
        filename: "checklist-de-exportacao.md",
        content:
          "# Exportação\n- [ ] Projetar em 1080 × 1920 para vídeo vertical.\n- [ ] Conferir legibilidade em tela pequena.\n- [ ] Manter voz acima da trilha.\n- [ ] Revisar erros nas legendas e nomes.\n- [ ] Exportar MP4 e reproduzir no celular.\n- [ ] Guardar projeto, fontes e licenças usadas.\n",
      },
    ],
  },
  {
    slug: "vendas-e-atendimento",
    title: "Vendas digitais e atendimento",
    description:
      "Roteiros de atendimento, modelo de proposta e acompanhamento de contatos sem disparo em massa.",
    price: 2900,
    files: [
      {
        filename: "roteiros-de-atendimento.md",
        content:
          "# Conversas com clientes\n\n## Primeira resposta\nOlá, [nome]. Obrigado por perguntar sobre [produto]. Você está buscando [resultado A] ou [resultado B]? Posso explicar o que vem no pacote para você decidir.\n\n## Confirmação de entrega\nSeu pedido [referência] foi recebido. O acesso fica em [local]. Se não encontrar, responda por este canal com a referência do pedido.\n\n## Pedido de reembolso\nRecebi sua solicitação. Envie a referência do pedido por canal privado. Vou confirmar a compra e informar o prazo conforme a política publicada.\n",
      },
      {
        filename: "controle-de-contatos.csv",
        content:
          "Data;Nome;Canal autorizado;Interesse;Próximo passo;Prazo;Status\n;;;;;;\n",
      },
      {
        filename: "respostas-frequentes.md",
        content:
          "# Perguntas frequentes\n\n**O que está incluído?** [Liste os arquivos e formatos reais.]\n**Como acesso?** [Informe o caminho dentro da plataforma.]\n**Qual é o prazo?** [Indique entrega e suporte separadamente.]\n**Qual a política de reembolso?** [Aponte o texto publicado e o canal.]\n**Posso adaptar o material?** [Especifique a licença que você tem direito de conceder.]\n",
      },
    ],
  },
];
