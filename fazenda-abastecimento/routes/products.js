const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getStockByProduct, recordMovement } = require("../lib/product-stock");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const [products, stock] = await Promise.all([
      pool.query("SELECT * FROM products ORDER BY name ASC"),
      getStockByProduct(),
    ]);
    let rows = products.rows.map((p) => ({ ...p, stock_liters: stock[p.id] || 0 }));
    // Preço/custo é informação restrita ao administrador.
    if (req.user.role !== "admin") {
      rows = rows.map(({ cost_per_liter, ...rest }) => rest);
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar os defensivos." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { name, category, unit, costPerLiter } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do produto é obrigatório." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO products (name, category, unit, cost_per_liter, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        name.trim(),
        category || "outro",
        (unit && unit.trim()) || "L",
        Number(costPerLiter) || 0,
        req.user.id,
      ]
    );
    res.json({ ...result.rows[0], stock_liters: 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao criar o produto." });
  }
});

// Atualiza nome/categoria/custo por litro do produto (o custo passa a valer
// para as próximas aplicações — aplicações já feitas guardam o custo da
// época, então o histórico não muda).
router.put("/:id", requireAdmin, async (req, res) => {
  const { name, category, unit, costPerLiter } = req.body || {};
  try {
    const result = await pool.query(
      `UPDATE products SET
         name = COALESCE($1, name),
         category = COALESCE($2, category),
         unit = COALESCE($3, unit),
         cost_per_liter = COALESCE($4, cost_per_liter)
       WHERE id = $5 RETURNING *`,
      [
        name ? name.trim() : null,
        category || null,
        unit || null,
        costPerLiter !== undefined && costPerLiter !== null ? Number(costPerLiter) : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Produto não encontrado." });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao atualizar o produto." });
  }
});

router.post("/:id/restock", requireAdmin, async (req, res) => {
  const { liters, note } = req.body || {};
  const litersNum = Number(liters);
  if (!litersNum || litersNum <= 0) {
    return res.status(400).json({ error: "Informe uma quantidade de litros maior que zero." });
  }
  try {
    await recordMovement({
      productId: req.params.id,
      type: "reposicao",
      liters: litersNum,
      note,
      userId: req.user.id,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar a reposição." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir o produto." });
  }
});

module.exports = router;
