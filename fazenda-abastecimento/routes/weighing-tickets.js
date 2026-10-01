const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);
const BAG_KG = 60;

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM weighing_tickets ORDER BY date DESC, created_at DESC`);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar as pesagens." });
  }
});

// Abre uma pesagem com a 1ª leitura da balança. O que essa leitura
// significa (tara ou peso bruto) depende do fluxo:
//  - terceiros / fazenda+saída: o veículo chega vazio → 1ª leitura = tara
//  - fazenda+entrada (produto ou grão): o veículo chega carregado →
//    1ª leitura = peso bruto
// Isso só importa pra rotular a tela; o cálculo do líquido usa sempre o
// maior menos o menor das duas leituras, então a ordem nunca quebra nada.
router.post("/", async (req, res) => {
  const {
    kind, flow, subflow, date, vehiclePlate, driverName, clientName, cargo,
    crop, productId, plantingId, openingWeightKg, operator, notes,
  } = req.body || {};

  if (kind !== "fazenda" && kind !== "terceiros") {
    return res.status(400).json({ error: "Informe se a pesagem é da fazenda ou de terceiros." });
  }
  if (!date || openingWeightKg === undefined || openingWeightKg === null || Number(openingWeightKg) <= 0) {
    return res.status(400).json({ error: "Data e peso da 1ª pesagem são obrigatórios." });
  }
  if (kind === "terceiros" && (!clientName || !clientName.trim())) {
    return res.status(400).json({ error: "Informe o cliente/empresa para uma pesagem de terceiros." });
  }
  if (kind === "fazenda") {
    if (flow !== "entrada" && flow !== "saida") {
      return res.status(400).json({ error: "Informe se é uma entrada ou uma saída da fazenda." });
    }
    if (flow === "saida" && (!crop || !crop.trim())) {
      return res.status(400).json({ error: "Selecione o tipo de grão dessa saída." });
    }
    if (flow === "entrada") {
      if (subflow !== "produto" && subflow !== "grao") {
        return res.status(400).json({ error: "Informe se a entrada é de produto ou de grão." });
      }
      if (subflow === "produto" && !productId) {
        return res.status(400).json({ error: "Selecione o produto dessa entrada." });
      }
      if (subflow === "grao" && !plantingId) {
        return res.status(400).json({ error: "Selecione a cultura dessa entrada de grão." });
      }
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO weighing_tickets
        (kind, flow, subflow, date, vehicle_plate, driver_name, client_name, cargo, crop,
         product_id, planting_id, opening_weight_kg, operator, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        kind,
        kind === "fazenda" ? flow : null,
        kind === "fazenda" && flow === "entrada" ? subflow : null,
        date,
        vehiclePlate ? vehiclePlate.trim().toUpperCase() : null,
        driverName ? driverName.trim() : null,
        kind === "terceiros" ? clientName.trim() : null,
        cargo ? cargo.trim() : null,
        kind === "fazenda" && flow === "saida" ? crop.trim() : null,
        kind === "fazenda" && flow === "entrada" && subflow === "produto" ? productId : null,
        kind === "fazenda" && flow === "entrada" && subflow === "grao" ? plantingId : null,
        Number(openingWeightKg),
        (operator && operator.trim()) || req.user.name,
        notes || null,
        req.user.id,
      ]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao abrir a pesagem." });
  }
});

// Fecha a pesagem com a 2ª leitura. Calcula tara/bruto/líquido (o maior
// dos dois pesos é sempre o bruto, não importa a ordem em que foram
// digitados) e, conforme o tipo, manda o resultado pro lugar certo:
// vira ticket (terceiros), vira venda (fazenda+saída), vira carga em
// Entradas (fazenda+entrada+grão) ou soma no estoque do produto
// (fazenda+entrada+produto).
// Escolhe a cultura de uma pesagem que chegou pela leitura automática
// (câmera + balança) sem saber ainda o que estava sendo colhido. Pode
// ser chamada a qualquer momento — antes ou depois da 2ª pesagem. Se as
// duas leituras já estiverem feitas, migra pra Entradas na hora; senão,
// só grava a cultura e a pesagem continua esperando a 2ª leitura.
router.put("/:id/classify", async (req, res) => {
  const { plantingId } = req.body || {};
  if (!plantingId) return res.status(400).json({ error: "Selecione a cultura." });

  try {
    const existing = await pool.query("SELECT * FROM weighing_tickets WHERE id = $1", [req.params.id]);
    const t = existing.rows[0];
    if (!t) return res.status(404).json({ error: "Pesagem não encontrada." });
    if (t.planting_id) return res.status(400).json({ error: "Essa pesagem já tem uma cultura selecionada." });

    const plantingResult = await pool.query("SELECT id, pivot_id, crop FROM plantings WHERE id = $1", [plantingId]);
    const planting = plantingResult.rows[0];
    if (!planting) return res.status(404).json({ error: "Cultura não encontrada." });

    let migratedTo = t.migrated_to;
    let migratedId = t.migrated_id;

    if (t.closing_weight_kg !== null && !t.migrated_to) {
      const bags = Number(t.net_weight_kg) / BAG_KG;
      const loadResult = await pool.query(
        `INSERT INTO harvest_loads (pivot_id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop, planting_id, operator, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [planting.pivot_id, t.date, t.gross_weight_kg, t.tare_weight_kg, t.net_weight_kg, bags, planting.crop, planting.id, t.operator, t.notes]
      );
      migratedTo = "harvest_load";
      migratedId = loadResult.rows[0].id;
    }

    const result = await pool.query(
      `UPDATE weighing_tickets SET planting_id = $1, crop = $2, migrated_to = $3, migrated_id = $4 WHERE id = $5 RETURNING *`,
      [planting.id, planting.crop, migratedTo, migratedId, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao selecionar a cultura." });
  }
});

