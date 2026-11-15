import "./style.css";
import { contours } from "d3-contour";
import * as M from "./model.js";
import { CONNECTORS, STATIONS, setStations, simulateSensors, lastValid, gaugeCross } from "./sensores.js";
import LIMITE_SOROCABA from "./limite-sorocaba.json";
import { createGlobe } from "./globo.js";
import { loadElevation } from "./relevo.js";
import { icon, SENSOR_ICON, RISK_ICON } from "./icones.js";

const $ = id => document.getElementById(id);
const G = M.G, H = M.H;
const fmt = (v, d = 0) => v.toFixed(d).replace(".", ",");
const pct = p => (p > 0.99 ? "> 99%" : p < 0.01 ? "< 1%" : Math.round(p * 100) + "%");
// a previsão começa à meia-noite de hoje; rótulos com o dia real da semana
let T0 = new Date(); T0.setHours(0, 0, 0, 0);
let replay = null; // episódio real em reprodução
const dayName = t => { const d = new Date(T0.getTime() + Math.floor(t / 24) * 864e5); return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "") + " " + d.getDate(); };
const hourLabel = t => dayName(t) + ", " + String(t % 24).padStart(2, "0") + "h";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* cidades com dados completos; a escolhida vem de ?c= na URL */
const CITY_DATA = {
  sorocaba: { n: "Sorocaba", uf: "SP", c: [-47.437, -23.47], r: 15000, alt: [530, 730], base: 515,
    file: k => "/" + k + "-sorocaba." + (k === "rios" ? "geojson" : "json"),
    alertMm: 60, alertTxt: "critério de alerta do Plano Verão da Defesa Civil de Sorocaba (60 mm em 3 dias)",
    gauge: { id: "R1", nome: "da Praça Lions", via: "a Dom Aguirre alaga" }, road: "Av. Dom Aguirre", skip: ["Dom Aguirre", "Praça Lions"],
    ctx: "Cortada pelo Rio Sorocaba, com avenidas marginais e bairros baixos junto ao leito." },
  campinas: { n: "Campinas", uf: "SP", c: [-47.06, -22.88], r: 17000, alt: [580, 800], base: 560,
    file: k => "/campinas/" + k + "." + (k === "rios" ? "geojson" : "json"),
    alertMm: 80, alertTxt: "nível de atenção do Plano de Contingência de Campinas (80 mm em 72 h)",
    gauge: { id: "R1", nome: "do Rio Capivari no Jardim Yeda", via: "" }, road: "Av. Norte-Sul", skip: ["Norte-Sul"],
    ctx: "Cortada pelos ribeirões Anhumas, Quilombo e Piçarrão, com avenidas de fundo de vale que alagam." },
  petropolis: { n: "Petrópolis", uf: "RJ", c: [-43.17, -22.48], r: 11000, alt: [650, 1050], base: 600,
    file: k => "/petropolis/" + k + "." + (k === "rios" ? "geojson" : "json"),
    alertMm: 100, alertTxt: "nível de abertura dos pontos de apoio do Plano Verão de Petrópolis (100 mm em 24 h)",
    gauge: { id: "R1", nome: "do Rio Quitandinha na R. Coronel Veiga", via: "a Coronel Veiga alaga" }, road: "R. Coronel Veiga", skip: ["Coronel Veiga"],
    ctx: "Serra fluminense, com rios encaixados no centro histórico e encostas ocupadas." },
};
const CITY_KEY = CITY_DATA[new URLSearchParams(location.search).get("c")] ? new URLSearchParams(location.search).get("c") : "sorocaba";
const CITY = CITY_DATA[CITY_KEY];
let LIMITE = LIMITE_SOROCABA;
const getJSON = u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);

const CITIES = [{ n: CITY.n, c: CITY.c, r: CITY.r, ctx: CITY.ctx }];
const HAZ = [
  { k: "f", n: "Enchente", color: "#2C6CB0" },
  { k: "s", n: "Deslizamento", color: "#AE3A2C" },
  { k: "x", n: "Incêndio em vegetação", color: "#E0612B" },
  { k: "h", n: "Onda de calor", color: "#B0368A" },
];

/* ---------- estado ---------- */
const S = { mode: "chuva", sys: M.SYSTEMS[0], rain: 120, ante: 80, anom: 6, heatDays: 4, rhMin: 22, dryDays: 18, wind: 18, t: 0, is3D: true };
let F = {};            // previsão derivada do cenário (recalculada quando o cenário muda)
let grid = null, cl = null, rivers = null, cover = null, schools = null, hist = null, shelters = [];
const approved = new Set(), sentLog = [];
const models = M.trainModels();

/* ---------- previsão ---------- */
function forecast() {
  const zeros = Array(H).fill(0);
  const hours = S.mode === "chuva" ? M.hyetograph(S.sys, S.rain) : zeros;
  const sim = M.simulate(hours, S.mode === "chuva" ? S.ante : 0);
  const dry = M.drySeries(S.mode === "seco" ? S.anom : 0, S.mode === "seco" ? S.rhMin : 70);
  const sensors = simulateSensors({ mode: S.mode, hours, sim, dry, dryDays: S.dryDays });
  const wet = S.mode === "chuva" ? M.scenarioState({ mode: "chuva", sys: S.sys, rain: S.rain, ante: S.ante })
    : { rain: 0, peak: 0, sat: M.satOf(M.theta0(0)), rise: 0, slideIdx: 0 };
  const dryP = S.mode === "seco" ? { mode: "seco", dryDays: S.dryDays, rhMin: S.rhMin, wind: S.wind, anom: S.anom, heatDays: S.heatDays }
    : { mode: "seco", dryDays: 0, rhMin: 85, wind: 10, anom: 0, heatDays: 0 };
  const drySt = M.scenarioState(dryP);
  const prob = {
    f: models.f.predict(M.features("f", wet)), s: models.s.predict(M.features("s", wet)),
    x: models.x.predict(M.features("x", drySt)), h: models.h.predict(M.features("h", drySt)),
  };
  const sat0 = M.satOf(sim.th0);
  const slideAt = t => M.slideIndex(hours, t, S.mode === "chuva" ? S.ante : 0);
  const fmaAt = t => M.fmaPlus(dryP.dryDays + t / 24, dryP.rhMin, dryP.wind);
  const hiAt = t => M.heatIndex(dry.T[t], dry.RH[t]);
  const seq = f => Array.from({ length: H }, (_, t) => f(t));
  const eta = {
    f: S.mode === "chuva" ? M.firstCross(sim.rise, 2) : null, // Dom Aguirre fecha com 2 m acima do normal
    s: S.mode === "chuva" ? M.firstCross(seq(t => slideAt(t) + sat0 * 0.4), 1.45) : null,
    x: S.mode === "seco" ? M.firstCross(seq(t => M.fmaClass(fmaAt(t))), 3) : null,
    h: S.mode === "seco" ? M.firstCross(seq(hiAt), 32) : null,
  };
  let peak = 0, peakT = 0; hours.forEach((v, t) => { if (v > peak) { peak = v; peakT = t; } });
  const days = [0, 1, 2].map(d => hours.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0));
  const riseMax = Math.max(...sim.rise), riseT = sim.rise.indexOf(riseMax);
  const his = seq(hiAt), hiMax = Math.max(...his);
  const hiT = his.indexOf(hiMax);
  const p = Math.max(...Object.values(prob));
  const level = p < 0.15 ? 0 : p < 0.4 ? 1 : p < 0.7 ? 2 : 3;
  F = { hours, sim, dry, sensors, prob, eta, peak, peakT, days, dayMax: Math.max(...days), riseMax, riseT, sat0, slideAt, fmaAt, hiAt, hiMax, hiT,
    fma: fmaAt(0), inmet: M.inmetRain(peak, Math.max(...days)), heatLevel: M.inmetHeat(S.anom, S.heatDays), level };
}

// estado do mapa na hora t da linha do tempo
function hourState(t) {
  if (S.mode === "chuva") return { mode: "chuva", rise: F.sim.rise[t], slopeThr: M.slopeThreshold(F.slideAt(t)) };
  const hc = M.hiClass(F.hiAt(t)), share = [0, 0, 0.08, 0.15, 0.25][hc];
  let builtCut = Infinity;
  if (grid && grid.builtSorted.length && share) builtCut = Math.max(5, grid.builtSorted[Math.floor(grid.builtSorted.length * share)]);
  return { mode: "seco", fireClass: M.fmaClass(F.fmaAt(t)), hiClass: hc, builtCut };
}

