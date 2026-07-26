const crypto = require("crypto");
const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { recordMovement } = require("../lib/product-stock");
const { findCropForPivot } = require("../lib/plantings");

const router = express.Router();
router.use(requireAuth);

const MAX_ITEMS = 8;

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.name AS pivot_name, pr.name AS product_name, pr.unit AS product_unit
      FROM applications a
      JOIN pivots p ON p.id = a.pivot_id
      JOIN products pr ON pr.id = a.product_id
      ORDER BY a.date DESC, a.created_at DESC, a.id DESC
    `);
    // Custos são informação restrita ao administrador.
    const rows = req.user.role === "admin"
      ? result.rows
      : result.rows.map(({ cost_per_liter, total_cost, ...rest }) => rest);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar as aplicações." });
  }
});

// Só o administrador registra uma aplicação/plantio — é um planejamento
// ("isso precisa ser feito"), não a execução em si. Pode misturar vários
// produtos no mesmo tanque (até 8) — cada produto vira uma linha na
// tabela, todas compartilhando o mesmo batch_id, pivô, data e área.
// O estoque só é descontado quando alguém marca como executado.
router.post("/", requireAdmin, async (req, res) => {
  const { pivotId, date, areaAppliedHectares, assignedTo, notes, items, kind } = req.body || {};
  const applicationKind = kind === "plantio" ? "plantio" : "aplicacao";

  if (!pivotId || !date || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Pivô, data e ao menos um produto são obrigatórios." });
  }
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ error: "No máximo " + MAX_ITEMS + " produtos por aplicação." });
  }
  if (applicationKind === "plantio" && !areaAppliedHectares) {
    return res.status(400).json({ error: "Informe a área plantada (hectares) para lançar um plantio." });
  }
  for (const item of items) {
    if (!item.productId || !item.dosageLiters || Number(item.dosageLiters) <= 0) {
      return res.status(400).json({ error: "Cada produto precisa de uma dosagem maior que zero." });
    }
  }

  try {
    const pivotExists = await pool.query("SELECT id FROM pivots WHERE id = $1", [pivotId]);
    if (pivotExists.rows.length === 0) {
      return res.status(404).json({ error: "Pivô não encontrado." });
    }

    const productIds = items.map((i) => i.productId);
    const productsResult = await pool.query(
      "SELECT id, cost_per_liter FROM products WHERE id = ANY($1::int[])",
      [productIds]
    );
    const costById = {};
    productsResult.rows.forEach((p) => { costById[p.id] = Number(p.cost_per_liter) || 0; });
    if (productsResult.rows.length !== new Set(productIds).size) {
      return res.status(404).json({ error: "Um ou mais produtos não foram encontrados." });
    }

    const { crop } = await findCropForPivot(pivotId, date);
    const batchId = items.length > 1 ? crypto.randomUUID() : null;
    const area = areaAppliedHectares ? Number(areaAppliedHectares) : null;

    const created = [];
    for (const item of items) {
      const dosage = Number(item.dosageLiters);
      const dosagePerHectare = item.dosagePerHectare !== undefined && item.dosagePerHectare !== null
        ? Number(item.dosagePerHectare)
        : null;
      const costPerLiter = costById[item.productId];
      const totalCost = dosage * costPerLiter;

      const result = await pool.query(
        `INSERT INTO applications
          (pivot_id, product_id, date, dosage_liters, dosage_per_hectare, cost_per_liter, total_cost,
           assigned_to, notes, created_by, crop, area_applied_hectares, batch_id, kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          pivotId, item.productId, date, dosage, dosagePerHectare, costPerLiter, totalCost,
          assignedTo || null, notes || null, req.user.id, crop, area, batchId, applicationKind,
        ]
      );
      created.push(result.rows[0]);
    }

    res.json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar a aplicação." });
  }
});

// Marca como executado — qualquer pessoa logada pode (é o funcionário
// confirmando que aplicou/plantou). Marca junto todas as linhas da mesma
// passada (mesmo batch_id), e só nesse momento desconta o estoque —
// enquanto pendente, o produto ainda não foi de fato usado.
router.put("/:id/executed", async (req, res) => {
  try {
    const existing = await pool.query("SELECT * FROM applications WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Lançamento não encontrado." });
    }
    const row = existing.rows[0];
    if (row.executed_at) {
      return res.status(400).json({ error: "Esse lançamento já foi marcado como executado." });
    }

    const batchRows = row.batch_id
      ? (await pool.query("SELECT * FROM applications WHERE batch_id = $1", [row.batch_id])).rows
      : [row];

    const updated = await pool.query(
      `UPDATE applications SET executed_at = now(), executed_by = $1
       WHERE id = ANY($2::int[]) RETURNING *`,
      [req.user.id, batchRows.map((r) => r.id)]
    );

    res.json(updated.rows);

    batchRows.forEach((application) => {
      recordMovement({
        productId: application.product_id,
        type: "consumo",
        liters: -Math.abs(Number(application.dosage_liters)),
        note: "Aplicação #" + application.id,
        applicationId: application.id,
        userId: req.user.id,
      }).catch((e) => console.error("Erro ao descontar estoque do defensivo:", e));
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao marcar como executado." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const existing = await pool.query(
      "SELECT product_id, dosage_liters, executed_at FROM applications WHERE id = $1",
      [req.params.id]
    );
    await pool.query("DELETE FROM applications WHERE id = $1", [req.params.id]);

    const row = existing.rows[0];
    // Só estorna estoque se já tinha sido descontado (ou seja, se já
    // estava marcado como executado) — senão nunca foi descontado.
    if (row && row.executed_at) {
      recordMovement({
        productId: row.product_id,
        type: "ajuste",
        liters: Math.abs(Number(row.dosage_liters)),
        note: "Estorno da aplicação #" + req.params.id + " (excluída)",
        userId: req.user.id,
      }).catch((e) => console.error("Erro ao estornar estoque do defensivo:", e));
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir a aplicação." });
  }
});

module.exports = router;
