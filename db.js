const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn(
    "Aviso: variável DATABASE_URL não definida. Configure-a com a conexão do seu banco Postgres."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'funcionario',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Migração idempotente: garante a coluna "role" mesmo em bancos criados
  // antes dela existir.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'funcionario';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS machines (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      identifier TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refills (
      id SERIAL PRIMARY KEY,
      machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      liters NUMERIC NOT NULL,
      total_cost NUMERIC NOT NULL,
      hourmeter NUMERIC,
      fuel_type TEXT,
      operator TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Fotos do abastecimento (painel/bomba e horímetro), guardadas como binário
  // direto no Postgres — não depende de nenhum serviço externo de arquivos.
  await pool.query(`ALTER TABLE refills ADD COLUMN IF NOT EXISTS photo_liters BYTEA;`);
  await pool.query(`ALTER TABLE refills ADD COLUMN IF NOT EXISTS photo_liters_mime TEXT;`);
  await pool.query(`ALTER TABLE refills ADD COLUMN IF NOT EXISTS photo_hourmeter BYTEA;`);
  await pool.query(`ALTER TABLE refills ADD COLUMN IF NOT EXISTS photo_hourmeter_mime TEXT;`);

  // Trocas de óleo por máquina. "reading" guarda a leitura no momento da
  // troca — horas (tratores/implementos/etc.) ou km (caminhões/camionetes),
  // dependendo do tipo da máquina. É a partir daqui que o app calcula o
  // alerta de "próxima troca" (por tempo ou por uso, o que vencer primeiro).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oil_changes (
      id SERIAL PRIMARY KEY,
      machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      reading NUMERIC NOT NULL,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // "motor" (padrão, toda máquina), "hidraulico" e "transmissao" (só
  // tratores, além do motor). Cada tipo tem seu próprio histórico e alerta.
  await pool.query(`ALTER TABLE oil_changes ADD COLUMN IF NOT EXISTS oil_type TEXT NOT NULL DEFAULT 'motor';`);

  // Estoque de diesel: cada linha é uma movimentação (reposição feita pelo
  // administrador = valor positivo; consumo de um abastecimento = valor
  // negativo). O estoque atual é sempre a soma de tudo — isso também dá um
  // histórico de reposições de graça.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL, -- 'reposicao' | 'consumo' | 'ajuste'
      liters NUMERIC NOT NULL,
      note TEXT,
      refill_id INTEGER REFERENCES refills(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Custo da reposição: informado pelo administrador ao abastecer o
  // reservatório, não mais em cada abastecimento individual das máquinas.
  await pool.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cost_per_liter NUMERIC;`);
  await pool.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS total_cost NUMERIC;`);

  // O valor do abastecimento deixou de ser obrigatório — o custo do diesel
  // agora é lançado na reposição do estoque, não em cada abastecimento.
  await pool.query(`ALTER TABLE refills ALTER COLUMN total_cost DROP NOT NULL;`);

  // Guarda se o alerta de estoque baixo já foi disparado, pra não enviar a
  // mesma notificação repetidas vezes enquanto o estoque continua baixo.
  // Reseta sozinho quando o estoque volta a subir acima do limite.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_alert_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      low_stock_notified BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);
  await pool.query(`
    INSERT INTO stock_alert_state (id, low_stock_notified)
    VALUES (1, false)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Inscrições de notificação push (uma por dispositivo/navegador que ativou
  // o alerta), usadas pra avisar o administrador no celular.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ---- Defensivos agrícolas (produtos, pivôs e aplicações) ----

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'outro', -- herbicida | fungicida | inseticida | adjuvante | outro
      unit TEXT NOT NULL DEFAULT 'L',
      cost_per_liter NUMERIC NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pivots (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      area_hectares NUMERIC,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Número identificador do pivô e a cultura atual plantada nele (pode
  // mudar de safra pra safra, por isso é editável).
  await pool.query(`ALTER TABLE pivots ADD COLUMN IF NOT EXISTS number TEXT;`);
  await pool.query(`ALTER TABLE pivots ADD COLUMN IF NOT EXISTS crop TEXT;`);

  // Vínculo opcional do abastecimento com um pivô (motor de irrigação a
  // diesel, por exemplo). Fica em branco = "uso geral", sem pivô específico.
  await pool.query(`ALTER TABLE refills ADD COLUMN IF NOT EXISTS pivot_id INTEGER REFERENCES pivots(id) ON DELETE SET NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      pivot_id INTEGER NOT NULL REFERENCES pivots(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      dosage_liters NUMERIC NOT NULL,
      cost_per_liter NUMERIC NOT NULL,
      total_cost NUMERIC NOT NULL,
      operator TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Guarda a cultura do pivô no momento da aplicação (uma "foto" do dado),
  // pra relatório de custo por cultura continuar correto mesmo se o pivô
  // mudar de cultura numa safra seguinte.
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS crop TEXT;`);
  // Área efetivamente tratada naquela aplicação (pode ser menor que a área
  // total do pivô, em aplicações parciais). É o que o funcionário registra,
  // junto com o produto usado — sem acesso a preços/custos.
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS area_applied_hectares NUMERIC;`);
  // Agrupa várias linhas de aplicação feitas juntas na mesma passada (ex.:
  // até 8 produtos misturados no tanque, aplicados de uma vez no pivô).
  // Linhas com o mesmo batch_id formam um único cartão na tela.
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS batch_id TEXT;`);
  // "aplicacao" (defensivo/adubo em cobertura, o padrão de sempre) ou
  // "plantio" (semente, adubo de base, tratamento de semente, jato dirigido
  // — tudo lançado no dia do plantio, com dosagem por hectare). Ambos usam
  // a mesma tabela e o mesmo mecanismo de "passada" (batch_id).
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'aplicacao';`);
  // Guarda a dosagem por hectare como foi digitada (quando o lançamento é
  // feito nesse modo) — dosage_liters continua sendo o total (dosagem por
  // hectare × área), pra manter compatível com o resto do app.
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS dosage_per_hectare NUMERIC;`);
  // A partir de agora só o administrador cria uma aplicação/plantio (é um
  // planejamento: "isso precisa ser feito"). "assigned_to" é o nome do
  // funcionário de campo responsável por executar. "executed_at"/
  // "executed_by" ficam nulos até alguém marcar como feito — antes disso,
  // o lançamento aparece como pendente no Painel.
  const executedColumnCheck = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'applications' AND column_name = 'executed_at'
  `);
  const executedColumnIsNew = executedColumnCheck.rows.length === 0;
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS assigned_to TEXT;`);
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS executed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  if (executedColumnIsNew) {
    // Só roda uma vez, no exato momento em que a coluna é criada: marca
    // lançamentos já existentes (de antes dessa mudança) como já
    // executados, pra não ficarem travados aparecendo como "pendentes"
    // pra sempre. Em qualquer reinício futuro do servidor, a coluna já
    // vai existir e esse bloco não roda de novo.
    await pool.query(`UPDATE applications SET executed_at = COALESCE(created_at, now()) WHERE executed_at IS NULL;`);
  }

  // Cadastro simples de funcionários de campo (só nome) — usado pra
  // atribuir quem vai aplicar, sem precisar criar um login/conta de
  // usuário pra cada pessoa que trabalha na lavoura.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS field_workers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);


  // ---- Cultivos: cada linha é "esta cultura foi plantada neste pivô nesta
  // data, com previsão de colheita em tal data". Substitui o campo solto
  // "cultura atual" do pivô por um cadastro estruturado, com histórico.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plantings (
      id SERIAL PRIMARY KEY,
      pivot_id INTEGER NOT NULL REFERENCES pivots(id) ON DELETE CASCADE,
      crop TEXT NOT NULL,
      planting_date DATE NOT NULL,
      expected_harvest_date DATE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ---- Energia: custo mensal de demanda + consumo, opcionalmente ligado a
  // um pivô específico (motor de irrigação), para entrar no custo por cultura.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS energy_entries (
      id SERIAL PRIMARY KEY,
      pivot_id INTEGER REFERENCES pivots(id) ON DELETE SET NULL,
      reference_month DATE NOT NULL,
      demand_cost NUMERIC NOT NULL DEFAULT 0,
      consumption_cost NUMERIC NOT NULL DEFAULT 0,
      total_cost NUMERIC NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Estoque dos defensivos — mesmo padrão do estoque de diesel (ledger de
  // movimentações), só que uma linha de estoque por produto.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_stock_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- 'reposicao' | 'consumo' | 'ajuste'
      liters NUMERIC NOT NULL,
      note TEXT,
      application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ---- Produção por pivô (cargas de colheita) e estoque de grãos ----

  await pool.query(`
    CREATE TABLE IF NOT EXISTS harvest_loads (
      id SERIAL PRIMARY KEY,
      pivot_id INTEGER NOT NULL REFERENCES pivots(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      gross_weight_kg NUMERIC NOT NULL,
      tare_weight_kg NUMERIC NOT NULL,
      net_weight_kg NUMERIC NOT NULL,
      bags_60kg NUMERIC NOT NULL,
      crop TEXT,
      operator TEXT,
      notes TEXT,
      photo_gross BYTEA,
      photo_gross_mime TEXT,
      photo_tare BYTEA,
      photo_tare_mime TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Vincula cada carga ao plantio (cultura) específico, não só ao nome da
  // cultura em texto — assim dá pra separar dois ciclos da mesma cultura
  // no mesmo pivô (ex.: soja de 2025 vs. soja de 2026) na Produtividade.
  await pool.query(`ALTER TABLE harvest_loads ADD COLUMN IF NOT EXISTS planting_id INTEGER REFERENCES plantings(id) ON DELETE SET NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      gross_weight_kg NUMERIC NOT NULL,
      tare_weight_kg NUMERIC NOT NULL,
      net_weight_kg NUMERIC NOT NULL,
      bags_60kg NUMERIC NOT NULL,
      vehicle_plate TEXT,
      price_per_bag NUMERIC NOT NULL DEFAULT 0,
      total_value NUMERIC NOT NULL DEFAULT 0,
      paid BOOLEAN NOT NULL DEFAULT false,
      operator TEXT,
      notes TEXT,
      photo_gross BYTEA,
      photo_gross_mime TEXT,
      photo_tare BYTEA,
      photo_tare_mime TEXT,
      photo_plate BYTEA,
      photo_plate_mime TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Vincula a venda à cultura (plantio) de onde as sacas saíram — assim o
  // estoque de grãos passa a ser calculado por cultura em cada pivô, não
  // como um total único da fazenda inteira.
  await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS planting_id INTEGER REFERENCES plantings(id) ON DELETE SET NULL;`);
  // O estoque de grãos virou por TIPO DE GRÃO (nome da cultura), somando
  // todos os pivôs/ciclos que produziram aquele grão — não por pivô ou
  // ciclo específico. "crop" aqui é só o nome da cultura em texto (ex.:
  // "Soja"), igual ao que já existe em harvest_loads.
  await pool.query(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS crop TEXT;`);

  // Estoque de grãos (em sacas de 60kg): produção soma, venda desconta —
  // mesmo padrão em ledger usado pro diesel e pelos defensivos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grain_stock_movements (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL, -- 'producao' | 'venda' | 'ajuste'
      bags NUMERIC NOT NULL,
      note TEXT,
      harvest_load_id INTEGER REFERENCES harvest_loads(id) ON DELETE SET NULL,
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

module.exports = { pool, initDb };
