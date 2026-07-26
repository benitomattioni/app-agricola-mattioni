const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const BAG_KG = 60;

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_PHOTO_BYTES) return "too_large";
  return { mediaType: match[1], buffer };
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop,
             vehicle_plate, price_per_bag, total_value, paid, operator, notes,
             created_by, created_at,
             (photo_gross IS NOT NULL) AS has_photo_gross,
             (photo_tare IS NOT NULL) AS has_photo_tare,
             (photo_plate IS NOT NULL) AS has_photo_plate
      FROM sales
      ORDER BY date DESC, created_at DESC
    `);
    // Status de pagamento e valor total são informação restrita ao
    // administrador — quem não é admin recebe a lista sem esses campos.
    const rows = req.user.role === "admin"
      ? result.rows
      : result.rows.map(({ paid, total_value, ...rest }) => rest);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar as vendas." });
  }
});

// A venda desconta do estoque por TIPO DE GRÃO (nome da cultura),
// independente de pivô ou ciclo específico — por isso pede só o nome do
// grão, não uma cultura/plantio específico como as cargas de produção.
router.post("/", async (req, res) => {
  const {
    date,
    crop,
    grossWeightKg,
    tareWeightKg,
    vehiclePlate,
    pricePerBag,
    paid,
    operator,
    notes,
    photoGross,
    photoTare,
    photoPlate,
  } = req.body || {};

  const gross = Number(grossWeightKg);
  const tare = Number(tareWeightKg);

  if (!date || !grossWeightKg || tareWeightKg === undefined || tareWeightKg === null) {
    return res.status(400).json({ error: "Data, peso bruto e tara são obrigatórios." });
  }
  if (!crop || !crop.trim()) {
    return res.status(400).json({ error: "Selecione o tipo de grão vendido." });
  }
  if (gross <= tare) {
    return res.status(400).json({ error: "O peso bruto deve ser maior que a tara." });
  }

  const grossPhoto = photoGross ? parseDataUrl(photoGross) : null;
  const tarePhoto = photoTare ? parseDataUrl(photoTare) : null;
  const platePhoto = photoPlate ? parseDataUrl(photoPlate) : null;
  if (grossPhoto === "too_large" || tarePhoto === "too_large" || platePhoto === "too_large") {
    return res.status(413).json({ error: "Cada foto deve ter no máximo 8MB." });
  }

  try {
    const net = gross - tare;
    const bags = net / BAG_KG;
    const price = Number(pricePerBag) || 0;
    const totalValue = bags * price;

    const result = await pool.query(
      `INSERT INTO sales
        (date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop, vehicle_plate,
         price_per_bag, total_value, paid, operator, notes,
         photo_gross, photo_gross_mime, photo_tare, photo_tare_mime, photo_plate, photo_plate_mime,
         created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg,
                 crop, vehicle_plate, price_per_bag, total_value, paid, operator, notes,
                 created_by, created_at,
                 (photo_gross IS NOT NULL) AS has_photo_gross,
                 (photo_tare IS NOT NULL) AS has_photo_tare,
                 (photo_plate IS NOT NULL) AS has_photo_plate`,
      [
        date,
        gross,
        tare,
        net,
        bags,
        crop.trim(),
        vehiclePlate ? vehiclePlate.trim().toUpperCase() : null,
        price,
        totalValue,
        !!paid,
        (operator && operator.trim()) || req.user.name,
        notes || null,
        grossPhoto ? grossPhoto.buffer : null,
        grossPhoto ? grossPhoto.mediaType : null,
        tarePhoto ? tarePhoto.buffer : null,
        tarePhoto ? tarePhoto.mediaType : null,
        platePhoto ? platePhoto.buffer : null,
        platePhoto ? platePhoto.mediaType : null,
        req.user.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar a venda." });
  }
});

// Marcar/desmarcar como pago — ação financeira, restrita ao administrador.
router.put("/:id/paid", requireAdmin, async (req, res) => {
  const { paid } = req.body || {};
  try {
    const result = await pool.query(
      "UPDATE sales SET paid = $1 WHERE id = $2 RETURNING id, paid",
      [!!paid, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Venda não encontrada." });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao atualizar o pagamento." });
  }
});

router.get("/:id/photo/:kind", async (req, res) => {
  const { id, kind } = req.params;
  if (!["gross", "tare", "plate"].includes(kind)) {
    return res.status(400).json({ error: "Tipo de foto inválido." });
  }
  const column = "photo_" + kind;
  const mimeColumn = "photo_" + kind + "_mime";
  try {
    const result = await pool.query(
      `SELECT ${column} AS photo, ${mimeColumn} AS mime FROM sales WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row || !row.photo) return res.status(404).json({ error: "Foto não encontrada." });
    res.setHeader("Content-Type", row.mime || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(row.photo);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar a foto." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM sales WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir a venda." });
  }
});

module.exports = router;
