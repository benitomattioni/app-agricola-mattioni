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
      SELECT h.id, h.pivot_id, h.date, h.gross_weight_kg, h.tare_weight_kg, h.net_weight_kg,
             h.bags_60kg, h.crop, h.planting_id, h.operator, h.notes, h.created_by, h.created_at,
             p.name AS pivot_name, p.number AS pivot_number,
             (h.photo_gross IS NOT NULL) AS has_photo_gross,
             (h.photo_tare IS NOT NULL) AS has_photo_tare
      FROM harvest_loads h
      JOIN pivots p ON p.id = h.pivot_id
      ORDER BY h.date DESC, h.created_at DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar a produção." });
  }
});

// A carga é lançada escolhendo diretamente a Cultura (o plantio/ciclo) —
// o pivô e o tipo de grão vêm dali, não são escolhidos separadamente.
router.post("/", async (req, res) => {
  const { plantingId, date, grossWeightKg, tareWeightKg, operator, notes, photoGross, photoTare } =
    req.body || {};

  const gross = Number(grossWeightKg);
  const tare = Number(tareWeightKg);

  if (!plantingId || !date || !grossWeightKg || tareWeightKg === undefined || tareWeightKg === null) {
    return res.status(400).json({ error: "Cultura, data, peso bruto e tara são obrigatórios." });
  }
  if (gross <= tare) {
    return res.status(400).json({ error: "O peso bruto deve ser maior que a tara." });
  }

  const grossPhoto = photoGross ? parseDataUrl(photoGross) : null;
  const tarePhoto = photoTare ? parseDataUrl(photoTare) : null;
  if (grossPhoto === "too_large" || tarePhoto === "too_large") {
    return res.status(413).json({ error: "Cada foto deve ter no máximo 8MB." });
  }

  try {
    const plantingResult = await pool.query("SELECT id, pivot_id, crop FROM plantings WHERE id = $1", [plantingId]);
    if (plantingResult.rows.length === 0) {
      return res.status(404).json({ error: "Cultura não encontrada." });
    }
    const planting = plantingResult.rows[0];
    const net = gross - tare;
    const bags = net / BAG_KG;

    const result = await pool.query(
      `INSERT INTO harvest_loads
        (pivot_id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop, planting_id,
         operator, notes, photo_gross, photo_gross_mime, photo_tare, photo_tare_mime, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, pivot_id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg,
                 crop, planting_id, operator, notes, created_by, created_at,
                 (photo_gross IS NOT NULL) AS has_photo_gross,
                 (photo_tare IS NOT NULL) AS has_photo_tare`,
      [
        planting.pivot_id,
        date,
        gross,
        tare,
        net,
        bags,
        planting.crop,
        planting.id,
        (operator && operator.trim()) || req.user.name,
        notes || null,
        grossPhoto ? grossPhoto.buffer : null,
        grossPhoto ? grossPhoto.mediaType : null,
        tarePhoto ? tarePhoto.buffer : null,
        tarePhoto ? tarePhoto.mediaType : null,
        req.user.id,
      ]
    );

    const load = result.rows[0];
    res.json(load);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar a produção." });
  }
});

router.get("/:id/photo/:kind", async (req, res) => {
  const { id, kind } = req.params;
  if (kind !== "gross" && kind !== "tare") {
    return res.status(400).json({ error: "Tipo de foto inválido." });
  }
  const column = kind === "gross" ? "photo_gross" : "photo_tare";
  const mimeColumn = kind === "gross" ? "photo_gross_mime" : "photo_tare_mime";
  try {
    const result = await pool.query(
      `SELECT ${column} AS photo, ${mimeColumn} AS mime FROM harvest_loads WHERE id = $1`,
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
    await pool.query("DELETE FROM harvest_loads WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir a carga." });
  }
});

module.exports = router;
