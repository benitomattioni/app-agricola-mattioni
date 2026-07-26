const { pool } = require("../db");

async function getCurrentStockBags() {
  const result = await pool.query("SELECT COALESCE(SUM(bags), 0) AS total FROM grain_stock_movements");
  return Number(result.rows[0].total);
}

async function recordMovement({ type, bags, note, harvestLoadId, saleId, userId }) {
  await pool.query(
    `INSERT INTO grain_stock_movements (type, bags, note, harvest_load_id, sale_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [type, bags, note || null, harvestLoadId || null, saleId || null, userId || null]
  );
}

module.exports = { getCurrentStockBags, recordMovement };
