// Função do Vercel: recebe o resumo do cenário e pede a leitura técnica a um modelo de linguagem.
// A chave fica só no servidor (variável AI_API_KEY; padrão Groq). Qualquer API compatível com OpenAI
// funciona trocando AI_BASE_URL e AI_MODEL.
const BASE = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
const MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";

const SYSTEM = `Você é analista de risco de desastres da Defesa Civil do município informado no JSON.
Recebe em JSON a saída do Véspera: cenário meteorológico, modelo físico (SCS-CN, HAND, FMA+, índice de calor),
probabilidades de um modelo estatístico, horas até o impacto, leituras de sensores reprovadas e o plano sugerido.
Escreva em português do Brasil, frases curtas, sem markdown, sem listas com marcadores, sem emoji.
Quatro parágrafos curtos:
1. Situação: o que deve acontecer, onde e quando, com os números que importam.
2. Incerteza: o que pode mudar a previsão e quanto confiar nela (sensores com falha, limites do modelo).
3. Prioridades: as três ações mais urgentes, com horário limite.
4. Comunicação: o que dizer à população agora.
Não invente dados que não estejam no JSON. Se a probabilidade for baixa, diga que o cenário é de rotina.`;

export async function POST(request) {
  const key = process.env.AI_API_KEY || process.env.XAI_API_KEY;
  if (!key) return Response.json({ error: "falta a chave AI_API_KEY no servidor" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 20000) return Response.json({ error: "resumo grande demais" }, { status: 413 });
  let data;
  try { data = JSON.parse(raw); } catch { return Response.json({ error: "JSON inválido" }, { status: 400 }); }
  const r = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 2000, ...(MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(data) }] }),
  });
  if (!r.ok) return Response.json({ error: "o provedor de IA respondeu " + r.status }, { status: 502 });
  const j = await r.json();
  return Response.json({ text: j.choices?.[0]?.message?.content?.trim() || "", model: MODEL });
}
