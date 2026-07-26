const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// Lista a equipe (só administrador vê). Contas são criadas via
// POST /api/auth/register, enviado com o token do administrador.
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC"
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar a equipe." });
  }
});

router.delete("/:id", async (req, res) => {
  if (String(req.params.id) === String(req.user.id)) {
    return res.status(400).json({ error: "Você não pode remover sua própria conta." });
  }
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao remover usuário." });
  }
});

module.exports = router;
