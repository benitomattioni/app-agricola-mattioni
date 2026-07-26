const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// Estoque de grãos por TIPO DE GRÃO (nome da cultura) — soma tudo que foi
// produzido daquele grão em qualquer pivô/ciclo, menos tudo que foi
// vendido daquele grão, independente de pivô. Cargas/vendas sem cultura
// definida (dados de antes dessa mudança) entram num balde à parte.
router.get("/", async (req, res) => {
  try {
    const [producedResult, soldResult] = await Promise.all([
      pool.query(`SELECT crop, COALESCE(SUM(bags_60kg), 0) AS bags FROM harvest_loads GROUP BY crop`),
      pool.query(`SELECT crop, COALESCE(SUM(bags_60kg), 0) AS bags FROM sales GROUP BY crop`),
    ]);

    const producedByCrop = {};
    producedResult.rows.forEach((r) => { producedByCrop[r.crop || ""] = Number(r.bags); });
    const soldByCrop = {};
    soldResult.rows.forEach((r) => { soldByCrop[r.crop || ""] = Number(r.bags); });

    const cropNames = new Set([...Object.keys(producedByCrop), ...Object.keys(soldByCrop)]);
    cropNames.delete("");

    const grains = [...cropNames].map((crop) => {
      const produced = producedByCrop[crop] || 0;
      const sold = soldByCrop[crop] || 0;
      return { crop, produced, sold, bagsInStock: produced - sold };
    }).sort((a, b) => b.bagsInStock - a.bagsInStock);

    const unassigned = { produced: producedByCrop[""] || 0, sold: soldByCrop[""] || 0 };
    unassigned.bagsInStock = unassigned.produced - unassigned.sold;

    res.json({ grains, unassigned });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao carregar o estoque de grãos." });
  }
});

module.exports = router;
