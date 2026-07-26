const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getCurrentStockLiters, recordMovement, LOW_STOCK_THRESHOLD } = require("../lib/stock");

const router = express.Router();
router.use(requireAuth);

async function getCostSummary() {
  const lastResult = await pool.query(
    "SELECT cost_per_liter FROM stock_movements WHERE type = 'reposicao' AND cost_per_liter IS NOT NULL ORDER BY created_at DESC LIMIT 1"
  );
  const totalResult = await pool.query(
    "SELECT COALESCE(SUM(total_cost), 0) AS total FROM stock_movements WHERE type = 'reposicao'"
  );
  return {
    lastCostPerLiter: lastResult.rows[0] ? Number(lastResult.rows[0].cost_per_liter) : null,
    totalInvested: Number(totalResult.rows[0].total),
  };
}

// Qualquer pessoa logada pode ver o nível do estoque.
router.get("/", async (req, res) => {
  try {
    const liters = await getCurrentStockLiters();
    const isAdmin = req.user.role === "admin";
    const costInfo = isAdmin ? await getCostSummary() : { lastCostPerLiter: null, totalInvested: null };
    res.json({
      liters,
      threshold: LOW_STOCK_THRESHOLD,
      low: liters <= LOW_STOCK_THRESHOLD,
      lastCostPerLiter: costInfo.lastCostPerLiter,
      totalInvested: costInfo.totalInvested,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar o estoque." });
  }
});

// Histórico de movimentações — só admin.
router.get("/movements", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sm.id, sm.type, sm.liters, sm.note, sm.refill_id, sm.cost_per_liter, sm.total_cost,
             sm.created_at, u.name AS created_by_name
      FROM stock_movements sm
      LEFT JOIN users u ON u.id = sm.created_by
      ORDER BY sm.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar o histórico do estoque." });
  }
});

// Reposição de diesel — só admin alimenta o estoque, já com o custo por litro
// pago naquela compra.
router.post("/restock", requireAdmin, async (req, res) => {
  const { liters, costPerLiter, note } = req.body || {};
  const litersNum = Number(liters);
  const costNum = Number(costPerLiter);
  if (!litersNum || litersNum <= 0) {
    return res.status(400).json({ error: "Informe uma quantidade de litros maior que zero." });
  }
  if (!costNum || costNum <= 0) {
    return res.status(400).json({ error: "Informe o custo por litro dessa reposição." });
  }
  try {
    await recordMovement({
      type: "reposicao",
      liters: litersNum,
      note,
      userId: req.user.id,
      costPerLiter: costNum,
      totalCost: litersNum * costNum,
    });
    const liters2 = await getCurrentStockLiters();
    const { lastCostPerLiter, totalInvested } = await getCostSummary();
    res.json({
      liters: liters2,
      threshold: LOW_STOCK_THRESHOLD,
      low: liters2 <= LOW_STOCK_THRESHOLD,
      lastCostPerLiter,
      totalInvested,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar a reposição." });
  }
});

module.exports = router;