/* ---------- mapa ---------- */
// globo 3D (src/globo.js); os dados chegam antes dele ficar pronto e são reaplicados depois
let globe = null;
const DATA = {};
const setData = (id, d) => { DATA[id] = d; if (globe) globe.setData(id, d); };
const POPS = {
  shel: p => "<b>Abrigo sugerido</b><br>" + esc(p.name) + "<br><small>Escola fora das áreas de risco. Exemplo, não é abrigo oficial.</small>",
  sens: p => sensorPopup(p.id),
  risk: p => "<b>" + (p.k === "f" ? ["Inundação, lâmina até 1 m", "Inundação, lâmina de 1 a 2,5 m", "Inundação, lâmina acima de 2,5 m"][p.b] || "Inundação prevista" : "") + { f: "", a: "Faixa de atenção", s: "Encosta instável", x: "Perigo de incêndio", h: "Ilha de calor" }[p.k] + "</b><br>" + hourLabel(S.t) +
    (p.k === "f" || p.k === "a" ? "<br>Rio " + fmt(p.d || 0, 1) + " m acima do normal" : "") +
    (p.k === "s" ? "<br>Declividade acima de " + fmt(M.slopeThreshold(F.slideAt(S.t)), 0) + "% com solo " + ["seco", "úmido", "muito úmido", "saturado"][Math.min(3, Math.floor(F.sat0 * 4))] : "") +
    (p.k === "x" ? "<br>FMA+ " + M.FMA_CLASSES[M.fmaClass(F.fmaAt(S.t))].toLowerCase() : "") +
    (p.k === "h" ? "<br>Índice de calor " + fmt(F.hiAt(S.t), 0) + " °C" : ""),
  hist: p => "<b>" + esc(p.nome) + "</b><br>" + esc(p.tipo) + (p.datas ? "<br><small>" + esc(p.datas) + "</small>" : "") +
    (p.fonte ? '<br><a href="' + esc(p.fonte) + '" target="_blank" rel="noopener">Fonte</a>' : ""),
};
(CITY_KEY === "sorocaba" ? Promise.resolve(LIMITE) : getJSON(CITY.file("limite")))
  .then(l => { LIMITE = l; return createGlobe($("map"), { token: import.meta.env.VITE_CESIUM_TOKEN, limite: l, origin: CITY.c, alt: CITY.alt, base: CITY.base,
    onMoveEnd: scheduleSample, popup: (k, p) => POPS[k](p) }); }).then(g => {
  globe = g;
  for (const id in DATA) g.setData(id, DATA[id]);
  // relevo da cidade uma vez, para pousar pontos e rótulos sem prender ao 3D Tiles
  const bb = bounds(LIMITE.coordinates[0]);
  loadElevation(bb[0] - 0.01, bb[1] - 0.01, bb[2] + 0.01, bb[3] + 0.01, 300).then(fn => g.setElevation(fn));
  applyFilter();
  const c = CITIES[0]; g.flyTo(c.c[0], c.c[1], c.r, 0);
  globeReady();
  if (import.meta.env.DEV) window.vespera = { globe, S, get grid() { return grid; } };
});

/* 2D / 3D */
function setView(three) {
  S.is3D = three; $("v3").setAttribute("aria-pressed", three); $("v2").setAttribute("aria-pressed", !three);
  globe && globe.setView(three);
}
$("v3").onclick = () => setView(true); $("v2").onclick = () => setView(false);
function setStyle(sci) {
  $("vFoto").setAttribute("aria-pressed", !sci); $("vCien").setAttribute("aria-pressed", sci);
  globe && globe.setScience(sci);
  $("sciLegend").hidden = !sci;
}
$("vFoto").onclick = () => setStyle(false); $("vCien").onclick = () => setStyle(true);

