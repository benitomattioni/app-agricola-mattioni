const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pl.*, p.name AS pivot_name, p.number AS pivot_number
      FROM plantings pl
      JOIN pivots p ON p.id = pl.pivot_id
      ORDER BY pl.planting_date DESC, pl.created_at DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar as culturas." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { pivotId, crop, plantingDate, expectedHarvestDate } = req.body || {};
  if (!pivotId || !crop || !crop.trim() || !plantingDate) {
    return res.status(400).json({ error: "Pivô, cultura e data de plantio são obrigatórios." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO plantings (pivot_id, crop, planting_date, expected_harvest_date, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pivotId, crop.trim(), plantingDate, expectedHarvestDate || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao cadastrar a cultura." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM plantings WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir a cultura." });
  }
});

// Relatório de custo por cultura EM CADA PIVÔ (não um total genérico por
// pivô) — só administrador. Para cada cultivo cadastrado, soma:
//  - Adubos: aplicações com produto da categoria "adubo" nesse pivô, dentro
//    do período do plantio.
//  - Defensivos: aplicações com produto de qualquer outra categoria.
//  - Energia: lançamentos de energia daquele pivô, dentro do período.
//  - Diesel: abastecimentos com combustível diesel vinculados àquele pivô,
//    dentro do período (o custo é uma estimativa: litros × custo por litro
//    da reposição de diesel mais recente na hora do abastecimento).
//    Abastecimentos sem pivô vinculado ("uso geral") entram à parte, em
//    generalDiesel, e não em nenhum cartão de cultura.
router.get("/costs", requireAdmin, async (req, res) => {
  try {
    const [plantingsResult, applicationsResult, energyResult, dieselResult] = await Promise.all([
      pool.query(`
        SELECT pl.*, p.name AS pivot_name, p.number AS pivot_number, p.area_hectares
        FROM plantings pl
        JOIN pivots p ON p.id = pl.pivot_id
        ORDER BY pl.planting_date DESC
      `),
      pool.query(`
        SELECT a.pivot_id, a.date, a.total_cost, pr.category
        FROM applications a
        JOIN products pr ON pr.id = a.product_id
      `),
      pool.query(`
        SELECT pivot_id, reference_month, total_cost
        FROM energy_entries
        WHERE pivot_id IS NOT NULL
      `),
      pool.query(`
        SELECT pivot_id, date, total_cost
        FROM refills
        WHERE fuel_type ILIKE '%diesel%' AND total_cost IS NOT NULL
      `),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const toISO = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

    // Diesel de uso geral: abastecimentos sem pivô vinculado — não entra em
    // nenhum cartão de cultura, mas é útil mostrar o total à parte.
    const generalDiesel = dieselResult.rows
      .filter((r) => r.pivot_id === null)
      .reduce((s, r) => s + Number(r.total_cost || 0), 0);

    const costs = plantingsResult.rows.map((planting) => {
      const start = planting.planting_date;
      const end = planting.expected_harvest_date || today;

      let adubos = 0;
      let sementes = 0;
      let defensivos = 0;
      applicationsResult.rows.forEach((a) => {
        if (String(a.pivot_id) !== String(planting.pivot_id)) return;
        const d = toISO(a.date);
        if (d < start || d > end) return;
        if (a.category === "adubo") adubos += Number(a.total_cost || 0);
        else if (a.category === "semente" || a.category === "tratamento_semente") sementes += Number(a.total_cost || 0);
        else defensivos += Number(a.total_cost || 0);
      });

      let energia = 0;
      energyResult.rows.forEach((e) => {
        if (String(e.pivot_id) !== String(planting.pivot_id)) return;
        const d = toISO(e.reference_month);
        if (d < start || d > end) return;
        energia += Number(e.total_cost || 0);
      });

      let diesel = 0;
      dieselResult.rows.forEach((r) => {
        if (r.pivot_id === null || String(r.pivot_id) !== String(planting.pivot_id)) return;
        const d = toISO(r.date);
        if (d < start || d > end) return;
        diesel += Number(r.total_cost || 0);
      });

      const total = adubos + sementes + defensivos + energia + diesel;
      const areaHectares = planting.area_hectares ? Number(planting.area_hectares) : null;

      return {
        pivotId: planting.pivot_id,
        pivotName: planting.pivot_name,
        pivotNumber: planting.pivot_number,
        crop: planting.crop,
        plantingDate: planting.planting_date,
        expectedHarvestDate: planting.expected_harvest_date,
        areaHectares,
        adubos,
        sementes,
        defensivos,
        energia,
        diesel,
        total,
        costPerHectare: areaHectares ? total / areaHectares : null,
      };
    });

    res.json({ plantings: costs, generalDiesel });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao calcular o custo por cultura." });
  }
});

module.exports = router;
