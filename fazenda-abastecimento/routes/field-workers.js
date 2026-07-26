const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Cadastro simples (só nome) de quem trabalha no campo — usado pra atribuir
// responsável nas aplicações/plantios. Não é uma conta de login: qualquer
// pessoa logada pode ver a lista (pra saber quem está atribuído a quê),
// mas só o administrador cadastra ou remove um nome.
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM field_workers ORDER BY name ASC");
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar os funcionários de campo." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Informe o nome do funcionário." });
  }
  try {
    const result = await pool.query(
      "INSERT INTO field_workers (name, created_by) VALUES ($1,$2) RETURNING *",
      [name.trim(), req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao cadastrar o funcionário." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM field_workers WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir o funcionário." });
  }
});

module.exports = router;
