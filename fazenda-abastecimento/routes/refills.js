const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { recordMovement, getLastCostPerLiter } = require("../lib/stock");

const router = express.Router();
router.use(requireAuth);

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB por foto

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_PHOTO_BYTES) return "too_large";
  return { mediaType: match[1], buffer };
}

// Lista os abastecimentos SEM o conteúdo binário das fotos (isso deixaria a
// resposta enorme) — só sinaliza se cada foto existe, via has_photo_*.
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id, r.machine_id, r.date, r.liters, r.total_cost, r.hourmeter, r.fuel_type,
        r.operator, r.notes, r.created_by, r.created_at, r.pivot_id,
        p.name AS pivot_name, p.number AS pivot_number,
        u.name AS created_by_name,
        (r.photo_liters IS NOT NULL) AS has_photo_liters,
        (r.photo_hourmeter IS NOT NULL) AS has_photo_hourmeter
      FROM refills r
      LEFT JOIN pivots p ON p.id = r.pivot_id
      LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.date DESC, r.created_at DESC
    `);
    // O custo estimado do diesel (total_cost) é informação restrita ao
    // administrador — quem não é admin recebe a lista sem esse campo.
    const rows = req.user.role === "admin"
      ? result.rows
      : result.rows.map(({ total_cost, ...rest }) => rest);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar abastecimentos." });
  }
});

router.post("/", async (req, res) => {
  const {
    machineId,
    date,
    liters,
    hourmeter,
    fuelType,
    pivotId,
    operator,
    notes,
    photoLiters,
    photoHourmeter,
  } = req.body || {};

  if (!machineId || !date || !liters) {
    return res.status(400).json({ error: "Máquina, data e litros são obrigatórios." });
  }

  const litersPhoto = photoLiters ? parseDataUrl(photoLiters) : null;
  const hourmeterPhoto = photoHourmeter ? parseDataUrl(photoHourmeter) : null;
  if (litersPhoto === "too_large" || hourmeterPhoto === "too_large") {
    return res.status(413).json({ error: "Cada foto deve ter no máximo 8MB." });
  }

  const isDiesel = fuelType && /diesel/i.test(fuelType);

  try {
    // Custo estimado desse abastecimento: litros × custo por litro da
    // última reposição de diesel — é uma "foto" do preço no momento, pra
    // entrar no relatório de custo por pivô/cultura mesmo sem pedir valor
    // no formulário de abastecimento.
    let estimatedCost = null;
    if (isDiesel) {
      const lastCost = await getLastCostPerLiter();
      if (lastCost !== null) estimatedCost = Number(liters) * lastCost;
    }

    const result = await pool.query(
      `INSERT INTO refills
        (machine_id, date, liters, total_cost, hourmeter, fuel_type, pivot_id, operator, notes,
         created_by, photo_liters, photo_liters_mime, photo_hourmeter, photo_hourmeter_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, machine_id, date, liters, total_cost, hourmeter, fuel_type, pivot_id,
                 operator, notes, created_by, created_at,
                 (photo_liters IS NOT NULL) AS has_photo_liters,
                 (photo_hourmeter IS NOT NULL) AS has_photo_hourmeter`,
      [
        machineId,
        date,
        liters,
        estimatedCost,
        hourmeter || null,
        fuelType || null,
        pivotId || null,
        (operator && operator.trim()) || req.user.name,
        notes || null,
        req.user.id,
        litersPhoto ? litersPhoto.buffer : null,
        litersPhoto ? litersPhoto.mediaType : null,
        hourmeterPhoto ? hourmeterPhoto.buffer : null,
        hourmeterPhoto ? hourmeterPhoto.mediaType : null,
      ]
    );
    res.json(result.rows[0]);

    // Desconta do estoque de diesel quando o combustível abastecido é diesel
    // (não bloqueia a resposta — se der erro aqui, o abastecimento já foi
    // salvo normalmente, só o estoque não é atualizado).
    if (isDiesel) {
      recordMovement({
        type: "consumo",
        liters: -Math.abs(Number(liters)),
        note: "Abastecimento #" + result.rows[0].id,
        refillId: result.rows[0].id,
        userId: req.user.id,
      }).catch((e) => console.error("Erro ao descontar estoque de diesel:", e));
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao registrar abastecimento." });
  }
});

// Devolve a foto (kind = "liters" ou "hourmeter") como imagem. Protegida por
// login: qualquer pessoa autenticada no app pode ver, ninguém de fora.
router.get("/:id/photo/:kind", async (req, res) => {
  const { id, kind } = req.params;
  if (kind !== "liters" && kind !== "hourmeter") {
    return res.status(400).json({ error: "Tipo de foto inválido." });
  }
  const column = kind === "liters" ? "photo_liters" : "photo_hourmeter";
  const mimeColumn = kind === "liters" ? "photo_liters_mime" : "photo_hourmeter_mime";

  try {
    const result = await pool.query(
      `SELECT ${column} AS photo, ${mimeColumn} AS mime FROM refills WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row || !row.photo) {
      return res.status(404).json({ error: "Foto não encontrada." });
    }
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
    const existing = await pool.query(
      "SELECT liters, fuel_type FROM refills WHERE id = $1",
      [req.params.id]
    );
    await pool.query("DELETE FROM refills WHERE id = $1", [req.params.id]);

    const row = existing.rows[0];
    if (row && row.fuel_type && /diesel/i.test(row.fuel_type)) {
      recordMovement({
        type: "ajuste",
        liters: Math.abs(Number(row.liters)),
        note: "Estorno do abastecimento #" + req.params.id + " (excluído)",
        userId: req.user.id,
      }).catch((e) => console.error("Erro ao estornar estoque de diesel:", e));
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao excluir abastecimento." });
  }
});

module.exports = router;
