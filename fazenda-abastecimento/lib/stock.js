const { pool } = require("../db");
const { notifyLowStock } = require("./notifications");

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD_LITERS || 1000);

async function getCurrentStockLiters() {
  const result = await pool.query("SELECT COALESCE(SUM(liters), 0) AS total FROM stock_movements");
  return Number(result.rows[0].total);
}

// Registra uma movimentação (positiva = reposição/ajuste pra cima, negativa =
// consumo) e verifica se cruzou o limite de estoque baixo.
async function recordMovement({ type, liters, note, refillId, userId, costPerLiter, totalCost }) {
  await pool.query(
    `INSERT INTO stock_movements (type, liters, note, refill_id, created_by, cost_per_liter, total_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      type,
      liters,
      note || null,
      refillId || null,
      userId || null,
      costPerLiter !== undefined && costPerLiter !== null ? costPerLiter : null,
      totalCost !== undefined && totalCost !== null ? totalCost : null,
    ]
  );
  await checkLowStockThreshold();
}

async function checkLowStockThreshold() {
  const current = await getCurrentStockLiters();
  const stateResult = await pool.query("SELECT low_stock_notified FROM stock_alert_state WHERE id = 1");
  const alreadyNotified = stateResult.rows[0]?.low_stock_notified || false;

  if (current <= LOW_STOCK_THRESHOLD && !alreadyNotified) {
    await pool.query("UPDATE stock_alert_state SET low_stock_notified = true WHERE id = 1");
    // Não bloqueia quem está registrando o abastecimento esperando o envio.
    notifyLowStock(current, LOW_STOCK_THRESHOLD).catch((e) =>
      console.error("Erro ao notificar estoque baixo:", e)
    );
  } else if (current > LOW_STOCK_THRESHOLD && alreadyNotified) {
    await pool.query("UPDATE stock_alert_state SET low_stock_notified = false WHERE id = 1");
  }

  return current;
}

async function getLastCostPerLiter() {
  const result = await pool.query(
    "SELECT cost_per_liter FROM stock_movements WHERE type = 'reposicao' AND cost_per_liter IS NOT NULL ORDER BY created_at DESC LIMIT 1"
  );
  return result.rows[0] ? Number(result.rows[0].cost_per_liter) : null;
}

module.exports = { getCurrentStockLiters, recordMovement, checkLowStockThreshold, LOW_STOCK_THRESHOLD, getLastCostPerLiter };