/* ---------- dados locais ---------- */
const bounds = r => [Math.min(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[0])), Math.max(...r.map(p => p[1]))];
if (CITY_KEY !== "sorocaba") getJSON(CITY.file("estacoes")).then(l => { if (l) { setStations(l); update(false); } });
getJSON(CITY.file("rios")).then(j => { rivers = j; if (j) setData("rios", j); scheduleSample(); });
getJSON(CITY.file("bairros")).then(j => { bairros = j; if (j) setData("bairros", j); });
getJSON(CITY.file("cobertura")).then(j => { cover = j; scheduleSample(); });
getJSON(CITY.file("escolas")).then(j => { schools = j; pickShelters(); });
getJSON(CITY.file("historico")).then(j => { hist = j; if (j) { setData("hist", histGeo()); drawHistory(); plan(); } });
const isHit = p => !!replay && ((p.datas || []).includes(replay.data) || (replay.pontos || []).some(n => p.nome.includes(n) || n.includes(p.nome)));
const histGeo = () => ({ type: "FeatureCollection", features: (hist?.pontos || []).filter(p => p.lat && p.lon).map(p => ({ type: "Feature",
  properties: { nome: p.nome, tipo: p.tipo + (p.bairro ? ", " + p.bairro : ""), datas: (p.datas || []).join(", "), fonte: (p.fontes || [])[0] || "", hit: isHit(p) },
  geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });

/* ---------- leitura do relevo ---------- */
let sampleTmr = null, sampleReq = 0;
function scheduleSample() { clearTimeout(sampleTmr); sampleTmr = setTimeout(sample, 350); }
// dentro do município (fora dele não há malha nem dados)
function insideCity(x, y) {
  const r = LIMITE.coordinates[0]; let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
function coverAt(lon, lat, key) {
  if (!cover) return NaN;
  const c = Math.floor((lon - cover.west) / cover.d), r = Math.floor((lat - cover.south) / cover.d);
  return c < 0 || r < 0 || c >= cover.nx || r >= cover.ny ? NaN : cover[key][r * cover.nx + c];
}
// grade G×G centrada no meio da tela, do tamanho do que a câmera enxerga
async function sample() {
  const cen = globe && globe.center();
  if (!cen) return;
  const id = ++sampleReq; $("busy").hidden = false;
  const half = Math.min(16000, Math.max(1500, cen.dist * 0.45)), cos = Math.cos((cen.lat * Math.PI) / 180);
  const w = half / (111320 * cos), h = half / 110540;
  const west = cen.lon - w, south = cen.lat - h, dx = (2 * w) / G, dy = (2 * h) / G;
  const elevAt = await loadElevation(west, south, cen.lon + w, cen.lat + h, (2 * half) / G);
  if (id !== sampleReq) return;
  const el = new Float32Array(G * G).fill(NaN), veg = new Float32Array(G * G), built = new Float32Array(G * G), occ = new Uint8Array(G * G).fill(cover ? 0 : 1), inCity = new Uint8Array(G * G);
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
    const x = west + (c + 0.5) * dx, y = south + (r + 0.5) * dy, i = r * G + c;
    const v = elevAt(x, y);
    if (v != null) el[i] = v;
    veg[i] = coverAt(x, y, "veg"); built[i] = coverAt(x, y, "built");
    // ocupado: algum prédio a até ~300 m (3×3 células da cobertura); deslizamento só conta onde há gente
    if (cover) { let any = 0; for (let a = -1; a <= 1 && !any; a++) for (let b = -1; b <= 1; b++) if (coverAt(x + a * cover.d, y + b * cover.d, "built") > 0) { any = 1; break; } occ[i] = any; }
    inCity[i] = insideCity(x, y) ? 1 : 0;
  }
  const mx = dx * 111320 * cos, my = dy * 110540, slope = new Float32Array(G * G);
  for (let r = 1; r < G - 1; r++) for (let c = 1; c < G - 1; c++) {
    const i = r * G + c; slope[i] = Math.hypot((el[i + 1] - el[i - 1]) / (2 * mx), (el[i + G] - el[i - G]) / (2 * my)) * 100;
  }
  const vals = Array.from(el).filter(v => !isNaN(v)).sort((a, b) => a - b);
  $("busy").hidden = true;
  // drenagem: rios, canais e córregos com nome; nascentes sem nome ficam de fora
  const W = { r: 1, c: 0.5, s: 0.35 }, lines = rivers ? rivers.features.filter(f => f.properties.w !== "s" || f.properties.n)
    .map(f => ({ p: f.geometry.coordinates, w: W[f.properties.w] })) : [];
  grid = vals.length < 100 ? null : { west, south, dx, dy, el, slope, veg, built, occ, inCity, cx: cen.lon, cy: cen.lat,
    builtSorted: Array.from(built).filter(v => v > 0).sort((a, b) => b - a),
    base: vals[Math.floor(vals.length * 0.03)], hand: M.computeHAND(el, lines, west, south, dx, dy, elevAt) };
  pickShelters(); render();
}

/* ---------- desenho do mapa na hora t ---------- */
function render() {
  const st = hourState(S.t);
  cl = M.classify(grid, st);
  if (!timer || S.t % 2 === 0 || S.t === H - 1) setData("risk", grid ? riskShapes() : null); // no play, a mancha muda devagar: refaz a cada 2 h
  drawSensorsOnMap(); drawShelters(); areaFacts(st); drawLegend();
}

/* Manchas a partir de campos contínuos, não da grade de classes: a borda segue a profundidade estimada.
   Enchente: lâmina = subida do rio acima da calha − altura sobre a drenagem (HAND). Faixas em 0, 1 e 2,5 m.
   Atenção: até 1,5 m abaixo da cota de transbordamento. Encosta: declividade acima do limiar, faixas em 0 e 6 pontos. */
const G2 = G * 2;
const contour2 = contours().size([G2, G2]).smooth(true);
// dobra a resolução com interpolação bilinear e suaviza 3×3: tira o degrau da grade
function upsample(f) {
  const o = new Float64Array(G2 * G2), at = (c, r) => f[Math.min(G - 1, Math.max(0, r)) * G + Math.min(G - 1, Math.max(0, c))];
  for (let r = 0; r < G2; r++) for (let c = 0; c < G2; c++) {
    const x = c / 2 - 0.25, y = r / 2 - 0.25, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    o[r * G2 + c] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  }
  const b = new Float64Array(G2 * G2);
  for (let r = 0; r < G2; r++) for (let c = 0; c < G2; c++) {
    let s = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < G2 && cc < G2) { s += o[rr * G2 + cc]; n++; } }
    b[r * G2 + c] = s / n;
  }
  return b;
}
function riskShapes() {
  const st = hourState(S.t), feats = [], NO = -9;
  const toLL = ([c, r]) => [grid.west + (c / 2) * grid.dx, grid.south + (r / 2) * grid.dy];
  const area = r => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const add = (k, field, levels, minArea) => {
    if (OFF.has("risk-" + k)) return;
    contour2.thresholds(levels)(upsample(field)).forEach((mp, b) => {
      const polys = mp.coordinates.filter(p => area(p[0]) >= minArea); // ponytail: manchas pequenas viram ruído e custam um polígono cada
      if (polys.length) feats.push({ type: "Feature", properties: { k, b, lv: levels[b], d: st.rise || 0 },
        geometry: { type: "MultiPolygon", coordinates: polys.map(p => p.map(ring => ring.map(toLL))) } });
    });
  };
  const fl = new Float64Array(G * G).fill(NO), at = new Float64Array(G * G).fill(NO), sl = new Float64Array(G * G).fill(NO);
  for (let i = 0; i < G * G; i++) {
    const e = grid.el[i]; if (isNaN(e) || !grid.inCity[i]) continue;
    if (S.mode === "chuva") {
      const w = grid.hand ? grid.hand.w[i] : 1, hv = grid.hand ? grid.hand.hand[i] : e - grid.base;
      const depth = st.rise * w - (grid.hand ? M.bankfull(w) : 0);
      if (!isNaN(hv)) {
        if (depth > 0) fl[i] = depth - hv;
        if (w >= 0.5 && st.rise * w > 1) at[i] = depth - hv + 1.5;
      }
      if (grid.occ[i]) sl[i] = grid.slope[i] - st.slopeThr;
    } else fl[i] = cl.f[i] === 4 ? 1 : cl.f[i] === 5 ? 2 : 0;
  }
  if (S.mode === "chuva") {
    add("a", at, [0], 12); add("f", fl, [0, 1, 2.5], 8); add("s", sl, [0, 6], 10);
  } else {
    const x = fl.map(v => (v === 1 ? 1 : 0)), h = fl.map(v => (v === 2 ? 1 : 0));
    add("x", x, [0.5], 10); add("h", h, [0.5], 10);
  }
  return { type: "FeatureCollection", features: feats };
}

// quantos pontos com alagamento registrado caem dentro da mancha de agora
function histHit() {
  if (!grid || !hist) return "";
  const pts = hist.pontos.map(p => cellOf([p.lon, p.lat])).filter(i => i >= 0);
  return pts.length ? pts.filter(i => cl.f[i] === 1 || cl.f[i] === 2).length + "/" + pts.length : "";
}
function areaFacts(st) {
  const n = cl.n, t = n.t || 1, pc = v => (grid ? fmt((100 * v) / t, 1) + "%" : "");
  const sw = c => '<i class="sw" style="background:' + c + '"></i>';
  const cells = S.mode === "chuva"
    ? [[pc(n.f), sw("var(--water)") + "Inundação"], [pc(n.s), sw("var(--brick)") + "Encostas"], [histHit(), "Ocorrências na mancha"]]
    : [[pc(n.x), sw("#E0612B") + "Incêndio"], [pc(n.h), sw("#B0368A") + "Calor extremo"], [cover ? "" : "", "&nbsp;"]];
  $("areaFacts").innerHTML = cells.map(([v, l]) => "<div><b>" + v + "</b><span>" + l + "</span></div>").join("");
}

// a legenda é o filtro: clicar num item liga ou desliga aquela camada do mapa
const OFF = new Set(["predios"]); // prédios 3D começam desligados: são a camada mais pesada
const SENSOR_GROUP = { cemaden: "cemaden", lora: "lora", ana: "ana", inmet: "clima", radar: "clima", transito: "transito" };
function drawLegend() {
  const sw = (c, line) => '<i class="sw' + (line ? " line" : "") + '" style="background:' + c + '"></i>';
  const ico = (g, c) => '<img class="ico" src="' + icon(g, c) + '" alt="">';
  const it = (S.mode === "chuva"
    ? [["risk-f", sw("var(--water)"), "Inundação prevista"], ["risk-a", sw("var(--ochre)"), "Faixa de atenção"], ["risk-s", sw("var(--brick)"), "Encosta instável"]]
    : [["risk-x", sw("#E0612B"), "Vegetação com perigo de incêndio"], ["risk-h", sw("#B0368A"), "Ilha de calor"]])
    .concat([["rios", sw("#7FC4F0", true), "Rio ou córrego"], ["shel", ico("casa", "#3F7D55"), "Abrigo sugerido"],
      ["cemaden", ico("chuva", "#2C6CB0"), "Pluviômetro"], ["lora", ico("solo", "#5E8C3A"), "Umidade do solo"], ["ana", ico("regua", "#1F7A8C"), "Régua do rio"],
      ["clima", ico("radar", "#6B4FA0"), "Radar e estação"], ["transito", ico("carro", "#4E6068"), "Trânsito"]])
    .concat(hist ? [["hist", ico("alerta", "#C98A12"), "Ocorrência registrada"]] : []).concat([["predios", sw("#E4E6E3"), "Prédios 3D"], ["bairros", sw("#fff"), "Nome dos bairros"]]);
  $("legend").innerHTML = it.map(([k, s, l]) => '<button type="button" data-k="' + k + '" aria-pressed="' + !OFF.has(k) + '">' + s + "<span>" + l + "</span></button>").join("");
}
$("legend").onclick = e => {
  const b = e.target.closest("button[data-k]"); if (!b) return;
  const k = b.dataset.k; OFF.has(k) ? OFF.delete(k) : OFF.add(k);
  applyFilter(); render();
};
function applyFilter() { if (globe) for (const id of ["rios", "hist", "bairros", "predios"]) globe.show(id, !OFF.has(id)); }

/* ---------- abrigos ---------- */
let searchReq = 0;
function pickShelters() {
  if (!grid) return;
  const inGrid = ([, x, y]) => x > grid.west && y > grid.south && x < grid.west + G * grid.dx && y < grid.south + G * grid.dy;
  const local = (schools || []).filter(inGrid);
  if (local.length || schools) { shelters = local.map(([name, x, y]) => ({ name, c: [x, y] })); drawShelters(); return; }
  // fora das cidades com dados: escolas do OpenStreetMap via Overpass
  const id = ++searchReq, bb = [grid.south, grid.west, grid.south + G * grid.dy, grid.west + G * grid.dx].map(v => v.toFixed(3)).join(",");
  fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent('[out:json][timeout:20];nwr["amenity"="school"]["name"](' + bb + ');out center 40;'))
    .then(r => r.json()).then(j => { if (id !== searchReq) return;
      shelters = (j.elements || []).map(e => ({ name: e.tags.name, c: [e.lon ?? e.center.lon, e.lat ?? e.center.lat] })); drawShelters(); })
    .catch(() => { shelters = []; });
}
function cellOf([x, y]) {
  const c = Math.floor((x - grid.west) / grid.dx), r = Math.floor((y - grid.south) / grid.dy);
  return c >= 0 && r >= 0 && c < G && r < G ? r * G + c : -1;
}
function safeShelters() {
  if (!grid || !cl) return [];
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < G * G; i++) if (cl.f[i]) { sx += i % G; sy += (i / G) | 0; n++; }
  const cx = n ? sx / n : G / 2, cy = n ? sy / n : G / 2;
  return shelters.map(s => ({ ...s, i: cellOf(s.c) })).filter(s => s.i >= 0 && cl.f[s.i] === 0 && !isNaN(grid.el[s.i]))
    .map(s => ({ ...s, d: Math.hypot((s.i % G) - cx, ((s.i / G) | 0) - cy) })).sort((a, b) => a.d - b.d).slice(0, 4);
}
function drawShelters() {
  const list = !OFF.has("shel") && F.level >= 2 && S.mode === "chuva" ? safeShelters() : [];
  setData("shel", { type: "FeatureCollection", features: list.map(s => ({ type: "Feature", properties: { name: s.name }, geometry: { type: "Point", coordinates: s.c } })) });
}

