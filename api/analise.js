// Função do Vercel: recebe o resumo do cenário e pede a leitura técnica a um modelo de linguagem.
// A chave fica só no servidor (variável XAI_API_KEY). Qualquer API compatível com OpenAI
// funciona trocando AI_BASE_URL e AI_MODEL.
const BASE = process.env.AI_BASE_URL || "https://api.x.ai/v1";
const MODEL = process.env.AI_MODEL || "grok-4";

const SYSTEM = `Você é analista de risco de desastres da Defesa Civil de Sorocaba (SP).
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
  const key = process.env.XAI_API_KEY;
  if (!key) return Response.json({ error: "falta a chave XAI_API_KEY no servidor" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 20000) return Response.json({ error: "resumo grande demais" }, { status: 413 });
  let data;
  try { data = JSON.parse(raw); } catch { return Response.json({ error: "JSON inválido" }, { status: 400 }); }
  const r = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 700,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(data) }] }),
  });
  if (!r.ok) return Response.json({ error: "o provedor de IA respondeu " + r.status }, { status: 502 });
  const j = await r.json();
  return Response.json({ text: j.choices?.[0]?.message?.content?.trim() || "", model: MODEL });
}
