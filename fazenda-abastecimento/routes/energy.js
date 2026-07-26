const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
// Energia é informação financeira — igual ao padrão já usado pra estoque de
// grãos e preços de defensivos, fica restrita ao administrador (ver e lançar).
router.use(requireAuth);
router.use(requireAdmin);

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, p.name AS pivot_name, p.number AS pivot_number
      FROM energy_entries e
      LEFT JOIN pivots p ON p.id = e.pivot_id
      ORDER BY e.reference_month DESC, e.created_at DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar os lançamentos de energia." });
  }
});

router.post("/", async (req, res) => {
  const { pivotId, referenceMonth, demandCost, consumptionCost, note } = req.body || {};
  if (!referenceMonth) {
    return res.status(400).json({ error: "Informe o mês de referência." });
  }
  const demand = Number(demandCost) || 0;
  const consumption = Number(consumptionCost) || 0;
  if (demand <= 0 && consumption <= 0) {
    return res.status(400).json({ error: "Informe ao menos o custo da demanda ou do consumo." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO energy_entries (pivot_id, reference_month, demand_cost, consumption_cost, total_cost, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pivotId || null, referenceMonth, demand, consumption, demand + consumption, note || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar o lançamento de energia." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM energy_entries WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir o lançamento." });
  }
});

module.exports = router;
