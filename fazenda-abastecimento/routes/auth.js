const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const router = express.Router();

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

module.exports = router;
