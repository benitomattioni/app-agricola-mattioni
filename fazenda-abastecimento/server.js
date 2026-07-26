require("dotenv").config();
const express = require("express");
const path = require("path");
const { initDb } = require("./db");
const authRoutes = require("./routes/auth");
const machineRoutes = require("./routes/machines");
const refillRoutes = require("./routes/refills");
const userRoutes = require("./routes/users");
const visionRoutes = require("./routes/vision");
const stockRoutes = require("./routes/stock");
const pushRoutes = require("./routes/push");
const productRoutes = require("./routes/products");
const pivotRoutes = require("./routes/pivots");
const applicationRoutes = require("./routes/applications");
const productionRoutes = require("./routes/production");
const salesRoutes = require("./routes/sales");
const grainStockRoutes = require("./routes/grain-stock");
const plantingRoutes = require("./routes/plantings");
const energyRoutes = require("./routes/energy");
const oilChangeRoutes = require("./routes/oil-changes");
const fieldWorkerRoutes = require("./routes/field-workers");

const app = express();

// Limite maior porque as fotos do abastecimento viajam em base64 dentro do JSON.
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/machines", machineRoutes);
app.use("/api/refills", refillRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vision", visionRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/products", productRoutes);
app.use("/api/pivots", pivotRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/grain-stock", grainStockRoutes);
app.use("/api/plantings", plantingRoutes);
app.use("/api/energy", energyRoutes);
app.use("/api/oil-changes", oilChangeRoutes);
app.use("/api/field-workers", fieldWorkerRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Qualquer outra rota não encontrada devolve o app (SPA simples)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao iniciar banco de dados:", err);
    process.exit(1);
  });
