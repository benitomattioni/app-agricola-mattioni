const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const VISION_MODEL = process.env.VISION_MODEL || "claude-haiku-4-5-20251001";

function parseDataUrl(dataUrl) {
  // Espera algo como "data:image/jpeg;base64,AAAA..."
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

// Chama a API da Anthropic com o conteúdo (texto + imagens) montado e
// devolve o JSON já parseado da resposta do modelo. Lança erro em caso de
// falha — quem chama decide como responder ao cliente.
async function callVisionJson(content, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: maxTokens || 200,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Erro da API Anthropic:", data);
    throw new Error("api_error");
  }

  const text = (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Resposta não era JSON válido:", text);
    throw new Error("parse_error");
  }
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireApiKey(res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "Leitura automática desativada: defina ANTHROPIC_API_KEY no servidor." });
    return false;
  }
  return true;
}

// Recebe até duas fotos (painel/bomba com os litros e horímetro da máquina)
// e pede pro modelo ler os números. O valor sugerido é só um ponto de
// partida — a pessoa sempre confere e pode corrigir antes de salvar.
router.post("/extract", async (req, res) => {
  if (!requireApiKey(res)) return;

  const { photoLiters, photoHourmeter } = req.body || {};
  const litersImg = parseDataUrl(photoLiters);
  const hourmeterImg = parseDataUrl(photoHourmeter);

  if (!litersImg && !hourmeterImg) {
    return res.status(400).json({ error: "Envie ao menos uma foto." });
  }

  const content = [];
  if (litersImg) {
    content.push({ type: "text", text: "Foto A — display da bomba/medidor de combustível (litros abastecidos):" });
    content.push({ type: "image", source: { type: "base64", media_type: litersImg.mediaType, data: litersImg.base64 } });
  }
  if (hourmeterImg) {
    content.push({ type: "text", text: "Foto B — horímetro ou odômetro da máquina:" });
    content.push({ type: "image", source: { type: "base64", media_type: hourmeterImg.mediaType, data: hourmeterImg.base64 } });
  }
  content.push({
    type: "text",
    text:
      "Leia os números mostrados nos displays das fotos acima. Responda SOMENTE com um " +
      'JSON válido, sem markdown e sem texto extra, no formato exato: ' +
      '{"liters": <número ou null>, "hourmeter": <número ou null>}. ' +
      "Use ponto decimal. Se a Foto A não foi enviada, use null em liters; " +
      "se a Foto B não foi enviada, use null em hourmeter. Se não conseguir " +
      "ler algum valor com confiança (foto borrada, ângulo ruim, etc.), use null nesse campo.",
  });

  try {
    const parsed = await callVisionJson(content);
    res.json({ liters: toNumberOrNull(parsed.liters), hourmeter: toNumberOrNull(parsed.hourmeter) });
  } catch (e) {
    res.status(502).json({ error: "Não foi possível ler os valores da foto." });
  }
});

// Recebe até duas fotos de balança (peso bruto e tara) e pede pro modelo ler
// os pesos em kg. Usado tanto na produção (carga do pivô) quanto na venda.
router.post("/extract-scale", async (req, res) => {
  if (!requireApiKey(res)) return;

  const { photoGross, photoTare } = req.body || {};
  const grossImg = parseDataUrl(photoGross);
  const tareImg = parseDataUrl(photoTare);

  if (!grossImg && !tareImg) {
    return res.status(400).json({ error: "Envie ao menos uma foto." });
  }

  const content = [];
  if (grossImg) {
    content.push({ type: "text", text: "Foto A — display da balança com o PESO BRUTO (em kg):" });
    content.push({ type: "image", source: { type: "base64", media_type: grossImg.mediaType, data: grossImg.base64 } });
  }
  if (tareImg) {
    content.push({ type: "text", text: "Foto B — display da balança com a TARA (peso vazio, em kg):" });
    content.push({ type: "image", source: { type: "base64", media_type: tareImg.mediaType, data: tareImg.base64 } });
  }
  content.push({
    type: "text",
    text:
      "Leia os pesos mostrados nos displays das fotos acima, em quilogramas. Responda SOMENTE " +
      'com um JSON válido, sem markdown e sem texto extra, no formato exato: ' +
      '{"grossWeight": <número em kg ou null>, "tareWeight": <número em kg ou null>}. ' +
      "Use ponto decimal, sem separador de milhar. Se a Foto A não foi enviada, use null em " +
      "grossWeight; se a Foto B não foi enviada, use null em tareWeight. Se o display mostrar " +
      "a unidade em toneladas, converta para kg. Se não conseguir ler com confiança, use null.",
  });

  try {
    const parsed = await callVisionJson(content);
    res.json({ grossWeight: toNumberOrNull(parsed.grossWeight), tareWeight: toNumberOrNull(parsed.tareWeight) });
  } catch (e) {
    res.status(502).json({ error: "Não foi possível ler os pesos da foto." });
  }
});

// Recebe uma foto da placa do veículo e devolve o texto da placa.
router.post("/extract-plate", async (req, res) => {
  if (!requireApiKey(res)) return;

  const { photoPlate } = req.body || {};
  const plateImg = parseDataUrl(photoPlate);
  if (!plateImg) {
    return res.status(400).json({ error: "Envie a foto da placa." });
  }

  const content = [
    { type: "text", text: "Foto da placa de um veículo/caminhão:" },
    { type: "image", source: { type: "base64", media_type: plateImg.mediaType, data: plateImg.base64 } },
    {
      type: "text",
      text:
        "Leia a placa do veículo na foto (formato brasileiro antigo ABC1234 ou Mercosul ABC1D23). " +
        'Responda SOMENTE com um JSON válido, sem markdown e sem texto extra, no formato exato: ' +
        '{"plate": "<placa em maiúsculas, sem espaços ou traços, ou null>"}. ' +
        "Se não conseguir ler com confiança, use null.",
    },
  ];

  try {
    const parsed = await callVisionJson(content, 100);
    const plate = parsed.plate ? String(parsed.plate).toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
    res.json({ plate: plate || null });
  } catch (e) {
    res.status(502).json({ error: "Não foi possível ler a placa da foto." });
  }
});

module.exports = router;
