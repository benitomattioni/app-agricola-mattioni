# Controle Interno — Agrícola Mattioni Ltda

App web com login por usuário, banco de dados e uso simultâneo por várias pessoas.

- Backend: Node.js + Express
- Banco de dados: PostgreSQL
- Autenticação: e-mail + senha (senha criptografada, sessão por token)
- Frontend: HTML/JS puro (sem etapa de build), servido pelo próprio backend

Todo mundo que fizer login vê e edita as mesmas máquinas e os mesmos abastecimentos —
é o "livro compartilhado" da fazenda, só que agora com conta própria por pessoa.

---

## 1. Rodando no seu computador (opcional, para testar antes de publicar)

Pré-requisitos: [Node.js](https://nodejs.org) 18+ instalado e um Postgres (pode ser local
ou um gratuito na nuvem, ex. [Neon](https://neon.tech) ou [Supabase](https://supabase.com)).

```bash
cd fazenda-abastecimento
npm install
cp .env.example .env
# edite o .env e coloque a DATABASE_URL do seu Postgres e um JWT_SECRET qualquer
npm start
```

Abra `http://localhost:3000` no navegador.

---

## 2. Publicando no Render (servidor pago)

### Passo a passo

1. **Suba este projeto para o GitHub.**
   Crie um repositório novo em [github.com](https://github.com) e envie esta pasta
   (`fazenda-abastecimento`) para ele. Se nunca fez isso, o próprio GitHub mostra o
   passo a passo assim que você clica em "New repository".

2. **Crie uma conta em [render.com](https://render.com)** (dá pra entrar direto com
   a conta do GitHub).

3. **Crie o banco de dados primeiro:** no painel do Render, clique em **"New +" →
   PostgreSQL**. Dê um nome (ex. `fazenda-db`), escolha a região mais próxima e o
   plano **Starter** (pago, ~US$ 7/mês, sem o limite de 30 dias do plano gratuito).
   Clique em **Create Database** e espere ficar pronto.

4. Na página do banco recém-criado, vá até a seção **"Connections"** e copie o valor
   de **"Internal Database URL"** (só funciona entre serviços dentro do Render — é
   o que você vai usar).

5. **Crie o serviço do app:** clique em **"New +" → Web Service** e conecte o
   repositório que você acabou de subir. Configure:
   - **Name:** o que preferir (ex. `fazenda-abastecimento`)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter (pago, ~US$ 7/mês — evita o serviço "dormir" depois
     de 15 minutos sem uso, o que atrapalharia o pessoal usando no campo)

6. **Adicione as variáveis de ambiente** (seção "Environment" do mesmo formulário,
   ou depois em "Environment" no menu do serviço):
   - `DATABASE_URL` → cole a Internal Database URL copiada no passo 4
   - `JWT_SECRET` → um texto longo e aleatório só seu (gere um em
     https://generate-secret.vercel.app/32)
   - `ANTHROPIC_API_KEY` → sua chave da API da Anthropic (veja o item 3 abaixo) —
     pode deixar em branco por enquanto e preencher depois
   - `VISION_MODEL` → `claude-haiku-4-5-20251001` (ou deixe em branco, esse já é o
     padrão usado pelo app)
   - Não precisa definir `PORT` — o Render define isso sozinho.

7. Clique em **Create Web Service**. O Render instala as dependências, sobe o app e
   te dá uma URL pública (algo como `fazenda-abastecimento.onrender.com`).

8. **Domínio próprio (opcional):** em "Settings → Custom Domains" do serviço dá pra
   ligar um domínio seu (ex. `abastecimento.suafazenda.com.br`).

9. Abra a URL, crie a **primeira conta** (ela vira administradora automaticamente) e,
   dentro do app, na aba **"Equipe"**, crie o acesso de cada funcionário.

### 3. Chave da API da Anthropic (para a leitura das fotos)

A leitura automática de litros/horímetro nas fotos usa a API da Anthropic — é uma
conta separada da sua assinatura do Claude.ai, com cobrança por uso (bem barata para
esse tipo de tarefa, veja a conversa acima sobre custos).

1. Crie uma conta em [console.anthropic.com](https://console.anthropic.com)
2. Adicione um método de pagamento (Billing → Add payment method)
3. Crie uma chave em API Keys → Create Key
4. Cole essa chave na variável `ANTHROPIC_API_KEY` do serviço no Render

Se você deixar essa variável em branco, o app continua funcionando normalmente — só
não tenta ler as fotos automaticamente, e a pessoa digita os valores na mão.

---

## 3. Instalar como app no celular (sem loja de aplicativos)

O app já vem pronto pra ser "instalado" na tela inicial do celular, como se
fosse baixado de uma loja — funciona em tela cheia, sem a barra do navegador,
com ícone próprio. Não precisa Play Store nem App Store, é só abrir o link no
navegador do celular:

**Android (Chrome):**
1. Abra a URL do app (ex. `https://controle-interno-agricola.onrender.com`)
2. Toque nos três pontinhos (⋮) no canto superior direito
3. Toque em **"Instalar aplicativo"** (ou "Adicionar à tela inicial")
4. Confirme — o ícone aparece na tela inicial do celular, igual um app normal

**iPhone (Safari — precisa ser o Safari, não funciona no Chrome do iPhone):**
1. Abra a URL do app no Safari
2. Toque no ícone de compartilhar (o quadrado com uma seta pra cima)
3. Role e toque em **"Adicionar à Tela de Início"**
4. Confirme — o ícone aparece na tela inicial

Depois de instalado, o app abre direto em tela cheia, com ícone e nome
próprios, e continua puxando os dados ao vivo do servidor normalmente — é o
mesmo app, só que com uma "casca" de aplicativo nativo. Cada pessoa da
equipe faz esse mesmo passo no celular dela.

---

## 4. Estrutura do projeto

```
fazenda-abastecimento/
├── server.js              # servidor Express
├── db.js                  # conexão com Postgres e criação das tabelas
├── middleware/auth.js     # validação do login (token) e checagem de admin
├── lib/                    # regras de negócio compartilhadas (estoques, notificações etc.)
├── routes/
│   ├── auth.js              # cadastro (bootstrap do admin / convite) / login
│   ├── users.js              # gestão da equipe (só admin)
│   ├── machines.js           # máquinas (criar/excluir: só admin · listar: todos)
│   ├── refills.js            # abastecimentos (criar: todos · excluir: só admin · fotos)
│   ├── oil-changes.js        # trocas de óleo (criar: todos · excluir: só admin)
│   ├── stock.js               # estoque de diesel e reposições
│   ├── products.js            # defensivos/adubos cadastrados
│   ├── pivots.js               # pivôs (número, nome, área)
│   ├── plantings.js            # culturas por pivô e relatório de custos
│   ├── applications.js          # aplicações de defensivos/adubos (até 8 produtos por passada)
│   ├── energy.js                 # custo mensal de energia por pivô
│   ├── production.js              # cargas de colheita
│   ├── sales.js                    # vendas de grãos
│   ├── grain-stock.js               # saldo de sacas em estoque
│   ├── push.js                       # notificações push (estoque baixo)
│   └── vision.js                      # leitura das fotos via API da Anthropic
├── public/
│   ├── index.html          # todo o frontend (tela de login + app)
│   ├── manifest.json        # instalação como app no celular (PWA)
│   ├── sw.js                 # service worker (push + instalação)
│   └── icon-*.png              # ícones do app
├── package.json
└── .env.example
```

## 5. Abastecimento: sem fotos, com funcionário responsável

O formulário de abastecimento **não usa mais fotos nem leitura automática**
(isso foi removido). No lugar, tem um campo **"Funcionário que abasteceu"**
— um select alimentado pelo mesmo cadastro de **Funcionários de campo** (aba
"Equipe", veja a seção 12) usado nas aplicações/plantios. Isso substitui o
antigo campo de texto livre "Operador": agora é sempre um nome escolhido de
uma lista, não digitado.

Cada abastecimento também mostra, no histórico, **quem lançou o registro**
("Lançado por: Nome") — é a conta logada que fez o lançamento, e é
diferente do funcionário selecionado (pensado pra quando quem lança no app
não é a mesma pessoa que fisicamente abasteceu a máquina).

As fotos de abastecimentos lançados antes dessa mudança continuam
acessíveis pelo botão "📷 ver fotos" no histórico (nada foi apagado), mas
não é mais possível anexar fotos novas nesse formulário. Produção e Vendas
continuam com fotos e leitura automática normalmente — só o abastecimento
mudou.

## 6. Máquinas, odômetro/horímetro e trocas de óleo

Tipos de máquina disponíveis: Trator, Colheitadeira, Pulverizador, Pá
Carregadeira, Escavadeira, Rolo Compactador, Caminhão, Camionete/Utilitário,
Implemento, Gerador e Outro. O administrador pode **editar** qualquer
máquina depois de cadastrada (nome, tipo, placa/identificação) tocando no
ícone ✏️ no cartão — o histórico de abastecimentos e trocas de óleo
continua vinculado normalmente.

O campo de leitura no abastecimento se adapta ao tipo da máquina
automaticamente:
- **Caminhão e Camionete/Utilitário** → o rótulo vira **"Odômetro (km)"**
- **Todos os demais tipos** → continua **"Horímetro (horas)"**

Isso vale tanto no formulário quanto no histórico de abastecimentos (mostra
"km" ou "h" conforme a máquina) e no consumo médio calculado por máquina.

Na aba **"Máquinas"**, cada cartão mostra o **status da troca de óleo** —
com um botão **"+ Registrar"** por tipo de óleo (data + leitura do
odômetro/horímetro no momento da troca — qualquer pessoa da equipe pode
registrar, igual um abastecimento):

- **Óleo do motor** — toda máquina
- **Óleo hidráulico** e **Óleo da transmissão** — só em Tratores

Cada tipo de óleo tem seu próprio histórico e alerta independente. O status
é calculado sozinho a partir da última troca registrada (daquele tipo) e da
leitura mais recente de algum abastecimento da máquina:

- 🟢 **Em dia**
- 🟡 **Perto do prazo** (a partir de 85% do intervalo)
- 🔴 **Troca atrasada**
- ⚪ **Sem registro** (nenhuma troca lançada ainda pra esse tipo de óleo)

O intervalo de alerta (o mesmo pros três tipos de óleo, já que o app não
tem como saber o manual de cada equipamento):
- **Caminhão / Camionete:** a cada **10.000 km ou 6 meses**, o que vencer primeiro
- **Demais tipos:** a cada **500 horas ou 6 meses**, o que vencer primeiro

Quando alguma troca está atrasada ou perto do prazo, um aviso aparece no
topo da aba "Máquinas" — e também no Painel (ver seção 7). Só o
administrador pode excluir um registro de troca (útil se alguém errou a
data ou a leitura por engano).

## 7. Painel: previstos e alertas

O Painel (tela inicial, pra admin e funcionário) mostra dois avisos
automáticos, quando existirem:
- **Aplicações/plantios previstos** — qualquer lançamento em "Plantio/
  Aplicações" com data de hoje em diante aparece aqui como "a fazer". Ou
  seja, lançar hoje um plantio ou aplicação com data futura serve como
  agendamento simples: some da lista assim que a data chegar (a partir do
  dia seguinte) ou quando for editado/excluído.
- **Próximas trocas de óleo** — máquinas com alguma troca de óleo (motor,
  hidráulico ou transmissão) atrasada ou perto do prazo.

## 8. Estoque de diesel e alerta de estoque baixo

O painel mostra o estoque atual de diesel. O administrador registra
"reposições" (quantidade recebida **e o custo por litro pago naquela
compra**) pelo botão "+ Registrar reposição" — é aí que o custo do diesel
entra no sistema, não mais em cada abastecimento individual das máquinas
(o formulário de abastecimento só pede litros, sem valor). Cada
abastecimento feito com um combustível que contenha "Diesel" no nome
desconta automaticamente do estoque em litros. Excluir um abastecimento
estorna a quantidade de volta. O estoque é sempre a soma de tudo isso — o
histórico de movimentações fica em `stock_movements`, então dá pra auditar
depois. O custo por litro da última reposição e o total investido em diesel
aparecem no cartão do painel, visíveis só para o administrador.

Quando o estoque cai para 1000 L ou menos (ajustável pela variável
`LOW_STOCK_THRESHOLD_LITERS`), o app avisa automaticamente todos os
administradores por **notificação no celular** e **e-mail**. O aviso só
dispara uma vez por "descida" abaixo do limite — ele reseta sozinho quando o
estoque volta a subir (após uma reposição) e cai de novo depois.

Pra essas notificações funcionarem, configure no Render:
- **E-mail:** as variáveis `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  e `ALERT_EMAIL_FROM` (dá pra usar o Gmail com uma "senha de app" — veja o
  comentário no `.env.example`).
- **Notificação no celular:** gere um par de chaves rodando, uma única vez,
  `npx web-push generate-vapid-keys` e cole os valores em `VAPID_PUBLIC_KEY`
  e `VAPID_PRIVATE_KEY`. Depois, cada administrador precisa tocar em **"🔔
  Ativar notificações no celular"** no painel do app (uma vez por aparelho) —
  o navegador vai pedir permissão de notificação.

Se essas variáveis ficarem em branco, o app funciona normalmente — só não
manda os avisos automáticos.

## 9. Custos Pivôs (defensivos, pivôs, culturas e energia)

Dentro de "Custos Pivôs" (antes chamada "Defensivos") agora tem seis sub-abas:

- **Produtos**: defensivos, adubos e agora também **sementes** e
  **produtos de tratamento de sementes**, com preço por unidade e estoque
  (preço só aparece pro administrador). A unidade é livre (L, kg, sc etc.),
  conforme o que fizer sentido pra cada produto.
- **Pivôs**: número, nome e área (hectares) de cada pivô central.
- **Culturas**: aqui você registra o plantio — pivô, nome da cultura, data
  de plantio e previsão de colheita. Isso substitui o campo solto "cultura
  atual" que existia antes no cadastro do pivô: agora cada plantio fica
  registrado com suas datas, e o cultivo mais recente de um pivô é o que
  aparece como "cultura atual" no cartão do pivô. Toda aplicação e toda
  carga de produção passam a gravar automaticamente a cultura vigente
  naquele pivô na data do lançamento.
- **Aplicações/Plantio**: agora é um fluxo de **planejamento → execução**.
  Só o **administrador** cria um lançamento (pivô, data, funcionário
  responsável e de 1 a 8 itens numa mesma passada). Tem dois botões
  separados no rodapé da tela, um pra cada tipo:
  - **+ Aplicação** (o de sempre): defensivo/adubo em cobertura, com a
    dosagem total aplicada por produto.
  - **+ Plantio**: pensado pro dia do plantio em si — semente, adubo de
    base, tratamento de semente, produtos do jato dirigido da plantadeira
    etc. Nesse modo a área plantada (hectares) é obrigatória, e cada item
    pede a **dose/ha** (não o total) — o app calcula o total sozinho
    (dose/ha × área).

  O lançamento nasce **pendente** e aparece logo no topo do **Painel**
  (antes de qualquer outro card, pra admin e funcionário), mostrando pivô,
  área, cultura, funcionário responsável e cada produto com a dose/ha e a
  quantidade total a usar. Qualquer pessoa logada — geralmente o
  funcionário responsável — toca em **"✓ Marcar como executado"** quando
  terminar. Só nesse momento o estoque do(s) produto(s) é descontado (não
  quando o admin cria o planejamento) e o lançamento sai da lista de
  pendentes, indo pro histórico normal.

  Nos dois casos, todos os itens da mesma passada aparecem juntos num só
  cartão no histórico. Pro administrador, o custo aparece sempre em
  **R$/hectare** — tanto o total da passada (no topo do cartão) quanto o de
  cada produto individualmente — em vez do valor absoluto gasto. Se a área
  não foi informada, aparece um aviso no lugar do valor (não dá pra
  calcular por hectare sem saber a área).
- **Custos** (só admin): em vez de um total genérico por pivô, mostra um
  cartão por cultura-em-pivô, no formato:

  ```
  Cultura: Soja
  Data de plantio: 23/05/2026
  Possível colheita: 23/09/2026
  Custo:
    Sementes
    Adubos
    Defensivos
    Energia
    Diesel
  ```

  **Sementes** (inclui tratamento de sementes), **Adubos** e
  **Defensivos** vêm das aplicações/plantios registrados naquele pivô
  dentro do período do plantio (separados pela categoria do produto).
  **Energia** vem da sub-aba "Energia" (veja abaixo), filtrada pelo mesmo
  pivô e período. **Diesel** vem dos abastecimentos com combustível diesel
  vinculados àquele pivô (veja a seção seguinte) — o valor é uma
  estimativa: litros × custo por litro da reposição de diesel mais recente
  na hora do abastecimento, já que o formulário de abastecimento não pede
  preço.

  Depois do Total, cada cartão também mostra o **custo por hectare**
  daquela cultura (Total ÷ área cadastrada no pivô). No topo da sub-aba,
  um resumo mostra o **custo total somando todas as culturas** e o
  **custo médio por hectare** da fazenda inteira (só considera os pivôs
  com área cadastrada).

- **Energia** (só admin): lançamento do custo mensal de energia — mês de
  referência, custo da demanda e custo do consumo, com o total calculado
  sozinho. Cada lançamento pode ficar vinculado a um pivô (motor de
  irrigação) ou marcado como "geral"; os vinculados a um pivô entram no
  cartão de custo daquela cultura, na sub-aba "Custos".

## 10. Diesel por pivô ou de uso geral

O formulário de abastecimento tem um campo opcional "Pivô": se aquele
diesel foi usado num motor de irrigação de um pivô específico, selecione-o
— o custo entra automaticamente no relatório de custo daquela cultura.
Deixando em "uso geral" (o padrão), o abastecimento continua sem vínculo
com nenhum pivô — típico de trator, caminhão etc. O total de diesel de uso
geral aparece à parte, no fim da sub-aba "Custos".

## 11. Entradas por cultura, estoque de grãos por tipo e Saídas

Duas abas fecham o ciclo da lavoura — renomeadas pra deixar mais claro o
que é fluxo de entrada e o que é saída da fazenda:

**"Entradas"** (antes "Produção") — cada carga colhida é lançada
escolhendo diretamente a **Cultura** (o plantio/ciclo em pivô — ex.: "Soja
— Pivô 1 — Setor Norte (23/05/2026)"), não mais um pivô solto com a
cultura inferida por trás. O pivô e o tipo de grão vêm automaticamente
dali. Tem fotos do display da balança (peso bruto e tara), e o botão "Ler
pesos das fotos" chama a API da Anthropic pra tentar identificar os dois
pesos automaticamente — a pessoa sempre confere antes de salvar. O app
calcula sozinho:
- **Peso líquido** = peso bruto − tara
- **Sacas de 60kg** = peso líquido ÷ 60

Como cada carga fica vinculada ao **ciclo de plantio exato** escolhido, dá
pra distinguir a mesma cultura repetida em ciclos diferentes no mesmo pivô
(ex.: soja de 2025 e soja de 2026 aparecem separadas). A sub-aba
**"Produtividade"** lista um cartão por ciclo de plantio, na ordem do mais
recente pro mais antigo — e o cartão **já aparece assim que a cultura é
cadastrada em "Custos Pivôs → Culturas"**, com 0 sacas, mesmo antes de
qualquer colheita. Conforme as cargas forem sendo lançadas, as sacas vão
somando sozinhas naquele cartão.

**"Saídas"** (antes "Estoque") — toda venda pede o **Tipo de grão**
vendido (ex.: "Soja", "Milho" — a lista vem dos nomes de cultura já
cadastrados), não um pivô ou ciclo específico: o estoque de grãos é por
tipo de grão, somando a produção de todos os pivôs/ciclos que produziram
aquele grão, **independente de pivô**. Além disso, dá pra tirar foto do
peso bruto, da tara e da placa do veículo — os botões "Ler pesos" e "Ler
placa" tentam preencher automaticamente. O preço por saca (60kg) é
informado na hora, e o valor total é calculado sozinho. Cada venda tem um
marcador **Pago/Pendente** (só o administrador pode alternar).

A sub-aba **"Resumo"** (só admin) mostra o **estoque em sacas por tipo de
grão** — um cartão por grão (não por pivô nem por ciclo), com produzido,
vendido e saldo em estoque daquele grão. Vendas ou cargas sem tipo de grão
definido (de antes dessa mudança) aparecem à parte, num total "sem tipo de
grão definido".

Excluir uma carga ou uma venda atualiza esse saldo automaticamente (ele é
sempre calculado na hora, a partir das cargas e vendas daquela cultura —
não depende de nenhum ajuste manual).

## 12. Papéis de usuário

- **Administrador**: cadastra/remove máquinas, pivôs e produtos (defensivos e
  adubos); cadastra/remove contas da equipe e funcionários de campo (aba
  "Equipe"); registra reposições de estoque; registra e exclui
  abastecimentos; **cria os planejamentos de aplicação/plantio** (só ele);
  vê todos os valores e quantidades em estoque.
- **Funcionário**: registra abastecimentos (sem valores) e cargas/vendas
  de produção — sempre sem acesso a preços, custos ou quantidades em
  estoque. Não cria aplicações/plantios (isso é só do administrador), mas
  pode **marcar como executado** um lançamento pendente que apareça pra
  ele no Painel. Não cadastra/exclui máquinas, pivôs ou produtos, não vê a
  aba Equipe, nem o resumo financeiro de nada.

Especificamente, o funcionário **não vê**:
- Estoque de diesel (nem quantidade nem custo) — o painel dele mostra só os
  últimos abastecimentos (e as pendências de aplicação/plantio, no topo).
- Preço por litro e custo de cada defensivo/adubo, nem a sub-aba "Custos".
- Estoque de grãos e status de pago/pendente das vendas.

**Funcionários de campo** (aba "Equipe" → seção separada) são um cadastro
simples, só com nome — sem login nem senha. Servem só pra atribuir "quem
vai aplicar" na hora de criar uma aplicação/plantio; não são contas de
acesso ao app. Uma mesma pessoa pode, claro, ter os dois: uma conta de
usuário (pra usar o app) e aparecer também nesse cadastro (pra ser
atribuída como responsável).

A primeira conta criada no app (na tela inicial) vira administradora
automaticamente. Todas as contas seguintes só podem ser criadas por um
administrador logado, pela aba "Equipe".

## 13. Segurança básica já incluída

- Senhas nunca são guardadas em texto puro (são criptografadas com bcrypt).
- Cada ação exige um token de sessão válido (expira em 30 dias, aí a pessoa
  precisa logar de novo).
- Ações sensíveis (excluir máquina, excluir abastecimento, gerenciar a
  equipe, estoque, produtos, pivôs) são bloqueadas no servidor para quem não
  é administrador — não é só a tela que esconde o botão, a rota da API
  também recusa o pedido.
- Fotos só podem ser abertas por quem está logado no app.
