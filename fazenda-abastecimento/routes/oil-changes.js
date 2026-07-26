const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const VALID_OIL_TYPES = ["motor", "hidraulico", "transmissao"];

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT oc.*, m.name AS machine_name, m.type AS machine_type
      FROM oil_changes oc
      JOIN machines m ON m.id = oc.machine_id
      ORDER BY oc.date DESC, oc.created_at DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar as trocas de óleo." });
  }
});

// Qualquer pessoa logada pode registrar uma troca de óleo (igual a um
// abastecimento) — não é uma ação restrita ao administrador.
router.post("/", async (req, res) => {
  const { machineId, date, reading, notes, oilType } = req.body || {};
  const type = oilType && VALID_OIL_TYPES.includes(oilType) ? oilType : "motor";

  if (!machineId || !date || reading === undefined || reading === null || Number(reading) < 0) {
    return res.status(400).json({ error: "Máquina, data e a leitura (horas ou km) são obrigatórios." });
  }

  try {
    const machineExists = await pool.query("SELECT id FROM machines WHERE id = $1", [machineId]);
    if (machineExists.rows.length === 0) {
      return res.status(404).json({ error: "Máquina não encontrada." });
    }

    const result = await pool.query(
      `INSERT INTO oil_changes (machine_id, date, reading, notes, oil_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [machineId, date, Number(reading), notes || null, type, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar a troca de óleo." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM oil_changes WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir a troca de óleo." });
  }
});

module.exports = router;
