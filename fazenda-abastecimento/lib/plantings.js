const { pool } = require("../db");

// Acha o plantio (cultura) que estava em vigor num pivô numa determinada
// data — usada pra "fotografar" a cultura em cada aplicação e cada carga de
// produção, e pra vincular a carga ao ciclo certo (não só ao nome da
// cultura, já que a mesma cultura pode se repetir em ciclos diferentes).
// Prioriza o plantio mais recente cuja data de plantio seja <= a data dada;
// se não houver nenhum (ex.: data anterior ao primeiro plantio registrado),
// cai para o plantio mais recente que existir.
async function findCropForPivot(pivotId, onDate) {
  const exact = await pool.query(
    `SELECT id, crop FROM plantings WHERE pivot_id = $1 AND planting_date <= $2
     ORDER BY planting_date DESC LIMIT 1`,
    [pivotId, onDate]
  );
  if (exact.rows.length > 0) return { id: exact.rows[0].id, crop: exact.rows[0].crop };

  const fallback = await pool.query(
    `SELECT id, crop FROM plantings WHERE pivot_id = $1 ORDER BY planting_date DESC LIMIT 1`,
    [pivotId]
  );
  return fallback.rows.length > 0 ? { id: fallback.rows[0].id, crop: fallback.rows[0].crop } : { id: null, crop: null };
}

module.exports = { findCropForPivot };
