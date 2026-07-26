const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM pivots ORDER BY number ASC NULLS LAST, name ASC");
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar os pivôs." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { name, number, crop, areaHectares } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do pivô é obrigatório." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO pivots (name, number, crop, area_hectares, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        name.trim(),
        (number && String(number).trim()) || null,
        (crop && crop.trim()) || null,
        areaHectares ? Number(areaHectares) : null,
        req.user.id,
      ]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao criar o pivô." });
  }
});

// Atualiza o pivô — usado principalmente pra trocar a cultura a cada safra.
// O formulário de edição sempre manda todos os campos, então sobrescreve
// direto (sem COALESCE) para permitir limpar número/cultura/área.
router.put("/:id", requireAdmin, async (req, res) => {
  const { name, number, crop, areaHectares } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do pivô é obrigatório." });
  }
  try {
    const result = await pool.query(
      `UPDATE pivots SET name = $1, number = $2, crop = $3, area_hectares = $4
       WHERE id = $5 RETURNING *`,
      [
        name.trim(),
        (number && String(number).trim()) || null,
        (crop && crop.trim()) || null,
        areaHectares ? Number(areaHectares) : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Pivô não encontrado." });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao atualizar o pivô." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM pivots WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir o pivô." });
  }
});

module.exports = router;