/* ---------- sensores ---------- */
const conOf = id => CONNECTORS.find(c => c.id === id);
function sensorValue(st, t) {
  const s = F.sensors[st.id], v = s.v[t], u = conOf(st.c).unit;
  if (v == null) return "sem leitura";
  if (st.c === "inmet") return fmt(v, 1) + " °C, " + Math.round(s.rh[t]) + "% UR";
  return fmt(v, u === "m" || u === "mm/h" ? 1 : 0) + " " + u;
}
function sensorPopup(id) {
  const st = STATIONS.find(s => s.id === id), c = conOf(st.c), s = F.sensors[id], fl = s.flag[S.t];
  return "<b>" + esc(c.n) + "</b><br>" + esc(st.n) + "<br>" + sensorValue(st, S.t) +
    (fl ? '<br><span class="bad">Reprovada: ' + esc(fl) + "</span>" : "") + "<br><small>" + esc(c.org + " · " + c.proto) + "</small>";
}
function drawSensorsOnMap() {
  setData("sens", { type: "FeatureCollection", features: STATIONS.filter(st => !OFF.has(SENSOR_GROUP[st.c])).map(st => ({ type: "Feature",
    properties: { id: st.id, c: st.c, bad: !!F.sensors[st.id].flag[S.t], label: st.id + " " + sensorValue(st, S.t) },
    geometry: { type: "Point", coordinates: st.ll } })) });
}
function spark(st) {
  const s = F.sensors[st.id], vals = s.v.filter(v => v != null);
  const W = 120, Hh = 30, lims = st.c === "ana" ? [st.alert, st.over] : [];
  const max = Math.max(...vals, ...lims, 1e-6), min = Math.min(0, ...vals), y = v => Hh - 2 - ((v - min) / (max - min)) * (Hh - 4);
  let d = "", pen = false;
  s.v.forEach((v, t) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + ((t / (H - 1)) * W).toFixed(1) + " " + y(v).toFixed(1); pen = true; });
  const x = (S.t / (H - 1)) * W;
  return '<svg viewBox="0 0 ' + W + " " + Hh + '" class="spark" aria-hidden="true">' +
    lims.map((l, i) => '<line x1="0" x2="' + W + '" y1="' + y(l) + '" y2="' + y(l) + '" stroke="' + (i ? "#AE3A2C" : "#C4841C") + '" stroke-dasharray="3 3"/>').join("") +
    '<path d="' + d + '" fill="none" stroke="#E3E9EE" stroke-width="1.4"/>' +
    '<line x1="' + x + '" x2="' + x + '" y1="0" y2="' + Hh + '" stroke="#5FA3CF" stroke-width="1.5"/></svg>';
}
function drawSensorsTab() {
  const t = S.t; let online = 0, bad = 0;
  STATIONS.forEach(st => { const f = F.sensors[st.id].flag[t]; if (f !== "sem comunicação") online++; if (f) bad++; });
  $("senFacts").innerHTML = "<div><b>" + CONNECTORS.length + "</b><span>Conectores</span></div><div><b>" + online + "/" + STATIONS.length +
    "</b><span>Sensores com sinal</span></div><div><b>" + bad + "</b><span>Leituras reprovadas</span></div>";
  $("connectors").innerHTML = CONNECTORS.map(c => {
    const rows = STATIONS.filter(st => st.c === c.id).map(st => {
      const s = F.sensors[st.id], fl = s.flag[t], lv = fl ? lastValid(s, t) : null;
      const extra = st.c === "lora" ? "Bateria " + s.battery + "%, sinal " + s.rssi + " dBm"
        : st.c === "ana" ? "Atenção em " + fmt(st.alert, 1) + " m, transborda em " + fmt(st.over, 1) + " m acima do normal" : "";
      return '<li class="sensor' + (fl ? " is-bad" : "") + '"><div class="s-main"><b>' + esc(st.n) + "</b><span>" + sensorValue(st, t) + "</span></div>" +
        spark(st) + (fl ? '<p class="bad">Reprovada: ' + esc(fl) + (lv ? ". Modelo usa a leitura de " + lv.age + " h atrás." : ".") + "</p>" : "") +
        (extra ? '<p class="s-meta">' + extra + "</p>" : "") + "</li>";
    }).join("");
    return '<section class="connector"><header><h3>' + esc(c.n) + "</h3></header><ul>" + rows + "</ul></section>";
  }).join("");
}

/* ---------- riscos e plano ---------- */
function drawHazards() {
  $("hazards").innerHTML = HAZ.map(h => {
    const p = F.prob[h.k], e = F.eta[h.k];
    const when = e == null ? "" : e === 0 ? "limiar já ultrapassado" : "em " + e + " h, " + hourLabel(e);
    return '<li><img class="hz-ico" src="' + icon(...RISK_ICON[h.k]) + '" alt=""><div class="hz-top"><b>' + h.n + "</b><span>" + pct(p) + '</span></div><div class="bar"><i style="width:' + Math.max(1, p * 100) + "%;background:" + h.color + '"></i></div>' +
      (when ? '<p class="hz-eta">' + when + "</p>" : "") + "</li>";
  }).join("");
}

const histNames = tipo => (hist?.pontos || []).filter(p => !tipo || p.tipo.includes(tipo)).filter(p => {
  if (!grid || !cl) return false; const i = cellOf([p.lon, p.lat]); return i >= 0 && (cl.f[i] === 1 || cl.f[i] === 2);
}).map(p => p.nome);

function planItems() {
  const items = [], P = F.prob, E = F.eta, sh = safeShelters().map(s => s.name);
  const add = (id, hz, txt, ok) => items.push({ id, hz, txt, ok });
  if (S.mode === "chuva") {
    if (P.f >= 0.15 || P.s >= 0.15) add("now", "f", "Acompanhar radar e réguas em nowcasting a partir de " + hourLabel(Math.max(0, F.peakT - 6)) + ".", false);
    const gid = CITY.gauge.id, R1 = STATIONS.find(s => s.id === gid), ga = R1 && gaugeCross(F.sensors[gid], R1, "alert"), go = R1 && gaugeCross(F.sensors[gid], R1, "over");
    if (S.rain >= CITY.alertMm) add("pv", "f", S.rain + " mm previstos em 72 h passam do " + CITY.alertTxt + ".", false);
    if (ga != null) add("r1", "f", "Prontidão: a régua " + CITY.gauge.nome + " passa de " + fmt(R1.alert, 1) + " m acima do normal em " + hourLabel(ga) +
      (go != null ? " e chega a " + fmt(R1.over, 1) + " m" + (CITY.gauge.via ? ", nível em que " + CITY.gauge.via : ", cota de transbordamento") + ", em " + hourLabel(go) : "") + ".", false);
    if (P.f >= 0.15 && E.f != null) {
      const named = [...new Set(histNames("").filter(n => !CITY.skip.some(k => n.includes(k))))].slice(0, 3);
      add("int", "f", "Interditar a " + CITY.road + (named.length ? ", " + named.join(", ") : "") + " e travessias nas áreas em azul até " + hourLabel(Math.max(0, E.f - 2)) + ".", true);
      add("sms", "f", "Avisar moradores das áreas em azul e amarelo, com rota para terreno alto.", true);
    }
    if (P.s >= 0.15) add("enc", "s", "Vistoriar as encostas em vermelho e retirar moradores das casas mais próximas. Solo " +
      ["seco", "úmido", "muito úmido", "saturado"][Math.min(3, Math.floor(F.sat0 * 4))] + " perde coesão.", true);
    if (F.level >= 2) add("abr", "f", sh.length ? "Abrir como abrigo temporário: " + sh.slice(0, 2).join(" e ") + "." : "Definir abrigos em áreas altas, fora das manchas de risco.", true);
    if (F.level >= 3) add("eva", "f", "Evacuação preventiva das áreas em azul e equipes de resgate posicionadas" + (sh[0] ? " em " + sh[0] : " nas partes altas") +
      " antes de " + hourLabel(Math.max(0, (E.f ?? F.peakT) - 3)) + ".", true);
  } else {
    if (P.x >= 0.15) {
      add("foc", "x", "Acompanhar os focos de calor do INPE a cada passagem de satélite.", false);
      add("bri", "x", "Posicionar brigadas e caminhões-pipa perto da vegetação em laranja" + (E.x != null ? " a partir de " + hourLabel(E.x) : "") + ".", true);
      add("que", "x", "Suspender autorizações de queima e reforçar a fiscalização.", true);
    }
    if (P.h >= 0.15) {
      add("hid", "h", "Abrir pontos de hidratação e salas climatizadas nas áreas em rosa.", true);
      add("esc", "h", "Orientar escolas e obras a evitar atividade ao ar livre das 11 h às 16 h.", true);
      add("ido", "h", "Agentes de saúde visitam idosos e acamados nas áreas mais quentes.", true);
    }
  }
  if (!items.length) add("rot", "", "Manter o monitoramento de rotina de rios, pluviômetros, encostas e focos de calor.", false);
  const w = { f: P.f, s: P.s, x: P.x, h: P.h, "": 0 };
  return items.map((it, i) => ({ ...it, prio: (it.ok ? 1 : 0.5) * (w[it.hz] || 0) - i * 0.001 })).sort((a, b) => b.prio - a.prio);
}