router.put("/:id/close", async (req, res) => {
  const { closingWeightKg, price, pricePerBag, buyer, paid } = req.body || {};

  if (closingWeightKg === undefined || closingWeightKg === null || Number(closingWeightKg) <= 0) {
    return res.status(400).json({ error: "Informe o peso da 2ª pesagem." });
  }

  try {
    const existing = await pool.query("SELECT * FROM weighing_tickets WHERE id = $1", [req.params.id]);
    const t = existing.rows[0];
    if (!t) return res.status(404).json({ error: "Pesagem não encontrada." });
    if (t.closing_weight_kg !== null) {
      return res.status(400).json({ error: "Essa pesagem já foi fechada." });
    }

    const closing = Number(closingWeightKg);
    const opening = Number(t.opening_weight_kg);
    const tare = Math.min(opening, closing);
    const gross = Math.max(opening, closing);
    const net = gross - tare;
    if (net <= 0) {
      return res.status(400).json({ error: "As duas pesagens não podem ser iguais." });
    }

    let migratedTo = null;
    let migratedId = null;
    let finalPrice = null;
    let finalPricePerBag = null;
    let finalPaid = !!paid;

    if (t.kind === "terceiros") {
      finalPrice = price !== undefined && price !== null && price !== "" ? Number(price) : null;
    } else if (t.flow === "saida") {
      finalPricePerBag = pricePerBag !== undefined && pricePerBag !== null && pricePerBag !== "" ? Number(pricePerBag) : 0;
      const bags = net / BAG_KG;
      const totalValue = bags * finalPricePerBag;
      const saleResult = await pool.query(
        `INSERT INTO sales
          (date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop, buyer, vehicle_plate,
           price_per_bag, total_value, paid, operator, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          t.date, gross, tare, net, bags, t.crop, buyer ? buyer.trim() : null, t.vehicle_plate,
          finalPricePerBag, totalValue, finalPaid, t.operator, t.notes, t.created_by,
        ]
      );
      migratedTo = "sale";
      migratedId = saleResult.rows[0].id;
    } else if (t.flow === "entrada" && t.subflow === "grao") {
      const plantingResult = await pool.query("SELECT id, pivot_id, crop FROM plantings WHERE id = $1", [t.planting_id]);
      const planting = plantingResult.rows[0];
      if (!planting) return res.status(404).json({ error: "A cultura dessa entrada não existe mais." });
      const bags = net / BAG_KG;
      const loadResult = await pool.query(
        `INSERT INTO harvest_loads
          (pivot_id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop, planting_id,
           operator, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [planting.pivot_id, t.date, gross, tare, net, bags, planting.crop, planting.id, t.operator, t.notes, t.created_by]
      );
      migratedTo = "harvest_load";
      migratedId = loadResult.rows[0].id;
    } else if (t.flow === "entrada" && t.subflow === "produto") {
      const productResult = await pool.query(
        "UPDATE products SET stock_liters = stock_liters + $1 WHERE id = $2 RETURNING id",
        [net, t.product_id]
      );
      if (productResult.rows.length === 0) return res.status(404).json({ error: "O produto dessa entrada não existe mais." });
      migratedTo = "product_restock";
      migratedId = t.product_id;
    }

    const result = await pool.query(
      `UPDATE weighing_tickets SET
        closing_weight_kg = $1, tare_weight_kg = $2, gross_weight_kg = $3, net_weight_kg = $4,
        price = $5, price_per_bag = $6, paid = $7, closed_at = now(), migrated_to = $8, migrated_id = $9
       WHERE id = $10
       RETURNING *`,
      [closing, tare, gross, net, finalPrice, finalPricePerBag, finalPaid, migratedTo, migratedId, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao fechar a pesagem." });
  }
});

router.put("/:id/paid", requireAdmin, async (req, res) => {
  const { paid } = req.body || {};
  try {
    const t = await pool.query("SELECT * FROM weighing_tickets WHERE id = $1", [req.params.id]);
    if (t.rows.length === 0) return res.status(404).json({ error: "Pesagem não encontrada." });
    const ticket = t.rows[0];
    if (ticket.migrated_to === "sale" && ticket.migrated_id) {
      await pool.query("UPDATE sales SET paid = $1 WHERE id = $2", [!!paid, ticket.migrated_id]);
    }
    const result = await pool.query(
      "UPDATE weighing_tickets SET paid = $1 WHERE id = $2 RETURNING id, paid",
      [!!paid, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao atualizar o pagamento." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM weighing_tickets WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir a pesagem." });
  }
});

module.exports = router;
