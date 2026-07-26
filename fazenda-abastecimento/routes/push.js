const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Chave pública VAPID — não é segredo, o navegador precisa dela pra se
// inscrever nas notificações push.
router.get("/public-key", (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: "Notificação push não configurada neste servidor." });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post("/subscribe", async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: "Inscrição inválida." });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [req.user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao salvar inscrição de notificação." });
  }
});

router.post("/unsubscribe", async (req, res) => {
  const { endpoint } = req.body || {};
  try {
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint || ""]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao remover inscrição." });
  }
});

module.exports = router;
