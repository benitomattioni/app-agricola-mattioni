const express = require("express");
const { pool } = require("../db");

const router = express.Router();
const BAG_KG = 60;

// Essa rota não usa login de usuário — é a Raspberry Pi chamando sozinha,
// então a autenticação é um token fixo (SCALE_DEVICE_TOKEN no .env),
// mandado no cabeçalho X-Device-Token.
function requireDeviceToken(req, res, next) {
  if (!process.env.SCALE_DEVICE_TOKEN) {
    return res.status(503).json({ error: "Integração com a balança não configurada no servidor (falta SCALE_DEVICE_TOKEN)." });
  }
  const token = req.headers["x-device-token"];
  if (!token || token !== process.env.SCALE_DEVICE_TOKEN) {
    return res.status(401).json({ error: "Token de dispositivo inválido." });
  }
  next();
}
router.use(requireDeviceToken);

// Chamada a cada pesagem: manda a placa (lida pela câmera) e o peso (lido
// da balança). Não precisa de nenhum cadastro prévio — é sempre tratada
// como entrada de grão da fazenda (o caso de uso da leitura automática).
// A cultura fica pendente até alguém selecionar na aba "Em aberto"; só
// depois disso (e da 2ª pesagem) é que vira uma carga de verdade.
router.post("/scan", async (req, res) => {
  const { plate, weightKg } = req.body || {};
  if (!plate || !weightKg || Number(weightKg) <= 0) {
    return res.status(400).json({ error: "Informe a placa e o peso." });
  }
  const normalizedPlate = plate.trim().toUpperCase();

  try {
    const openResult = await pool.query(
      "SELECT * FROM weighing_tickets WHERE vehicle_plate = $1 AND closing_weight_kg IS NULL ORDER BY created_at DESC LIMIT 1",
      [normalizedPlate]
    );
    const openTicket = openResult.rows[0];

    if (!openTicket) {
      // 1ª leitura — abre a pesagem. Cultura fica em branco por enquanto.
      const today = new Date().toISOString().slice(0, 10);
      const insertResult = await pool.query(
        `INSERT INTO weighing_tickets
          (kind, flow, subflow, date, vehicle_plate, opening_weight_kg, operator)
         VALUES ('fazenda','entrada','grao',$1,$2,$3,$4)
         RETURNING *`,
        [today, normalizedPlate, Number(weightKg), "Balança automática"]
      );
      return res.json({ action: "opened", ticket: insertResult.rows[0] });
    }

    // 2ª leitura — calcula o líquido. Se a cultura já tiver sido
    // selecionada (pode ter sido feito enquanto o caminhão estava fora),
    // já migra pra Entradas; senão, fica esperando alguém escolher.
    const closing = Number(weightKg);
    const opening = Number(openTicket.opening_weight_kg);
    const tare = Math.min(opening, closing);
    const gross = Math.max(opening, closing);
    const net = gross - tare;
    if (net <= 0) {
      return res.status(400).json({ error: "O peso lido é igual ao da 1ª pesagem." });
    }

    let migratedTo = null;
    let migratedId = null;

    if (openTicket.planting_id) {
      const plantingResult = await pool.query("SELECT id, pivot_id, crop FROM plantings WHERE id = $1", [openTicket.planting_id]);
      const planting = plantingResult.rows[0];
      if (planting) {
        const bags = net / BAG_KG;
        const loadResult = await pool.query(
          `INSERT INTO harvest_loads (pivot_id, date, gross_weight_kg, tare_weight_kg, net_weight_kg, bags_60kg, crop, planting_id, operator)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [planting.pivot_id, openTicket.date, gross, tare, net, bags, planting.crop, planting.id, "Balança automática"]
        );
        migratedTo = "harvest_load";
        migratedId = loadResult.rows[0].id;
      }
    }

    const updateResult = await pool.query(
      `UPDATE weighing_tickets SET
        closing_weight_kg = $1, tare_weight_kg = $2, gross_weight_kg = $3, net_weight_kg = $4,
        closed_at = now(), migrated_to = $5, migrated_id = $6
       WHERE id = $7
       RETURNING *`,
      [closing, tare, gross, net, migratedTo, migratedId, openTicket.id]
    );
    res.json({ action: "closed", ticket: updateResult.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao processar a leitura da balança." });
  }
});

module.exports = router;
