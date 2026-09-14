const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { sendMail } = require("../lib/notifications");

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// Tenta identificar quem está chamando a rota, sem exigir login — usado só
// para saber se quem está criando uma conta nova é o administrador.
function readTokenUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Cria contas.
// - Se ainda não existe NENHUM usuário no banco, esta chamada cria a
//   primeira conta e ela vira administradora automaticamente (bootstrap).
// - Depois disso, só um administrador logado pode criar novas contas
//   (funcionário ou outro administrador), a partir da aba "Equipe" do app.
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || !name.trim() || !email || !password || password.length < 6) {
    return res.status(400).json({
      error: "Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.",
    });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM users");
    const isFirstUser = countResult.rows[0].count === 0;

    let finalRole = "funcionario";

    if (isFirstUser) {
      finalRole = "admin";
    } else {
      const requester = readTokenUser(req);
      if (!requester || requester.role !== "admin") {
        return res.status(403).json({
          error: "Já existe uma conta administradora. Peça para o administrador criar seu acesso em Equipe.",
        });
      }
      finalRole = role === "admin" ? "admin" : "funcionario";
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Já existe uma conta com esse e-mail." });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name.trim(), cleanEmail, hash, finalRole]
    );

    const user = result.rows[0];

    // Se quem criou já estava logado (um admin cadastrando um funcionário),
    // não devolvemos token — a sessão de quem está logado continua a mesma.
    if (!isFirstUser) {
      return res.json({ user });
    }

    res.json({ token: signToken(user), user });
  } catch (e) {
    console.error("Erro em /register:", e);
    res.status(500).json({ error: "Erro ao criar conta. Tente novamente." });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Informe e-mail e senha." });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email.toLowerCase().trim(),
    ]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (e) {
    console.error("Erro em /login:", e);
    res.status(500).json({ error: "Erro ao entrar. Tente novamente." });
  }
});

// Pede a recuperação — recebe o e-mail, e SE existir uma conta com ele,
// manda um link por e-mail. Responde com a mesma mensagem genérica em
// qualquer caso (existindo o e-mail ou não), pra não revelar quais
// e-mails têm conta cadastrada.
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  const genericMessage =
    "Se esse e-mail tiver uma conta cadastrada, enviamos um link de recuperação para ele.";

  if (!email || !email.trim()) {
    return res.status(400).json({ error: "Informe o e-mail." });
  }

  try {
    const result = await pool.query("SELECT id, name, email FROM users WHERE email = $1", [
      email.toLowerCase().trim(),
    ]);
    const user = result.rows[0];

    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await pool.query(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [user.id, tokenHash, expiresAt]
      );

      const baseUrl = req.protocol + "://" + req.get("host");
      const resetLink = `${baseUrl}/?reset=${token}`;

      await sendMail({
        to: user.email,
        subject: "Recuperação de senha — Controle Interno",
        text:
          `Olá, ${user.name}.\n\n` +
          `Alguém (esperamos que você) pediu pra trocar a senha da sua conta no Controle Interno.\n\n` +
          `Toque no link abaixo pra criar uma senha nova. Ele vale por 1 hora:\n${resetLink}\n\n` +
          `Se não foi você quem pediu, pode ignorar este e-mail — sua senha continua a mesma.`,
        html:
          `<p>Olá, ${user.name}.</p>` +
          `<p>Alguém (esperamos que você) pediu pra trocar a senha da sua conta no <strong>Controle Interno</strong>.</p>` +
          `<p><a href="${resetLink}">Toque aqui pra criar uma senha nova</a> — o link vale por 1 hora.</p>` +
          `<p>Se não foi você quem pediu, pode ignorar este e-mail — sua senha continua a mesma.</p>`,
      });
    }

    res.json({ message: genericMessage });
  } catch (e) {
    console.error("Erro em /forgot-password:", e);
    res.status(500).json({ error: "Erro ao processar o pedido. Tente novamente." });
  }
});

// Confirma a recuperação — recebe o token (do link do e-mail) e a senha
// nova. Confere validade e uso único antes de trocar.
router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || !password || password.length < 6) {
    return res.status(400).json({
      error: "Link inválido ou senha muito curta (mínimo 6 caracteres).",
    });
  }

  try {
    const tokenHash = hashToken(token);
    const result = await pool.query(
      `SELECT * FROM password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    const reset = result.rows[0];

    if (!reset) {
      return res.status(400).json({
        error: "Esse link de recuperação é inválido ou já expirou. Peça um novo.",
      });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      hash,
      reset.user_id,
    ]);
    await pool.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [reset.id]);

    res.json({ message: "Senha alterada. Já pode entrar com a senha nova." });
  } catch (e) {
    console.error("Erro em /reset-password:", e);
    res.status(500).json({ error: "Erro ao trocar a senha. Tente novamente." });
  }
});

module.exports = router;
