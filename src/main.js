import "./style.css";
import { contours } from "d3-contour";
import * as M from "./model.js";
import { CONNECTORS, STATIONS, simulateSensors, lastValid, gaugeCross } from "./sensores.js";
import LIMITE from "./limite-sorocaba.json";
import { createGlobe } from "./globo.js";
import { loadElevation } from "./relevo.js";
import { icon, SENSOR_ICON } from "./icones.js";

const $ = id => document.getElementById(id);
const G = M.G, H = M.H;
const fmt = (v, d = 0) => v.toFixed(d).replace(".", ",");
const pct = p => (p > 0.99 ? "> 99%" : p < 0.01 ? "< 1%" : Math.round(p * 100) + "%");
// a previsão começa à meia-noite de hoje; rótulos com o dia real da semana
const T0 = new Date(); T0.setHours(0, 0, 0, 0);
const dayName = t => { const d = new Date(T0.getTime() + Math.floor(t / 24) * 864e5); return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "") + " " + d.getDate(); };
const hourLabel = t => dayName(t) + ", " + String(t % 24).padStart(2, "0") + "h";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CITIES = [
  { n: "Sorocaba", c: [-47.437, -23.47], r: 15000, ctx: "Cortada pelo Rio Sorocaba, com avenidas marginais e bairros baixos junto ao leito." },
  { n: "Petrópolis", c: [-43.178, -22.505], r: 5000, ctx: "Serra fluminense. Em 2022, chuvas extremas causaram deslizamentos com centenas de mortes." },
  { n: "São Sebastião", c: [-45.68, -23.79], r: 6000, ctx: "Litoral norte de SP. Em 2023, deslizamentos atingiram a Vila Sahy após chuva recorde." },
  { n: "Porto Alegre", c: [-51.215, -30.03], r: 8000, ctx: "Às margens do Guaíba. Em 2024, a cidade viveu a maior enchente de sua história." },
  { n: "Blumenau", c: [-49.066, -26.919], r: 5000, ctx: "Vale do Itajaí, com histórico de cheias e a tragédia de 2008." },
];
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
  risk: p => "<b>" + { f: "Inundação prevista", a: "Faixa de atenção", s: "Encosta instável", x: "Perigo de incêndio", h: "Ilha de calor" }[p.k] + "</b><br>" + hourLabel(S.t) +
    (p.k === "f" || p.k === "a" ? "<br>Rio " + fmt(p.d || 0, 1) + " m acima do normal" : "") +
    (p.k === "s" ? "<br>Declividade acima de " + fmt(M.slopeThreshold(F.slideAt(S.t)), 0) + "% com solo " + ["seco", "úmido", "muito úmido", "saturado"][Math.min(3, Math.floor(F.sat0 * 4))] : "") +
    (p.k === "x" ? "<br>FMA+ " + M.FMA_CLASSES[M.fmaClass(F.fmaAt(S.t))].toLowerCase() : "") +
    (p.k === "h" ? "<br>Índice de calor " + fmt(F.hiAt(S.t), 0) + " °C" : ""),
  hist: p => "<b>" + esc(p.nome) + "</b><br>" + esc(p.tipo) + (p.datas ? "<br><small>" + esc(p.datas) + "</small>" : "") +
    (p.fonte ? '<br><a href="' + esc(p.fonte) + '" target="_blank" rel="noopener">Fonte</a>' : ""),
};
createGlobe($("map"), { token: import.meta.env.VITE_CESIUM_TOKEN, limite: LIMITE, onMoveEnd: scheduleSample, popup: (k, p) => POPS[k](p) }).then(g => {
  globe = g;
  for (const id in DATA) g.setData(id, DATA[id]);
  // relevo de Sorocaba uma vez, para pousar pontos e rótulos sem prender ao 3D Tiles
  loadElevation(-47.58, -23.6, -47.29, -23.34, 300).then(fn => g.setElevation(fn));
  applyFilter();
  const c = CITIES[0]; g.flyTo(c.c[0], c.c[1], c.r, 0);
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
}
$("vFoto").onclick = () => setStyle(false); $("vCien").onclick = () => setStyle(true);

/* ---------- dados locais ---------- */
const getJSON = u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);
getJSON("/rios-sorocaba.geojson").then(j => { rivers = j; if (j) setData("rios", j); scheduleSample(); });
getJSON("/bairros-sorocaba.json").then(j => { bairros = j; if (j) setData("bairros", j); });
getJSON("/cobertura-sorocaba.json").then(j => { cover = j; scheduleSample(); });
getJSON("/escolas-sorocaba.json").then(j => { schools = j; pickShelters(); });
getJSON("/historico-sorocaba.json").then(j => { hist = j; if (j) { setData("hist", histGeo()); drawHistory(); plan(); } });
const histGeo = () => ({ type: "FeatureCollection", features: (hist?.pontos || []).filter(p => p.lat && p.lon).map(p => ({ type: "Feature",
  properties: { nome: p.nome, tipo: p.tipo + (p.bairro ? ", " + p.bairro : ""), datas: (p.datas || []).join(", "), fonte: (p.fontes || [])[0] || "" },
  geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });

/* ---------- leitura do relevo ---------- */
let sampleTmr = null, sampleReq = 0;
function scheduleSample() { clearTimeout(sampleTmr); sampleTmr = setTimeout(sample, 350); }
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
  const el = new Float32Array(G * G).fill(NaN), veg = new Float32Array(G * G), built = new Float32Array(G * G);
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
    const x = west + (c + 0.5) * dx, y = south + (r + 0.5) * dy, i = r * G + c;
    const v = elevAt(x, y);
    if (v != null) el[i] = v;
    veg[i] = coverAt(x, y, "veg"); built[i] = coverAt(x, y, "built");
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
  grid = vals.length < 100 ? null : { west, south, dx, dy, el, slope, veg, built, cx: cen.lon, cy: cen.lat,
    builtSorted: Array.from(built).filter(v => v > 0).sort((a, b) => b - a),
    base: vals[Math.floor(vals.length * 0.03)], hand: M.computeHAND(el, lines, west, south, dx, dy, elevAt) };
  pickShelters(); render();
}

/* ---------- desenho do mapa na hora t ---------- */
function render() {
  const st = hourState(S.t);
  cl = M.classify(grid, st);
  setData("risk", grid ? riskShapes() : null);
  drawSensorsOnMap(); drawShelters(); areaFacts(st); drawLegend();
}

/* Contornos suaves (marching squares) de cada classe, em vez de quadrados da grade.
   Ordem de desenho: atenção por baixo, inundação por cima. */
const contour = contours().size([G, G]).thresholds([0.5]).smooth(true);
function riskShapes() {
  const feats = [], toLL = ([c, r]) => [grid.west + c * grid.dx, grid.south + r * grid.dy];
  for (const k of [2, 1, 3, 4, 5]) {
    const v = new Float64Array(G * G);
    let any = false;
    for (let i = 0; i < G * G; i++) if (cl.f[i] === k || (k === 2 && cl.f[i] === 1)) { v[i] = 1; any = true; }
    if (!any) continue;
    const [mp] = contour(v);
    const area = r => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const polys = mp.coordinates.filter(poly => area(poly[0]) >= 3); // ponytail: manchas menores que 3 células viram ruído e custam um polígono cada
    if (polys.length && !OFF.has("risk-" + M.KIND[k])) feats.push({ type: "Feature", properties: { k: M.KIND[k], d: S.mode === "chuva" ? F.sim.rise[S.t] : 0 },
      geometry: { type: "MultiPolygon", coordinates: polys.map(poly => poly.map(ring => ring.map(toLL))) } });
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
const OFF = new Set();
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
  if (local.length) { shelters = local.map(([name, x, y]) => ({ name, c: [x, y] })); drawShelters(); return; }
  // fora de Sorocaba: escolas do OpenStreetMap via Overpass
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
    return '<li><div class="hz-top"><b>' + h.n + "</b><span>" + pct(p) + '</span></div><div class="bar"><i style="width:' + Math.max(1, p * 100) + "%;background:" + h.color + '"></i></div>' +
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
    const R1 = STATIONS.find(s => s.id === "R1"), ga = gaugeCross(F.sensors.R1, R1, "alert"), go = gaugeCross(F.sensors.R1, R1, "over");
    if (S.rain >= 60) add("pv", "f", "Plano Verão: " + S.rain + " mm previstos em 72 h passam do critério de alerta da Defesa Civil de Sorocaba (60 mm em 3 dias).", false);
    if (ga != null) add("r1", "f", "Prontidão: a régua da Praça Lions passa de " + fmt(R1.alert, 1) + " m acima do normal em " + hourLabel(ga) +
      (go != null ? " e chega a " + fmt(R1.over, 1) + " m, nível em que a Dom Aguirre alaga, em " + hourLabel(go) : "") + ".", false);
    if (P.f >= 0.15 && E.f != null) {
      const named = [...new Set(histNames("").filter(n => !n.includes("Dom Aguirre") && !n.includes("Praça Lions")))].slice(0, 3);
      add("int", "f", "Interditar a Av. Dom Aguirre" + (named.length ? ", " + named.join(", ") : "") + " e travessias nas áreas em azul até " + hourLabel(Math.max(0, E.f - 2)) + ".", true);
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
  let m = "Defesa Civil: risco de " + hz.map(h => what[h]).join(" e ") + " em Sorocaba" + (first < 99 ? " a partir de " + hourLabel(first) : "") + ". ";
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
    cidade: "Sorocaba", hora: hourLabel(S.t), modo: S.mode,
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
  const xt = (S.t + 0.5) * cw;
  s += `<line x1="${xt}" x2="${xt}" y1="0" y2="${Hh}" stroke="#E3E9EE" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  $("tlChart").innerHTML = s;
  $("tlDays").innerHTML = [0, 1, 2].map(d => '<span style="left:' + ((d * 24 + 12) / H) * 100 + '%">' + dayName(d * 24) + "</span>").join("");
  $("tlVals").innerHTML = S.mode === "chuva"
    ? "<span>Chuva <b>" + fmt(F.hours[S.t], 1) + "</b> mm/h</span><span>Rio <b>" + fmt(F.sim.rise[S.t], 1) + "</b> m</span>"
    : "<span>Calor <b>" + fmt(F.hiAt(S.t), 0) + "</b> °C</span>";
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
function setRain(v) { S.rain = Math.max(0, Math.min(250, Math.round(v / 5) * 5)); update(true); }
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
  timer = setInterval(() => { if (S.t >= H - 1) return stop(); setHour(S.t + 1); }, 260);
};
$("hour").oninput = e => { stop(); setHour(+e.target.value); };

/* cidades e busca */
function goTo(city, btn) {
  document.querySelectorAll("#cities button").forEach(x => x.setAttribute("aria-pressed", x === btn));
  $("cityName").textContent = city.n ? city.n : (city.ctx || "").split(",")[0];
  if (!globe) return;
  globe.focusCity(city.n === "Sorocaba");
  globe.flyTo(city.c[0], city.c[1], city.r || 5000);
}
CITIES.forEach((c, i) => { const b = document.createElement("button"); b.type = "button"; b.textContent = c.n; b.setAttribute("aria-pressed", i === 0); b.onclick = () => goTo(c, b); $("cities").appendChild(b); });
let tmr;
$("q").addEventListener("input", e => {
  clearTimeout(tmr); const q = e.target.value.trim(); if (q.length < 3) { $("sugg").hidden = true; return; }
  tmr = setTimeout(() => {
    fetch("https://photon.komoot.io/api/?limit=5&osm_tag=place:city&osm_tag=place:town&q=" + encodeURIComponent(q))
      .then(r => r.json()).then(j => {
        const ul = $("sugg"); ul.innerHTML = "";
        (j.features || []).forEach(f => {
          const li = document.createElement("li"), b = document.createElement("button");
          const pr = f.properties, where = [pr.state, pr.country].filter(Boolean).join(", ");
          b.innerHTML = esc(pr.name) + " <small>" + esc(where) + "</small>";
          b.onclick = () => { ul.hidden = true; $("q").value = ""; goTo({ c: f.geometry.coordinates, r: 5000, ctx: pr.name + (where ? ", " + where : "") }, null); };
          li.appendChild(b); ul.appendChild(li);
        });
        ul.hidden = !ul.children.length;
      }).catch(() => {});
  }, 400);
});

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

/* busca no mapa: dados locais primeiro, depois ruas e lugares do Photon dentro de Sorocaba */
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
  findTmr = setTimeout(() => fetch("https://photon.komoot.io/api/?limit=6&bbox=-47.58,-23.6,-47.29,-23.34&q=" + encodeURIComponent(e.target.value.trim()))
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
  " episódios de um histórico simulado de 30 anos de Sorocaba, gerado pelo próprio modelo físico com ruído de registro. Na validação, com os 25% mais recentes, a AUC ficou em " +
  HAZ.map(h => h.n.toLowerCase() + " " + fmt(models[h.k].auc, 2)).join(", ") + ". Num produto real, o treino usaria o S2iD, os registros da Defesa Civil e as séries do Cemaden.";
function drawHistory() {
  const eps = hist?.episodios || []; if (!eps.length) return;
  $("histField").hidden = false;
  $("hist").innerHTML = eps.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "")).map(e =>
    "<li><b>" + esc(e.data ? e.data.split("-").reverse().join("/") : "") + "</b> " + esc(e.titulo) + (e.chuva_mm ? " · " + e.chuva_mm + " mm" : "") +
    "<p>" + esc(e.resumo || "") + "</p>" + ((e.fontes || [])[0] ? '<a href="' + esc(e.fontes[0]) + '" target="_blank" rel="noopener">Reportagem</a>' : "") + "</li>").join("");
}

update(true);
