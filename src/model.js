// Modelo físico e estatístico do Véspera. Funções puras, sem DOM.
// Testes: node --test

export const G = 96;
export const H = 72; // horizonte da previsão, em horas
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const gauss = (t, m, s) => Math.exp(-0.5 * ((t - m) / s) ** 2);

/* ===================== CHUVA ===================== */

// Forma do hietograma por sistema meteorológico: peso relativo de cada hora (0 a 71).
export const SYSTEMS = [
  { id: "frente", n: "Frente fria", d: "Chuva em faixa, pico na passagem", w: t => 0.1 + gauss(t, 30, 5) + 0.6 * gauss(t, 30, 1) },
  { id: "zcas", n: "ZCAS", d: "Chuva persistente por dias", w: t => 0.15 + (t > 8 && t < 68 ? 0.85 : 0.2) * (0.8 + 0.2 * Math.sin(t / 5)) },
  { id: "conv", n: "Convecção de verão", d: "Pancadas fortes à tarde", w: t => 0.01 + 0.6 * gauss(t, 16, 0.6) + 0.9 * gauss(t, 40, 0.6) + gauss(t, 64, 0.6) },
  { id: "cicl", n: "Ciclone extratropical", d: "Chuva volumosa e concentrada", w: t => 0.05 + gauss(t, 20, 3) + 0.7 * gauss(t, 20, 0.8) + 0.3 * gauss(t, 34, 4) },
];

export function hyetograph(sys, total) {
  const w = Array.from({ length: H }, (_, t) => sys.w(t));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(v => (total * v) / sum);
}

// Níveis de aviso do INMET para chuva (intensidade horária e acumulado diário).
export function inmetRain(peak, dayMax) {
  const byI = peak > 60 ? 3 : peak > 30 ? 2 : peak >= 20 ? 1 : 0;
  const byD = dayMax > 100 ? 3 : dayMax > 50 ? 2 : dayMax >= 30 ? 1 : 0;
  return { level: Math.max(byI, byD), byI: byI >= byD };
}

// Refletividade de radar equivalente (Marshall-Palmer, Z = 200 R^1,6).
export const dbz = r => (r > 0.1 ? 10 * Math.log10(200 * r ** 1.6) : 0);

/* ===================== SOLO E ESCOAMENTO ===================== */

// Camada de 0 a 30 cm de um latossolo vermelho-amarelo típico de Sorocaba.
export const SOIL = { porosity: 0.48, fc: 0.34, wp: 0.16, depth: 300 };
export const satOf = th => clamp((th - SOIL.wp) / (SOIL.porosity - SOIL.wp), 0, 1);
// Umidade volumétrica inicial a partir da chuva dos 5 dias anteriores.
export const theta0 = ante => SOIL.wp + (SOIL.porosity - 0.03 - SOIL.wp) * clamp(ante / 180, 0, 1);

// SCS Curve Number (NRCS, TR-55). CN II = 82: malha urbana mista, solo grupo C.
// A condição de umidade antecedente desloca o CN entre CN I (seco) e CN III (úmido) (Hawkins, 1985).
export const CN2 = 82;
export function cnFor(sat) {
  const c1 = CN2 / (2.281 - 0.01281 * CN2), c3 = CN2 / (0.427 + 0.00573 * CN2);
  return sat < 0.5 ? c1 + ((CN2 - c1) * sat) / 0.5 : CN2 + ((c3 - CN2) * (sat - 0.5)) / 0.5;
}
export function scsRunoff(P, cn) {
  const S = 25400 / cn - 254, Ia = 0.2 * S;
  return P > Ia ? (P - Ia) ** 2 / (P - Ia + S) : 0;
}