function plan() {
  const items = planItems(), ids = new Set(items.map(i => i.id));
  [...approved].forEach(id => { if (!ids.has(id)) approved.delete(id); });
  $("plan").innerHTML = items.map(it => "<li><span>" + esc(it.txt) + (it.ok ? '<label class="approve"><input type="checkbox" data-id="' + it.id + '"' +
    (approved.has(it.id) ? " checked" : "") + "> Aprovado pela Defesa Civil</label>" : "") + "</span></li>").join("");
  $("plan").querySelectorAll("input[data-id]").forEach(cb => (cb.onchange = () => { cb.checked ? approved.add(cb.dataset.id) : approved.delete(cb.dataset.id); alertPreview(); }));
  alertPreview();
}

function alertMessage() {
  const items = planItems().filter(i => i.ok && approved.has(i.id));
  if (!items.length) return "";
  const hz = [...new Set(items.map(i => i.hz))], E = F.eta;
  const what = { f: "alagamento e transbordamento de rios", s: "deslizamento de terra", x: "incêndio em vegetação", h: "calor extremo" };
  const first = Math.min(...hz.map(h => E[h] ?? 99));
  let m = "Defesa Civil: risco de " + hz.map(h => what[h]).join(" e ") + " em " + CITY.n + (first < 99 ? " a partir de " + hourLabel(first) : "") + ". ";
  if (hz.includes("f")) m += "Evite as marginais e não atravesse ruas alagadas. ";
  if (hz.includes("s")) m += "Se notar rachaduras ou estalos na casa, saia e procure local seguro. ";
  if (hz.includes("x")) m += "Não queime lixo nem mato. ";
  if (hz.includes("h")) m += "Beba água e evite o sol das 11 h às 16 h. ";
  const sh = safeShelters();
  if (approved.has("abr") && sh[0]) m += "Abrigo: " + sh[0].name + ". ";
  return m + "Emergência: 199.";
}
function alertPreview() {
  const m = alertMessage();
  $("alertPreview").innerHTML = m ? "<p>" + esc(m) + '</p><small>' + m.length + " caracteres · Cell Broadcast (Defesa Civil Alerta) e SMS 40199</small>"
    : "<p class=\"muted\">Nenhuma ação aprovada.</p>";
  $("send").disabled = !m;
}
$("send").onclick = () => {
  sentLog.unshift(hourLabel(S.t) + " · enviado por Cell Broadcast e SMS 40199 (simulação)");
  $("log").innerHTML = sentLog.map(l => "<li>" + esc(l) + "</li>").join("");
};

/* ---------- análise por IA ---------- */
$("ask").onclick = async () => {
  const box = $("ai"); box.hidden = false; box.innerHTML = '<div class="spin inline" role="status" aria-label="Analisando"></div>'; $("ask").disabled = true;
  const body = {
    cidade: CITY.n, hora: hourLabel(S.t), modo: S.mode,
    cenario: S.mode === "chuva" ? { sistema: S.sys.n, chuva_72h_mm: S.rain, antecedente_5d_mm: S.ante } : { anomalia_tmax_c: S.anom, dias_calor: S.heatDays, ur_min: S.rhMin, dias_sem_chuva: S.dryDays, vento_kmh: S.wind },
    previsao: { pico_mm_h: +F.peak.toFixed(1), subida_max_m: +F.riseMax.toFixed(2), cn: +F.sim.cn.toFixed(0), escoamento_mm: +F.sim.runoff.toFixed(0), fma: +F.fma.toFixed(1), indice_calor_max: +F.hiMax.toFixed(1), aviso_inmet_chuva: F.inmet.level, aviso_inmet_calor: F.heatLevel },
    probabilidades: Object.fromEntries(HAZ.map(h => [h.n, +F.prob[h.k].toFixed(2)])),
    horas_ate_impacto: Object.fromEntries(HAZ.map(h => [h.n, F.eta[h.k]])),
    area_afetada: cl?.n, sensores_reprovados: STATIONS.filter(s => F.sensors[s.id].flag[S.t]).map(s => s.id + ": " + F.sensors[s.id].flag[S.t]),
    plano: planItems().map(i => i.txt), ocorrencias_na_area: histNames(""),
  };
  try {
    const r = await fetch("/api/analise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    box.innerHTML = j.text.split(/\n{2,}/).map(p => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");
  } catch (e) {
    box.innerHTML = '<p class="bad">Análise indisponível: ' + esc(e.message) + "</p>";
  } finally { $("ask").disabled = false; }
};

