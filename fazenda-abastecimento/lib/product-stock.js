const { pool } = require("../db");

async function getStockForProduct(productId) {
  const result = await pool.query(
    "SELECT COALESCE(SUM(liters), 0) AS total FROM product_stock_movements WHERE product_id = $1",
    [productId]
  );
  return Number(result.rows[0].total);
}

// Estoque de todos os produtos de uma vez (evita N consultas na listagem).
async function getStockByProduct() {
  const result = await pool.query(`
    SELECT product_id, COALESCE(SUM(liters), 0) AS total
    FROM product_stock_movements
    GROUP BY product_id
  `);
  const map = {};
  result.rows.forEach((r) => (map[r.product_id] = Number(r.total)));
  return map;
}

async function recordMovement({ productId, type, liters, note, applicationId, userId }) {
  await pool.query(
    `INSERT INTO product_stock_movements (product_id, type, liters, note, application_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [productId, type, liters, note || null, applicationId || null, userId || null]
  );
}

module.exports = { getStockForProduct, getStockByProduct, recordMovement };
