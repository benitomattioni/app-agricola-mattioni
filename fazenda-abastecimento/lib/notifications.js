const { pool } = require("../db");

let webpush = null;
let pushConfigured = false;
try {
  webpush = require("web-push");
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      "mailto:" + (process.env.ALERT_EMAIL_FROM || "admin@example.com"),
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    pushConfigured = true;
  }
} catch (e) {
  // pacote não instalado ainda / ambiente sem suporte — segue sem push
}

let nodemailer = null;
let mailConfigured = false;
let transporter = null;
try {
  nodemailer = require("nodemailer");
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    mailConfigured = true;
  }
} catch (e) {
  // pacote não instalado ainda — segue sem e-mail
}

async function getAdmins() {
  const result = await pool.query("SELECT id, name, email FROM users WHERE role = 'admin'");
  return result.rows;
}

async function notifyLowStock(currentLiters, thresholdLiters) {
  const admins = await getAdmins();
  if (admins.length === 0) return;

  const title = "⛽ Estoque de diesel baixo";
  const body = `Restam ${Number(currentLiters).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  })} L de diesel (abaixo de ${Number(thresholdLiters).toLocaleString("pt-BR")} L). Registre uma reposição.`;

  await Promise.all([
    sendPushToAdmins(admins, title, body),
    sendEmailToAdmins(admins, title, body),
  ]);
}

async function sendPushToAdmins(admins, title, body) {
  if (!pushConfigured) {
    console.warn("Notificação push não configurada (faltam VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).");
    return;
  }
  const adminIds = admins.map((a) => a.id);
  if (adminIds.length === 0) return;

  const result = await pool.query(
    "SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)",
    [adminIds]
  );

  await Promise.all(
    result.rows.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify({ title, body })
        );
      } catch (err) {
        // Inscrição expirada/inválida — remove pra não tentar de novo.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
        } else {
          console.error("Erro ao enviar push:", err.message);
        }
      }
    })
  );
}

async function sendEmailToAdmins(admins, title, body) {
  if (!mailConfigured) {
    console.warn("E-mail de alerta não configurado (faltam variáveis SMTP_*).");
    return;
  }
  const to = admins.map((a) => a.email).filter(Boolean);
  if (to.length === 0) return;

  try {
    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: title,
      text: body,
    });
  } catch (err) {
    console.error("Erro ao enviar e-mail de alerta:", err.message);
  }
}

module.exports = { notifyLowStock, pushConfigured, mailConfigured };