// Simulação hora a hora: balanço hídrico do solo, escoamento, rio e drenagem urbana.
export function simulate(hours, ante) {
  const th0 = theta0(ante), cn = cnFor(satOf(th0));
  const theta = [], q = [], stage = [], pluvial = [];
  let th = th0, P = 0, Q = 0, s1 = 0, s2 = 0;
  const K = 5; // constante do reservatório linear (h): Nash com 2 reservatórios, pico ~10 h após o escoamento
  for (let t = 0; t < H; t++) {
    P += hours[t];
    const Qn = scsRunoff(P, cn), dq = Qn - Q; Q = Qn;
    th += (hours[t] - dq) / SOIL.depth;                       // infiltração
    if (th > SOIL.fc) th -= 0.03 * (th - SOIL.fc);           // drenagem profunda
    th = Math.min(th, SOIL.porosity);
    s1 += dq; const o1 = s1 / K; s1 -= o1;
    s2 += o1; const o2 = s2 / K; s2 -= o2;
    theta.push(th); q.push(dq);
    // curva-chave: subida do nível (m) cresce com a vazão (mm/h na bacia) elevada a 0,6.
    // Coeficiente calibrado com as reportagens: 100 a 120 mm em 72 h sobem o Rio Sorocaba cerca de 2 m na Praça Lions.
    stage.push(1.0 * Math.max(0, o2) ** 0.6);
    // galerias dimensionadas para cerca de 35 mm/h; o excesso acumula nas baixadas
    pluvial.push(Math.max(0, hours[t] - 35) * 0.035);
  }
  const rise = stage.map((s, t) => s + pluvial[t]);
  return { cn, th0, theta, q, stage, pluvial, rise, runoff: Q, C: P ? Q / P : 0 };
}

/* ===================== DESLIZAMENTO ===================== */

// Índice de deflagração: chuva acumulada nas últimas 72 h somada à antecedente.
// Lembra os limiares de Tatizana et al. (1987) usados pelo Cemaden. Acima de 0,7, encostas íngremes ficam instáveis.
export function slideIndex(hours, t, ante) {
  let acc = 0;
  for (let k = 0; k <= t; k++) acc += hours[k];
  return (acc + 0.6 * ante) / 150;
}
// Declividade crítica (%) cai conforme o índice cresce: solo saturado perde coesão.
// Calibrada para a grade de ~370 m, que suaviza a declividade real pela metade.
export const slopeThreshold = idx => (idx < 0.7 ? Infinity : Math.max(10, 24 - 10 * (idx - 0.7)));

/* ===================== INCÊNDIO E CALOR ===================== */

// Fórmula de Monte Alegre Alterada (FMA+, Nunes et al. 2006): soma de 100/UR das 13 h, ponderada pelo vento.
export function fmaPlus(days, rh, windKmh) {
  const v = windKmh / 3.6;
  return days * (100 / rh) * Math.exp(0.04 * v);
}
export const FMA_CLASSES = ["Nulo", "Pequeno", "Médio", "Alto", "Muito alto"];
export const fmaClass = f => (f <= 3 ? 0 : f <= 8 ? 1 : f <= 14 ? 2 : f <= 24 ? 3 : 4);

// Índice de calor (Rothfusz, NOAA), em °C.
export function heatIndex(tc, rh) {
  const T = tc * 1.8 + 32;
  if (T < 80) return tc;
  const hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 6.83783e-3 * T * T
    - 5.481717e-2 * rh * rh + 1.22874e-3 * T * T * rh + 8.5282e-4 * T * rh * rh - 1.99e-6 * T * T * rh * rh;
  return (hi - 32) / 1.8;
}
export const HI_CLASSES = ["Normal", "Cautela", "Cautela extrema", "Perigo", "Perigo extremo"];
export const hiClass = h => (h < 27 ? 0 : h < 32 ? 1 : h < 41 ? 2 : h < 54 ? 3 : 4);
// Aviso de onda de calor do INMET: 5 °C acima da média por 2 a 3 dias (amarelo), 3 a 5 (laranja), mais de 5 (vermelho).
export const inmetHeat = (anom, days) => (anom < 5 || days < 2 ? 0 : days <= 3 ? 1 : days <= 5 ? 2 : 3);

// Média climatológica da máxima em Sorocaba no verão (INMET A713, aproximada).
export const TMAX_CLIM = 30;
// Série horária de temperatura e umidade para o cenário seco (ciclo diário).
export function drySeries(anom, rhMin) {
  const T = [], RH = [];
  for (let t = 0; t < H; t++) {
    const d = Math.cos(((t % 24) - 15) / 24 * 2 * Math.PI); // máximo às 15 h
    const tmax = TMAX_CLIM + anom, tmin = tmax - 11;
    T.push(tmin + (tmax - tmin) * (d + 1) / 2);
    RH.push(clamp(rhMin + (95 - rhMin) * (1 - d) / 2, 5, 100));
  }
  return { T, RH };
}

/* ===================== RISCO NO MAPA ===================== */

/* HAND (Height Above Nearest Drainage, Rennó et al. 2008, INPE): altura de cada célula
   acima da célula de drenagem mais próxima. Drenagem = células cortadas pelos rios.
   Busca em largura a partir da drenagem. Cada linha tem um peso: a cheia de um córrego
   sobe menos que a do rio principal. Sem rios na grade, devolve null.
   lines: [{ p: [[lon, lat], ...], w: peso }], rios primeiro.
   elevAt(lon, lat): cota no próprio leito; sem ela, usa a cota do centro da célula. */