/* ---------- hietograma ---------- */
const inmetTag = (label, lv) => "<span>" + label + '</span><b style="background:' + ["var(--s3)", "var(--ochre)", "var(--orange)", "var(--brick)"][lv] + '">' + ["Nenhum", "Amarelo", "Laranja", "Vermelho"][lv] + "</b>";
function drawHyeto() {
  // linha do tempo: barras de chuva (mm/h) e curva do rio (m acima do normal) nas 72 h
  const W = 1000, Hh = 46, cw = W / H, maxV = Math.max(5, F.peak), y = v => Hh - 2 - (v / maxV) * (Hh - 6);
  let s = "";
  for (let d = 1; d < 3; d++) s += `<line x1="${d * 24 * cw}" x2="${d * 24 * cw}" y1="0" y2="${Hh}" stroke="#2C3C4D" vector-effect="non-scaling-stroke"/>`;
  for (let k = 6; k < H; k += 6) if (k % 24) s += `<line x1="${k * cw}" x2="${k * cw}" y1="${Hh - 4}" y2="${Hh}" stroke="#2C3C4D" vector-effect="non-scaling-stroke"/>`;
  if (S.mode === "chuva") {
    F.hours.forEach((v, t) => { if (v <= 0) return; const c = v > 60 ? "#C2473A" : v > 30 ? "#D2692A" : v >= 20 ? "#C9902A" : "#3B82D6";
      s += `<rect x="${t * cw + 1}" y="${y(v)}" width="${cw - 2}" height="${Hh - 2 - y(v)}" fill="${c}" opacity="${t === S.t ? 1 : 0.75}"/>`; });
    const rmax = Math.max(2.2, F.riseMax), ry = v => Hh - 2 - (v / rmax) * (Hh - 8);
    s += `<polyline points="${F.sim.rise.map((v, t) => ((t + 0.5) * cw).toFixed(1) + "," + ry(v).toFixed(1)).join(" ")}" fill="none" stroke="#9FD6F7" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
    s += `<line x1="0" x2="${W}" y1="${ry(2)}" y2="${ry(2)}" stroke="#C2473A" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`;
  } else {
    const his = Array.from({ length: H }, (_, t) => F.hiAt(t)), hmax = Math.max(40, ...his), hy = v => Hh - 2 - ((v - 15) / (hmax - 15)) * (Hh - 8);
    s += `<polyline points="${his.map((v, t) => ((t + 0.5) * cw).toFixed(1) + "," + hy(v).toFixed(1)).join(" ")}" fill="none" stroke="#E0612B" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
  }
  if (replay) s += `<rect x="${24 * cw}" y="0" width="${24 * cw}" height="${Hh}" fill="#C2473A" opacity="0.08"/>`;
  const xt = (S.t + 0.5) * cw;
  s += `<line x1="${xt}" x2="${xt}" y1="0" y2="${Hh}" stroke="#E3E9EE" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  $("tlChart").innerHTML = s;
  $("tlDays").innerHTML = [0, 1, 2].map(d => '<span style="left:' + ((d * 24 + 12) / H) * 100 + '%">' + dayName(d * 24) + "</span>").join("");
  const hits = replay && grid && cl ? hist.pontos.filter(isHit).map(p => cellOf([p.lon, p.lat])).filter(i => i >= 0) : null;
  $("tlVals").innerHTML = (hits && hits.length ? "<span>Acertos <b>" + hits.filter(i => cl.f[i] === 1 || cl.f[i] === 2).length + "/" + hits.length + "</b></span>" : "") + (S.mode === "chuva"
    ? "<span>Chuva <b>" + fmt(F.hours[S.t], 1) + "</b> mm/h</span><span>Rio <b>" + fmt(F.sim.rise[S.t], 1) + "</b> m</span>"
    : "<span>Calor <b>" + fmt(F.hiAt(S.t), 0) + "</b> °C</span>");
  $("fPeak").textContent = fmt(F.peak, F.peak < 10 ? 1 : 0);
  $("fWhen").textContent = S.rain ? dayName(F.peakT).split(" ")[0] + " " + String(F.peakT % 24).padStart(2, "0") + "h" : "";
  $("fDay").textContent = Math.round(F.dayMax);
  $("inmet").innerHTML = inmetTag("Aviso INMET de chuva", F.inmet.level);
}
function drawDry() {
  $("anomOut").textContent = "+" + fmt(S.anom, 1) + " °C"; $("heatDaysOut").textContent = S.heatDays + (S.heatDays === 1 ? " dia" : " dias");
  $("rhMinOut").textContent = S.rhMin + "%"; $("dryDaysOut").textContent = S.dryDays + (S.dryDays === 1 ? " dia" : " dias"); $("windOut").textContent = S.wind + " km/h";
  $("fFma").textContent = fmt(F.fma, 1); $("fHi").textContent = fmt(F.hiMax, 0); $("fTmax").textContent = fmt(M.TMAX_CLIM + S.anom, 0);
  $("inmetHeat").innerHTML = inmetTag("Aviso INMET de onda de calor", F.heatLevel);
}

/* ---------- atualização ---------- */
function update(resetHour) {
  forecast();
  if (resetHour) setHour(S.mode === "chuva" ? (F.riseMax > 0.05 ? F.riseT : F.peakT) : F.hiT, true);
  $("fill").style.height = (S.rain / 250) * 100 + "%"; $("mm").textContent = S.rain; $("tube").setAttribute("aria-valuenow", S.rain);
  $("anteOut").textContent = S.ante + " mm";
  $("soilFacts").innerHTML = "<div><b>" + fmt(M.theta0(S.ante) * 100, 0) + "%</b><span>Umidade do solo</span></div><div><b>" + fmt(F.sim.cn, 0) +
    "</b><span>Curve Number</span></div><div><b>" + Math.round(F.sim.C * 100) + "%</b><span>Vira escoamento</span></div>";
  $("g-chuva").hidden = S.mode !== "chuva"; $("g-seco").hidden = S.mode !== "seco";
  drawHazards(); drawHyeto(); drawDry(); drawHour();
}
function drawHour() { render(); drawSensorsTab(); plan(); drawHyeto(); }
function setHour(t, quiet) {
  S.t = Math.max(0, Math.min(H - 1, t)); $("hour").value = S.t; $("hourOut").textContent = hourLabel(S.t);
  if (!quiet) drawHour();
}

/* ---------- controles ---------- */
const tube = $("tube");
(function () { let h = ""; for (let v = 0; v <= 250; v += 50) { const p = (v / 250) * 100; h += `<i style="bottom:${p}%"></i><span style="bottom:${p}%">${v}</span>`; } $("ticks").innerHTML = h; })();
function setRain(v) { if (replay) { replay = null; $("evLabel").textContent = "Eventos"; $("evBtn").classList.remove("on"); T0 = new Date(); T0.setHours(0, 0, 0, 0); setData("hist", histGeo()); drawCal(); } S.rain = Math.max(0, Math.min(250, Math.round(v / 5) * 5)); update(true); }
function fromPointer(e) { const r = tube.getBoundingClientRect(); setRain((1 - (e.clientY - r.top) / r.height) * 250); }
tube.addEventListener("pointerdown", e => { tube.setPointerCapture(e.pointerId); fromPointer(e); });
tube.addEventListener("pointermove", e => { if (tube.hasPointerCapture(e.pointerId)) fromPointer(e); });
tube.addEventListener("keydown", e => { const m = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 25, PageDown: -25 }[e.key]; if (m) { e.preventDefault(); setRain(S.rain + m); } });
document.querySelectorAll(".presets button").forEach(b => (b.onclick = () => setRain(+b.dataset.v)));
$("ante").oninput = e => { S.ante = +e.target.value; update(true); };
for (const id of ["anom", "heatDays", "rhMin", "dryDays", "wind"]) { $(id).value = S[id]; $(id).oninput = e => { S[id] = +e.target.value; update(true); }; }

M.SYSTEMS.forEach((s, i) => {
  const b = document.createElement("button"); b.type = "button"; b.innerHTML = "<b>" + s.n + "</b>" + s.d; b.setAttribute("aria-pressed", i === 0);
  b.onclick = () => { S.sys = s; document.querySelectorAll("#systems button").forEach(x => x.setAttribute("aria-pressed", x === b)); update(true); };
  $("systems").appendChild(b);
});
const setMode = m => { S.mode = m; $("m-chuva").setAttribute("aria-pressed", m === "chuva"); $("m-seco").setAttribute("aria-pressed", m === "seco"); update(true); };
$("m-chuva").onclick = () => setMode("chuva"); $("m-seco").onclick = () => setMode("seco");

/* linha do tempo */
let timer = null;
const PLAY = "M4 2l10 6-10 6z", PAUSE = "M3 2h4v12H3zM9 2h4v12H9z";
function stop() { clearInterval(timer); timer = null; $("playIcon").setAttribute("d", PLAY); $("play").setAttribute("aria-label", "Reproduzir as 72 horas"); }
$("play").onclick = () => {
  if (timer) return stop();
  if (S.t >= H - 1) setHour(0);
  $("playIcon").setAttribute("d", PAUSE); $("play").setAttribute("aria-label", "Pausar");
  timer = setInterval(() => { if (S.t >= H - 1) return stop(); setHour(S.t + 1); }, 260 / speed);
};
$("hour").oninput = e => { stop(); setHour(+e.target.value); };

/* cidades e busca */
function goTo(city, btn) {
  document.querySelectorAll("#cities button").forEach(x => x.setAttribute("aria-pressed", x === btn));
  $("cityName").textContent = city.n ? city.n : (city.ctx || "").split(",")[0];
  $("cityMenu").hidden = true; $("cityBtn").setAttribute("aria-expanded", false);
  if (!globe) return;
  globe.focusCity(city.n === CITY.n);
  globe.flyTo(city.c[0], city.c[1], city.r || 5000);
}
/* abas */
const TABS = ["cen", "sen", "pla", "dad", "met"];
function setOpen(open) {
  document.body.classList.toggle("closed", !open);
  $("collapse").setAttribute("aria-expanded", open); $("collapse").setAttribute("aria-label", open ? "Recolher painel" : "Abrir painel");
}
TABS.forEach(k => ($("t-" + k).onclick = () => {
  const closed = document.body.classList.contains("closed");
  if (!closed && $("t-" + k).getAttribute("aria-selected") === "true") return setOpen(false); // clicar na aba aberta recolhe
  TABS.forEach(o => { $("t-" + o).setAttribute("aria-selected", o === k); $("p-" + o).hidden = o !== k; });
  if (closed) setOpen(true);
}));
$("collapse").onclick = () => setOpen(document.body.classList.contains("closed"));

/* eventos reais (barra à direita): calendário com os dias que têm registro; clicar roda a chuva daquela data */
const fmtD = d => d.split("-").reverse().join("/");
const EPS = () => (hist?.episodios || []).filter(e => e.data).slice().sort((a, b) => b.data.localeCompare(a.data));
const ptsOn = e => hist.pontos.filter(p => (p.datas || []).includes(e.data)).length;
let calM = null; // primeiro dia do mês mostrado
function drawCal() {
  const eps = EPS(); if (!eps.length) return;
  if (!calM) { calM = new Date(eps[0].data + "T00:00:00"); calM.setDate(1); }
  const y = calM.getFullYear(), m = calM.getMonth(), key = d => y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const mt = calM.toLocaleDateString("pt-BR", { month: "long" }); $("calTitle").textContent = mt[0].toUpperCase() + mt.slice(1) + " " + y;
  const byDay = Object.fromEntries(eps.map(e => [e.data, e])), days = new Date(y, m + 1, 0).getDate(), lead = new Date(y, m, 1).getDay();
  $("calGrid").innerHTML = ["D", "S", "T", "Q", "Q", "S", "S"].map(d => '<span class="dow">' + d + "</span>").join("") + "<span></span>".repeat(lead) +
    Array.from({ length: days }, (_, i) => { const e = byDay[key(i + 1)], n = e ? ptsOn(e) : 0;
      return e ? '<button type="button" class="ev' + (replay === e ? " sel" : "") + '" data-d="' + e.data + '" style="--dot:' + (n >= 6 ? "#C2473A" : n ? "#C9902A" : "#5FA3CF") + '" aria-label="' + fmtD(e.data) + ", " + esc(e.titulo) + '">' + (i + 1) + "</button>"
        : "<button type=\"button\" disabled>" + (i + 1) + "</button>"; }).join("");
  // pula direto entre meses com evento
  const months = [...new Set(eps.map(e => e.data.slice(0, 7)))].sort(), cur = key(1).slice(0, 7);
  $("calPrev").disabled = !months.some(x => x < cur); $("calNext").disabled = !months.some(x => x > cur);
  let lastY = "";
  $("evList").innerHTML = eps.map(e => { const n = ptsOn(e), yy = e.data.slice(0, 4), head = yy !== lastY ? '<li class="y">' + yy + "</li>" : ""; lastY = yy;
    return head + '<li><button type="button" data-d="' + e.data + '" aria-pressed="' + (replay === e) + '"><b>' + fmtD(e.data).slice(0, 5) + "</b><span>" + esc(e.titulo) + "</span><em>" +
      (e.chuva_mm ? Math.round(e.chuva_mm) + " mm" : "") + "</em>" + (n ? "<small>" + n + (n > 1 ? " pontos registrados" : " ponto registrado") + "</small>" : "") + "</button></li>"; }).join("");
  $("evFree").hidden = !replay;
}
function stepMonth(dir) {
  const months = [...new Set(EPS().map(e => e.data.slice(0, 7)))].sort(), cur = calM.getFullYear() + "-" + String(calM.getMonth() + 1).padStart(2, "0");
  const next = dir > 0 ? months.find(x => x > cur) : months.filter(x => x < cur).pop();
  if (next) { calM = new Date(next + "-01T00:00:00"); drawCal(); }
}
function setReplay(e) {
  replay = e;
  if (e) {
    // a data do evento cai no dia 2 da linha do tempo
    T0 = new Date(e.data + "T00:00:00"); T0.setDate(T0.getDate() - 1);
    const n = ptsOn(e);
    // o total da reportagem é de um pluviômetro em 24 h; a cheia responde à bacia em vários dias, então usa o maior entre o medido e o estimado pelos pontos atingidos
    S.mode = "chuva"; S.rain = Math.min(250, Math.round(Math.max(e.chuva_mm || 0, 50 + n * 15) / 5) * 5); S.ante = Math.min(250, 40 + n * 20);
    $("ante").value = S.ante;
    S.sys = M.SYSTEMS[0]; // frente fria: pico no dia 2, o dia do evento
    document.querySelectorAll("#systems button").forEach((b, i) => b.setAttribute("aria-pressed", M.SYSTEMS[i] === S.sys));
    $("m-chuva").setAttribute("aria-pressed", true); $("m-seco").setAttribute("aria-pressed", false);
    $("evLabel").textContent = fmtD(e.data);
    calM = new Date(e.data + "T00:00:00"); calM.setDate(1);
  } else { T0 = new Date(); T0.setHours(0, 0, 0, 0); $("evLabel").textContent = "Eventos"; }
  $("evBtn").classList.toggle("on", !!e);
  if (hist) setData("hist", histGeo());
  update(true); drawCal();
}
const evOpen = open => { $("evPanel").hidden = !open; document.body.classList.toggle("ev-open", open); $("evBtn").setAttribute("aria-expanded", open); if (open) drawCal(); };
$("evBtn").onclick = () => evOpen($("evPanel").hidden);
$("evClose").onclick = () => evOpen(false);
$("evFree").onclick = () => setReplay(null);
$("calPrev").onclick = () => stepMonth(-1); $("calNext").onclick = () => stepMonth(1);
const pickDay = ev => { const b = ev.target.closest("button[data-d]"); if (b) setReplay(EPS().find(e => e.data === b.dataset.d)); };
$("calGrid").onclick = pickDay; $("evList").onclick = pickDay;

// passar o mouse no gráfico mostra a hora, a chuva e o rio daquele ponto
$("tlTrack").addEventListener("pointermove", e => {
  const r = $("tlChart").getBoundingClientRect(), x = e.clientX - r.left;
  if (x < 0 || x > r.width || e.clientY > r.bottom) { $("tlTip").hidden = true; return; }
  const t = Math.min(H - 1, Math.floor((x / r.width) * H));
  $("tlTip").innerHTML = "<b>" + hourLabel(t) + "</b> · " + (S.mode === "chuva" ? fmt(F.hours[t], 1) + " mm/h · rio " + fmt(F.sim.rise[t], 1) + " m" : "calor " + fmt(F.hiAt(t), 0) + " °C");
  $("tlTip").style.left = x + "px"; $("tlTip").hidden = false;
});
$("tlTrack").addEventListener("pointerleave", () => ($("tlTip").hidden = true));
let speed = 1;
$("speed").onclick = () => { speed = speed === 4 ? 1 : speed * 2; $("speed").textContent = speed + "×"; if (timer) { stop(); $("play").click(); } };


/* tela de início: escolhe a cidade; depois a câmera percorre a cidade para encher o cache da malha 3D */
// vista geral, 9 vistas médias em volta do centro e 5 vistas de perto nos pontos com mais registros
function preloadViews() {
  const [x, y] = CITY.c, v = [[x, y, CITY.r, -18, -48]];
  for (const dy of [0.03, 0, -0.03]) for (const dx of [-0.05, 0, 0.05]) v.push([x + dx, y + dy, 2600, -18, -45]);
  (hist?.pontos || []).slice().sort((a, b) => (b.datas || []).length - (a.datas || []).length).slice(0, 5).forEach((p, i) => v.push([p.lon, p.lat, 700, -18 + i * 70, -40]));
  return v;
}
let globeReady, started = false;
const globeOk = new Promise(r => (globeReady = r));
// contorno do município em SVG para a tela de início
const outline = ring => { const [w, s2, e, n] = bounds(ring), k = 100 / Math.max(e - w, (n - s2) * 1.08);
  return '<svg viewBox="-4 -4 108 108" aria-hidden="true"><path d="' + ring.map((p, i) => (i ? "L" : "M") + ((p[0] - w) * k).toFixed(1) + " " + ((n - p[1]) * k * 1.08).toFixed(1)).join("") + 'Z"/></svg>'; };
let ringsP = null;
const cityRings = () => ringsP || (ringsP = Promise.all(Object.keys(CITY_DATA).map(async k =>
  [k, k === "sorocaba" ? LIMITE_SOROCABA.coordinates[0] : (await getJSON(CITY_DATA[k].file("limite")))?.coordinates[0]])).then(Object.fromEntries));
async function drawSplash() {
  const rings = await cityRings();
  $("spCities").innerHTML = Object.entries(CITY_DATA).filter(([k]) => rings[k]).map(([k, c]) =>
    '<button type="button" data-k="' + k + '">' + outline(rings[k]) + "<b>" + c.n + "</b></button>").join("");
}
async function startCity() {
  if (started) return; started = true;
  $("spCities").hidden = true; $("spBar").hidden = false; $("spName").textContent = CITY.n;
  await globeOk; await new Promise(r => { const w = () => (hist ? r() : setTimeout(w, 100)); w(); });
  await globe.preload(preloadViews(), p => ($("spFill").style.width = Math.round(p * 100) + "%"));
  globe.flyTo(CITY.c[0], CITY.c[1], CITY.r, 0);
  document.body.classList.remove("intro"); $("splash").classList.add("out");
  setTimeout(() => $("splash").remove(), 700);
}
$("spCities").onclick = e => {
  const b = e.target.closest("button[data-k]"); if (!b) return;
  if (b.dataset.k === CITY_KEY) startCity(); else location.search = "?c=" + b.dataset.k + "&go=1";
};
if (new URLSearchParams(location.search).get("go")) startCity(); else drawSplash();
$("cityName").textContent = CITY.n + ", " + CITY.uf;
["sl0", "sl1", "sl2"].forEach((id, i) => ($(id).textContent = Math.round(CITY.alt[0] + (i * (CITY.alt[1] - CITY.alt[0])) / 2) + " m"));
// troca de cidade pelo menu do cabeçalho: cada cidade com o contorno; a atual volta para a vista geral
cityRings().then(rings => {
  $("cities").innerHTML = Object.entries(CITY_DATA).filter(([k]) => rings[k]).map(([k, c]) =>
    '<li><a href="?c=' + k + '&go=1"' + (k === CITY_KEY ? ' aria-current="true"' : "") + ">" + outline(rings[k]) + "<b>" + c.n + "</b><span>" + c.uf + "</span></a></li>").join("");
});
$("cities").onclick = e => { const a = e.target.closest('a[aria-current]'); if (!a) return; e.preventDefault(); goTo(CITIES[0], null); };

$("cityBtn").onclick = () => { const o = $("cityMenu").hidden; $("cityMenu").hidden = !o; $("cityBtn").setAttribute("aria-expanded", o); };
document.addEventListener("click", e => { if (!e.target.closest(".citysel")) $("cityMenu").hidden = true; });

/* busca no mapa: dados locais primeiro, depois ruas e lugares do Photon dentro da cidade */
const norm = t => String(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function localHits(q) {
  const src = [
    ...(bairros || []).map(([n, x, y]) => [n, x, y, "Bairro", "pino", "#5FA3CF"]),
    ...(schools || []).map(([n, x, y]) => [n, x, y, "Escola", "casa", "#3F7D55"]),
    ...(hist?.pontos || []).map(p => [p.nome, p.lon, p.lat, "Ocorrência registrada", "alerta", "#C98A12"]),
    ...STATIONS.map(st => [st.n, st.ll[0], st.ll[1], "Sensor " + st.id, ...SENSOR_ICON[st.c]]),
    ...(rivers?.features || []).filter(f => f.properties.n).map(f => { const c = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]; return [f.properties.n, c[0], c[1], "Rio ou córrego", "regua", "#1F7A8C"]; }),
  ];
  const seen = new Set(), out = [];
  for (const r of src) { const k = norm(r[0]); if (!k.includes(q) || seen.has(k)) continue; seen.add(k); out.push(r); }
  return out.sort((a, b) => norm(a[0]).indexOf(q) - norm(b[0]).indexOf(q)).slice(0, 7);
}
let findTmr, findHits = [];
function showHits(list) {
  findHits = list;
  $("findRes").innerHTML = list.map(([n, , , kind, g, c], i) => '<li><button type="button" data-i="' + i + '"' + (i ? "" : ' class="on"') + '><img src="' + icon(g, c) + '" alt=""><b>' + esc(n) + "</b><small>" + esc(kind) + "</small></button></li>").join("");
  $("findRes").hidden = !list.length;
}
function pickHit(i) {
  const h = findHits[i]; if (!h) return;
  $("findRes").hidden = true; $("find").value = h[0];
  setData("busca", { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: h[0], kind: h[3] }, geometry: { type: "Point", coordinates: [h[1], h[2]] } }] });
  globe && globe.flyTo(h[1], h[2], 450, 1.8);
}
$("find").addEventListener("input", e => {
  const q = norm(e.target.value.trim()); clearTimeout(findTmr);
  if (q.length < 2) { showHits([]); if (!q) setData("busca", null); return; }
  const local = localHits(q); showHits(local);
  if (q.length < 3) return;
  findTmr = setTimeout(() => fetch("https://photon.komoot.io/api/?limit=6&bbox=" + bounds(LIMITE.coordinates[0]).map(v => v.toFixed(3)).join(",") + "&q=" + encodeURIComponent(e.target.value.trim()))
    .then(r => r.json()).then(j => {
      if (norm($("find").value.trim()) !== q) return;
      const kinds = { street: "Rua", house: "Endereço", city: "Cidade", district: "Bairro", locality: "Localidade" };
      const geo = (j.features || []).map(f => { const p = f.properties; return [p.name || p.street || "", f.geometry.coordinates[0], f.geometry.coordinates[1],
        (kinds[p.type] || "Lugar") + (p.district ? ", " + p.district : ""), p.type === "street" ? "rua" : "pino", "#4E6068"]; })
        .filter(r => r[0] && !local.some(l => norm(l[0]) === norm(r[0])));
      showHits(local.concat(geo).slice(0, 10));
    }).catch(() => {}), 300);
});
$("find").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); pickHit(0); }
  if (e.key === "Escape") { $("findRes").hidden = true; }
});
$("findRes").onclick = e => { const b = e.target.closest("button[data-i]"); if (b) pickHit(+b.dataset.i); };
document.addEventListener("click", e => { if (!e.target.closest(".find")) $("findRes").hidden = true; });

/* banco de dados: tudo que o Véspera usa, com origem e registros */
let bairros = null;
function drawDB() {
  const q = $("dbq").value.trim().toLowerCase();
  const sets = [
    { n: "Ocorrências de alagamento", src: "Reportagens 2017 a 2026", cols: ["Local", "Tipo", "Bairro", "Datas"],
      rows: (hist?.pontos || []).map(p => [p.nome, p.tipo, p.bairro || "", (p.datas || []).join(", ")]) },
    { n: "Episódios de chuva", src: "Reportagens e Defesa Civil", cols: ["Data", "Episódio", "Chuva (mm)"],
      rows: (hist?.episodios || []).map(e => [e.data ? e.data.split("-").reverse().join("/") : "", e.titulo, e.chuva_mm ?? ""]) },
    { n: "Estações e sensores", src: "Cemaden, ANA, INMET, IPMet (leituras simuladas)", cols: ["ID", "Nome", "Rede", "Leitura agora"],
      rows: STATIONS.map(st => [st.id, st.n, conOf(st.c).org, F.sensors ? sensorValue(st, S.t) : ""]) },
    { n: "Escolas (abrigos possíveis)", src: "OpenStreetMap", cols: ["Nome", "Lon", "Lat"], rows: (schools || []).map(([n, x, y]) => [n, x.toFixed(4), y.toFixed(4)]) },
    { n: "Bairros", src: "OpenStreetMap", cols: ["Nome", "Lon", "Lat"], rows: (bairros || []).map(([n, x, y]) => [n, x, y]) },
    { n: "Rios e córregos", src: "OpenStreetMap", cols: ["Nome", "Tipo"], rows: (rivers?.features || []).map(f => [f.properties.n || "sem nome", { r: "rio", c: "canal", s: "córrego" }[f.properties.w]]) },
    { n: "Cobertura do solo", src: "OpenStreetMap, grade de 200 m", info: cover ? cover.nx + " × " + cover.ny + " células" : "" },
    { n: "Limite municipal", src: "IBGE, malha 2022", info: LIMITE.coordinates[0].length + " vértices" },
    { n: "Relevo", src: "Terrain Tiles (AWS Open Data)", info: "Terrarium, lido sob demanda" },
    { n: "Malha 3D da cidade", src: "Google Photorealistic 3D Tiles via Cesium ion", info: "transmitida por blocos" },
  ];
  const open = new Set([...$("db").querySelectorAll("details[open]")].map(d => d.dataset.n));
  $("db").innerHTML = sets.map(d => {
    const rows = d.rows ? d.rows.filter(r => !q || r.join(" ").toLowerCase().includes(q)) : null;
    const count = rows ? (q ? rows.length + " de " + d.rows.length : d.rows.length) : d.info;
    const body = rows ? (rows.length ? '<div class="tbl"><table><thead><tr>' + d.cols.map(c => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
      rows.slice(0, 400).map(r => "<tr>" + r.map(v => '<td title="' + esc(v) + '">' + esc(v) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>" : '<p class="empty">Nenhum registro com esse filtro.</p>') : "";
    return '<details data-n="' + d.n + '"' + (open.has(d.n) || (q && rows && rows.length) ? " open" : "") + "><summary><b>" + d.n + "</b><em>" + count + "</em><small>" + d.src + "</small></summary>" + body + "</details>";
  }).join("");
}
$("dbq").oninput = drawDB;
$("t-dad").addEventListener("click", drawDB);

/* aprendizado e histórico */
$("mlTxt").textContent = "Uma regressão logística por ameaça, treinada com " + (models.f.n + models.x.n) +
  " episódios de um histórico simulado de 30 anos, gerado pelo próprio modelo físico com ruído de registro. Na validação, com os 25% mais recentes, a AUC ficou em " +
  HAZ.map(h => h.n.toLowerCase() + " " + fmt(models[h.k].auc, 2)).join(", ") + ". Num produto real, o treino usaria o S2iD, os registros da Defesa Civil e as séries do Cemaden.";
function drawHistory() {
  const eps = hist?.episodios || []; if (!eps.length) return;
  $("histField").hidden = false;
  $("hist").innerHTML = eps.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "")).map(e =>
    "<li><b>" + esc(e.data ? e.data.split("-").reverse().join("/") : "") + "</b> " + esc(e.titulo) + (e.chuva_mm ? " · " + e.chuva_mm + " mm" : "") +
    "<p>" + esc(e.resumo || "") + "</p>" + ((e.fontes || [])[0] ? '<a href="' + esc(e.fontes[0]) + '" target="_blank" rel="noopener">Reportagem</a>' : "") + "</li>").join("");
}

update(true);
