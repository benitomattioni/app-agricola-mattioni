const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM machines ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar máquinas." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { name, type, identifier } = req.body || {};

  if (!name || !name.trim() || !type) {
    return res.status(400).json({ error: "Nome e tipo são obrigatórios." });
  }

  try {
    const result = await pool.query(
      "INSERT INTO machines (name, type, identifier, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
      [name.trim(), type, identifier ? identifier.trim() : null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao criar máquina." });
  }
});

// Edita nome/tipo/identificação de uma máquina já cadastrada. Não afeta o
// histórico (abastecimentos, trocas de óleo etc. continuam vinculados pelo
// mesmo id).
router.put("/:id", requireAdmin, async (req, res) => {
  const { name, type, identifier } = req.body || {};

  if (!name || !name.trim() || !type) {
    return res.status(400).json({ error: "Nome e tipo são obrigatórios." });
  }

  try {
    const result = await pool.query(
      "UPDATE machines SET name = $1, type = $2, identifier = $3 WHERE id = $4 RETURNING *",
      [name.trim(), type, identifier ? identifier.trim() : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Máquina não encontrada." });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao editar máquina." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM machines WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir máquina." });
  }
});

module.exports = router;