export function computeHAND(el, lines, west, south, dx, dy, elevAt) {
  const drain = new Int32Array(G * G).fill(-1), wt = new Float32Array(G * G), bed = new Float32Array(G * G).fill(Infinity), q = [];
  let cur = 1;
  const mark = (x, y) => {
    const c = Math.floor((x - west) / dx), r = Math.floor((y - south) / dy), i = r * G + c;
    if (c < 0 || r < 0 || c >= G || r >= G || isNaN(el[i])) return;
    if (drain[i] < 0) { drain[i] = i; wt[i] = cur; q.push(i); }
    if (wt[i] === cur) { const z = elevAt ? elevAt(x, y) : el[i]; if (z != null && z < bed[i]) bed[i] = z; }
  };
  for (const { p, w } of [...lines].sort((a, b) => b.w - a.w)) {
    cur = w;
    for (let k = 1; k < p.length; k++) {
      const [a, b] = p[k - 1], [c, d] = p[k];
      const n = Math.ceil(Math.max(Math.abs(c - a) / dx, Math.abs(d - b) / dy) * 2) + 1;
      for (let s = 0; s <= n; s++) mark(a + ((c - a) * s) / n, b + ((d - b) * s) / n);
    }
  }
  if (q.length < 3) return null;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], r = (i / G) | 0, c = i % G;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const rr = r + dr, cc = c + dc, j = rr * G + cc;
      if (rr < 0 || cc < 0 || rr >= G || cc >= G || drain[j] >= 0 || isNaN(el[j])) continue;
      drain[j] = drain[i]; wt[j] = wt[i]; q.push(j);
    }
  }
  const hand = new Float32Array(G * G).fill(NaN);
  for (let i = 0; i < G * G; i++) if (drain[i] >= 0) hand[i] = Math.max(0, el[i] - Math.min(bed[drain[i]], el[drain[i]]));
  return { hand, w: wt };
}

// Altura da calha cheia (m acima do nível normal) por peso do canal: rio, canal, córrego.
export const bankfull = w => (w >= 1 ? 2.0 : w >= 0.5 ? 1.1 : 0.9);

// Classes por célula: 0 nada, 1 inundação, 2 atenção, 3 encosta, 4 incêndio, 5 calor.
export const KIND = ["", "f", "a", "s", "x", "h"];
export function classify(grid, s) {
  const out = new Uint8Array(G * G), n = { f: 0, a: 0, s: 0, x: 0, h: 0, t: 0 };
  if (!grid) return { f: out, n };
  for (let i = 0; i < G * G; i++) {
    const e = grid.el[i]; if (isNaN(e)) continue; n.t++;
    let k = 0;
    if (s.mode === "chuva") {
      // lâmina acima das margens: o canal só extravasa quando a subida passa da calha cheia
      const w = grid.hand ? grid.hand.w[i] : 1, hv = grid.hand ? grid.hand.hand[i] : e - grid.base;
      const depth = s.rise * w - (grid.hand ? bankfull(w) : 0);
      if (depth > 0 && hv < depth) k = 1;
      else if (w >= 0.5 && s.rise * w > 1 && hv < depth + 1.5) k = 2; // faixa de atenção só em rios e canais
      else if (grid.slope[i] > s.slopeThr) k = 3;
    } else if (grid.veg && grid.built) {
      // incêndio: vegetação contínua com perigo FMA+ alto; calor: malha construída densa com índice de calor elevado
      if (s.fireClass >= 3 && grid.veg[i] > 55 - 8 * (s.fireClass - 3)) k = 4;
      else if (s.hiClass >= 2 && grid.built[i] > s.builtCut) k = 5;
    }
    out[i] = k; if (k) n[KIND[k]]++;
  }
  return { f: out, n };
}

/* ===================== APRENDIZADO ===================== */

// Gerador pseudoaleatório com semente (mulberry32): o histórico simulado é sempre o mesmo.
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sig = z => 1 / (1 + Math.exp(-z));

// Regressão logística por gradiente descendente, com padronização das variáveis.
export function trainLogistic(X, y, epochs = 400, lr = 0.3) {
  const m = X[0].length, mu = Array(m).fill(0), sd = Array(m).fill(0);
  X.forEach(x => x.forEach((v, j) => (mu[j] += v / X.length)));
  X.forEach(x => x.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / X.length)));
  for (let j = 0; j < m; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map(x => x.map((v, j) => (v - mu[j]) / sd[j]));
  const w = Array(m).fill(0); let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = Array(m).fill(0); let gb = 0;
    Z.forEach((z, i) => { const d = sig(b + z.reduce((a, v, j) => a + v * w[j], 0)) - y[i]; gb += d; z.forEach((v, j) => (gw[j] += d * v)); });
    b -= (lr * gb) / Z.length; for (let j = 0; j < m; j++) w[j] -= (lr * gw[j]) / Z.length;
  }
  return x => sig(b + x.reduce((a, v, j) => a + ((v - mu[j]) / sd[j]) * w[j], 0));
}

// Área sob a curva ROC (probabilidade de um positivo receber nota maior que um negativo).
export function auc(p, y) {
  const pos = p.filter((_, i) => y[i]), neg = p.filter((_, i) => !y[i]);
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length || 1);
}

/* Histórico simulado de 30 anos de Sorocaba: cada episódio sorteia um cenário,
   roda o modelo físico e registra se houve o desastre, com ruído de registro
   (eventos não notificados ou condições locais que o modelo não vê).
   Num produto real, o histórico viria do S2iD e dos registros da Defesa Civil. */
export function features(kind, s) {
  if (kind === "f") return [s.rise, s.peak, s.sat, s.rain];
  if (kind === "s") return [s.slideIdx, s.sat, s.peak];
  if (kind === "x") return [s.fma, s.rhMin, s.wind];
  return [s.anom, s.heatDays, s.hiMax];
}
export function scenarioState(p) {
  if (p.mode === "chuva") {
    const hours = hyetograph(p.sys, p.rain), sim = simulate(hours, p.ante);
    return { rain: p.rain, peak: Math.max(...hours), sat: satOf(sim.th0), rise: Math.max(...sim.rise),
      slideIdx: slideIndex(hours, H - 1, p.ante) };
  }
  const fma = fmaPlus(p.dryDays, p.rhMin, p.wind), ser = drySeries(p.anom, p.rhMin);
  return { fma, rhMin: p.rhMin, wind: p.wind, anom: p.anom, heatDays: p.heatDays,
    hiMax: Math.max(...ser.T.map((t, i) => heatIndex(t, ser.RH[i]))) };
}
export function buildHistory(n = 360, seed = 7) {
  const r = rng(seed), rows = { f: [], s: [], x: [], h: [] };
  for (let i = 0; i < n; i++) {
    const wet = r() < 0.6;
    if (wet) {
      // acumulado em 72 h com cauda longa: a maioria dos episódios é moderada
      const p = { mode: "chuva", sys: SYSTEMS[(r() * 4) | 0], rain: Math.min(260, 10 - 55 * Math.log(1 - r())), ante: r() * 220 };
      const s = scenarioState(p), noise = () => (r() - 0.5) * 4;
      rows.f.push([features("f", s), +(s.rise + noise() * 0.6 > 1.9)]);
      rows.s.push([features("s", s), +(s.slideIdx + s.sat * 0.4 + noise() * 0.35 > 1.45)]);
    } else {
      const p = { mode: "seco", dryDays: 1 - 9 * Math.log(1 - r()), rhMin: 15 + r() * 55, wind: r() * 35, anom: r() * 8, heatDays: (r() * 8) | 0 };
      const s = scenarioState(p), noise = () => (r() - 0.5) * 2;
      rows.x.push([features("x", s), +(Math.log(s.fma) + noise() > 3.6)]);
      rows.h.push([features("h", s), +(s.anom + noise() >= 5 && s.heatDays + noise() >= 3)]);
    }
  }
  return rows;
}
// Treina um modelo por ameaça; valida nos 25% finais do histórico.
export function trainModels() {
  const hist = buildHistory(), models = {};
  for (const k of ["f", "s", "x", "h"]) {
    const rows = hist[k], cut = Math.floor(rows.length * 0.75);
    const tr = rows.slice(0, cut), te = rows.slice(cut);
    const predict = trainLogistic(tr.map(r => r[0]), tr.map(r => r[1]));
    models[k] = { predict, auc: auc(te.map(r => predict(r[0])), te.map(r => r[1])), n: rows.length, events: rows.filter(r => r[1]).length };
  }
  return models;
}

// Primeira hora em que a série cruza o limiar (tempo até o impacto).
export const firstCross = (arr, thr) => { const i = arr.findIndex(v => v >= thr); return i < 0 ? null : i; };
