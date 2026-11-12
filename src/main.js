import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { contours } from "d3-contour";
import * as M from "./model.js";
import { CONNECTORS, STATIONS, simulateSensors, lastValid, gaugeCross } from "./sensores.js";

const $ = id => document.getElementById(id);
const G = M.G, H = M.H;
const fmt = (v, d = 0) => v.toFixed(d).replace(".", ",");
const pct = p => (p > 0.99 ? "> 99%" : p < 0.01 ? "< 1%" : Math.round(p * 100) + "%");
const hourLabel = t => "dia " + (Math.floor(t / 24) + 1) + ", " + String(t % 24).padStart(2, "0") + "h";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CITIES = [
  { n: "Sorocaba", c: [-47.452, -23.492], z: 12.6, ctx: "Cortada pelo Rio Sorocaba, com avenidas marginais e bairros baixos junto ao leito." },
  { n: "Petrópolis", c: [-43.178, -22.505], z: 13, ctx: "Serra fluminense. Em 2022, chuvas extremas causaram deslizamentos com centenas de mortes." },
  { n: "São Sebastião", c: [-45.68, -23.79], z: 12.4, ctx: "Litoral norte de SP. Em 2023, deslizamentos atingiram a Vila Sahy após chuva recorde." },
  { n: "Porto Alegre", c: [-51.215, -30.03], z: 12, ctx: "Às margens do Guaíba. Em 2024, a cidade viveu a maior enchente de sua história." },
  { n: "Blumenau", c: [-49.066, -26.919], z: 12.8, ctx: "Vale do Itajaí, com histórico de cheias e a tragédia de 2008." },
];
const HAZ = [
  { k: "f", n: "Enchente", color: "#2C6CB0" },
  { k: "s", n: "Deslizamento", color: "#AE3A2C" },
  { k: "x", n: "Incêndio em vegetação", color: "#E0612B" },
  { k: "h", n: "Onda de calor", color: "#B0368A" },
];
const LEVELS = [["Observação", "var(--green)"], ["Atenção", "var(--ochre)"], ["Alerta", "var(--orange)"], ["Alerta máximo", "var(--brick)"]];

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
// Fontes abertas, sem chave: satélite Sentinel-2 (EOX), relevo Terrarium (AWS Open Data), rótulos OSM (CARTO).
const DEM = { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15,
  attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>' };
const STYLE = { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    sat: { type: "raster", tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg"], tileSize: 256, maxzoom: 15,
      attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless 2023</a> por EOX (dados Copernicus modificados)' },
    omt: { type: "vector", url: "https://tiles.openfreemap.org/planet",
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    dem: DEM, hs: { ...DEM },
  },
  layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.15, "raster-contrast": 0.08 } }] };
const map = new maplibregl.Map({ container: "map", style: STYLE, attributionControl: { compact: true }, center: CITIES[0].c, zoom: CITIES[0].z, pitch: 62, bearing: -18, maxPitch: 75, maxZoom: 17 });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
const FONT = ["Noto Sans Bold"];
const EMPTY = { type: "FeatureCollection", features: [] };
const setData = (id, d) => { const s = map.getSource(id); if (s) s.setData(d); };

map.on("style.load", () => {
  map.setTerrain({ source: "dem", exaggeration: S.is3D ? 1.6 : 1 });
  try { map.setSky({ "sky-color": "#28507F", "horizon-color": "#DCE6EC", "fog-color": "#DCE6EC", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.85 }); } catch (e) {}
  map.addLayer({ id: "hillshade", type: "hillshade", source: "hs", layout: { visibility: S.is3D ? "none" : "visible" },
    paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#1B2A31" } });
  map.addSource("risk", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "risk-fill", type: "fill", source: "risk", paint: {
    "fill-color": ["match", ["get", "k"], "f", "#2F80E0", "a", "#C4841C", "s", "#AE3A2C", "x", "#E0612B", "h", "#B0368A", "#000"],
    "fill-opacity": ["match", ["get", "k"], "f", 0.6, "a", 0.4, "s", 0.55, "x", 0.55, "h", 0.42, 0], "fill-antialias": false } });
  map.addSource("rios", { type: "geojson", data: rivers || EMPTY });
  map.addLayer({ id: "rios", type: "line", source: "rios", paint: { "line-color": "#7FC4F0",
    "line-width": ["match", ["get", "w"], "r", 3, "c", 1.6, 1.1], "line-opacity": 0.9 } });
  map.addSource("predios", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "predios", type: "fill-extrusion", source: "predios", minzoom: 13, paint: {
    "fill-extrusion-color": "#E3E6E1", "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.85 } });
  const halo = { "text-color": "#fff", "text-halo-color": "rgba(27,42,49,.9)", "text-halo-width": 1.4 };
  map.addLayer({ id: "ruas", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "line" }, paint: halo });
  map.addLayer({ id: "bairros", type: "symbol", source: "omt", "source-layer": "place", minzoom: 11,
    filter: ["any", ["in", ["get", "class"], ["literal", ["suburb", "town", "city"]]], [">=", ["zoom"], 14]],
    layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": ["match", ["get", "class"], "city", 15, "town", 13, 11.5],
      "text-transform": "uppercase", "text-letter-spacing": 0.06 }, paint: halo });
  getJSON("/predios-sorocaba.geojson").then(j => j && setData("predios", j));
  map.addSource("hist", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "hist", type: "circle", source: "hist", paint: { "circle-radius": 5, "circle-color": "#1B2A31",
    "circle-stroke-color": "#F2C14E", "circle-stroke-width": 2, "circle-pitch-alignment": "map" } });
  map.addSource("sens", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "sens", type: "circle", source: "sens", paint: { "circle-radius": 6,
    "circle-color": ["case", ["get", "bad"], "#AE3A2C", "#FFFFFF"], "circle-stroke-color": "#1B2A31", "circle-stroke-width": 2.5 } });
  map.addLayer({ id: "sens-t", type: "symbol", source: "sens", minzoom: 12, layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": FONT,
    "text-offset": [0, 1.2], "text-anchor": "top" }, paint: { "text-color": "#fff", "text-halo-color": "#1B2A31", "text-halo-width": 1.4 } });
  map.addSource("shel", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "shel-c", type: "circle", source: "shel", paint: { "circle-radius": 8, "circle-color": "#E6ECE8",
    "circle-stroke-color": "#3F7D55", "circle-stroke-width": 3, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "shel-t", type: "symbol", source: "shel", layout: { "text-field": ["get", "name"], "text-size": 12, "text-font": FONT, "text-offset": [0, 1.3], "text-anchor": "top" },
    paint: { "text-color": "#fff", "text-halo-color": "#1B2A31", "text-halo-width": 1.6 } });

  const popup = (layer, html) => {
    map.on("click", layer, e => new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(html(e.features[0].properties)).addTo(map));
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  };
  popup("shel-c", p => "<b>Abrigo sugerido</b><br>" + esc(p.name) + "<br><small>Escola fora das áreas de risco. Exemplo, não é abrigo oficial.</small>");
  popup("sens", p => sensorPopup(p.id));
  popup("hist", p => "<b>" + esc(p.nome) + "</b><br>" + esc(p.tipo) + (p.datas ? "<br><small>" + esc(p.datas) + "</small>" : "") +
    (p.fonte ? '<br><a href="' + esc(p.fonte) + '" target="_blank" rel="noopener">Fonte</a>' : ""));
  if (hist) setData("hist", histGeo());
  scheduleSample();
});

/* 2D / 3D */
function setView(three) {
  S.is3D = three; $("v3").setAttribute("aria-pressed", three); $("v2").setAttribute("aria-pressed", !three);
  if (map.getSource("dem")) { map.setTerrain({ source: "dem", exaggeration: three ? 1.6 : 1 }); map.setLayoutProperty("hillshade", "visibility", three ? "none" : "visible"); }
  if (three) { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.easeTo({ pitch: 62, bearing: -18, duration: 1200 }); }
  else { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.easeTo({ pitch: 0, bearing: 0, duration: 1200 }); }
}
$("v3").onclick = () => setView(true); $("v2").onclick = () => setView(false);

/* ---------- dados locais ---------- */
const getJSON = u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);
getJSON("/rios-sorocaba.geojson").then(j => { rivers = j; if (j) setData("rios", j); scheduleSample(); });
getJSON("/cobertura-sorocaba.json").then(j => { cover = j; scheduleSample(); });
getJSON("/escolas-sorocaba.json").then(j => { schools = j; pickShelters(); });
getJSON("/historico-sorocaba.json").then(j => { hist = j; if (j) { setData("hist", histGeo()); drawHistory(); plan(); } });
const histGeo = () => ({ type: "FeatureCollection", features: (hist?.pontos || []).filter(p => p.lat && p.lon).map(p => ({ type: "Feature",
  properties: { nome: p.nome, tipo: p.tipo + (p.bairro ? ", " + p.bairro : ""), datas: (p.datas || []).join(", "), fonte: (p.fontes || [])[0] || "" },
  geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });

/* ---------- leitura do relevo ---------- */
let pending = false;
function scheduleSample() {
  if (pending || !map.getTerrain()) return;
  pending = true; $("busy").hidden = false;
  map.once("idle", () => { pending = false; sample(); });
}
map.on("moveend", scheduleSample);
function coverAt(lon, lat, key) {
  if (!cover) return NaN;
  const c = Math.floor((lon - cover.west) / cover.d), r = Math.floor((lat - cover.south) / cover.d);
  return c < 0 || r < 0 || c >= cover.nx || r >= cover.ny ? NaN : cover[key][r * cover.nx + c];
}
function sample() {
  const b = map.getBounds(), cen = map.getCenter(), f = S.is3D ? 0.42 : 0.48;
  const w = (b.getEast() - b.getWest()) * f, h = (b.getNorth() - b.getSouth()) * f;
  const west = cen.lng - w, south = cen.lat - h, dx = (2 * w) / G, dy = (2 * h) / G;
  const ex = map.getTerrain()?.exaggeration || 1;
  const el = new Float32Array(G * G).fill(NaN), veg = new Float32Array(G * G), built = new Float32Array(G * G);
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
    const x = west + (c + 0.5) * dx, y = south + (r + 0.5) * dy, i = r * G + c;
    const v = map.queryTerrainElevation([x, y]);
    if (v != null) el[i] = v / ex;
    veg[i] = coverAt(x, y, "veg"); built[i] = coverAt(x, y, "built");
  }
  const mx = dx * 111320 * Math.cos((cen.lat * Math.PI) / 180), my = dy * 110540, slope = new Float32Array(G * G);
  for (let r = 1; r < G - 1; r++) for (let c = 1; c < G - 1; c++) {
    const i = r * G + c; slope[i] = Math.hypot((el[i + 1] - el[i - 1]) / (2 * mx), (el[i + G] - el[i - G]) / (2 * my)) * 100;
  }
  const vals = Array.from(el).filter(v => !isNaN(v)).sort((a, b) => a - b);
  $("busy").hidden = true;
  // drenagem: rios, canais e córregos com nome; nascentes sem nome ficam de fora
  const W = { r: 1, c: 0.5, s: 0.35 }, lines = rivers ? rivers.features.filter(f => f.properties.w !== "s" || f.properties.n)
    .map(f => ({ p: f.geometry.coordinates, w: W[f.properties.w] })) : [];
  grid = vals.length < 100 ? null : { west, south, dx, dy, el, slope, veg, built,
    builtSorted: Array.from(built).filter(v => v > 0).sort((a, b) => b - a),
    base: vals[Math.floor(vals.length * 0.03)], hand: M.computeHAND(el, lines, west, south, dx, dy, (x, y) => { const v = map.queryTerrainElevation([x, y]); return v == null ? null : v / ex; }) };
  pickShelters(); render();
}

/* ---------- desenho do mapa na hora t ---------- */
function render() {
  const st = hourState(S.t);
  cl = M.classify(grid, st);
  setData("risk", grid && $("lR").checked ? riskShapes() : EMPTY);
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
    feats.push({ type: "Feature", properties: { k: M.KIND[k] },
      geometry: { type: "MultiPolygon", coordinates: mp.coordinates.map(poly => poly.map(ring => ring.map(toLL))) } });
  }
  return { type: "FeatureCollection", features: feats };
}

function areaFacts(st) {
  const n = cl.n, t = n.t || 1, pc = v => (grid ? fmt((100 * v) / t, 1) + "%" : "");
  const sw = c => '<i class="sw" style="background:' + c + '"></i>';
  const cells = S.mode === "chuva"
    ? [[pc(n.f), sw("var(--water)") + "Inundação"], [pc(n.a), sw("var(--ochre)") + "Atenção"], [pc(n.s), sw("var(--brick)") + "Encostas"]]
    : [[pc(n.x), sw("#E0612B") + "Incêndio"], [pc(n.h), sw("#B0368A") + "Calor extremo"], [cover ? "" : "", "&nbsp;"]];
  $("areaFacts").innerHTML = cells.map(([v, l]) => "<div><b>" + v + "</b><span>" + l + "</span></div>").join("");
  if (!grid) { $("riseTxt").textContent = "Aproxime o mapa de uma cidade para o Véspera ler o relevo."; return; }
  const pts = (hist?.pontos || []).map(p => cellOf([p.lon, p.lat])).filter(i => i >= 0), hit = pts.filter(i => cl.f[i] === 1 || cl.f[i] === 2).length;
  $("riseTxt").textContent = S.mode === "chuva"
    ? "Em " + hourLabel(S.t) + ", rio " + fmt(st.rise, 1) + " m acima do normal" + (grid.hand ? "." : ". Sem rios mapeados aqui: comparado às cotas mais baixas da tela.") +
      (pts.length ? " " + hit + " de " + pts.length + " pontos com alagamento registrado ficam dentro da mancha." : "")
    : (!isNaN(coverAt(map.getCenter().lng, map.getCenter().lat, "veg")) ? "Em " + hourLabel(S.t) + ", perigo de incêndio " + M.FMA_CLASSES[st.fireClass].toLowerCase() + " e índice de calor " + fmt(F.hiAt(S.t), 0) + " °C."
      : "Cobertura do solo disponível só para Sorocaba.");
}

function drawLegend() {
  const it = S.mode === "chuva"
    ? [["var(--water)", "Inundação prevista"], ["var(--ochre)", "Faixa de atenção"], ["var(--brick)", "Encosta instável"]]
    : [["#E0612B", "Vegetação com perigo de incêndio"], ["#B0368A", "Ilha de calor"]];
  it.push(["#7FC4F0", "Rio ou córrego", true]);
  $("legend").innerHTML = it.map(([c, l, line]) => '<span><i class="sw' + (line ? " line" : "") + '" style="background:' + c + '"></i>' + l + "</span>").join("") +
    '<span><i class="sw dot" style="background:#E6ECE8;border-color:#3F7D55"></i>Abrigo sugerido</span>' +
    '<span><i class="sw dot" style="background:#fff;border-color:#1B2A31"></i>Sensor</span>' +
    (hist ? '<span><i class="sw dot" style="background:#1B2A31;border-color:#F2C14E"></i>Ocorrência registrada</span>' : "");
}

/* ---------- abrigos ---------- */
let searchReq = 0;
function pickShelters() {
  if (!grid) return;
  const inGrid = ([, x, y]) => x > grid.west && y > grid.south && x < grid.west + G * grid.dx && y < grid.south + G * grid.dy;
  const local = (schools || []).filter(inGrid);
  if (local.length) { shelters = local.map(([name, x, y]) => ({ name, c: [x, y] })); drawShelters(); return; }
  // fora de Sorocaba: escolas do OpenStreetMap via Overpass
  const id = ++searchReq, b = map.getBounds(), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(v => v.toFixed(3)).join(",");
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
  const list = $("lH").checked && F.level >= 2 && S.mode === "chuva" ? safeShelters() : [];
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
  const on = $("lS").checked;
  setData("sens", { type: "FeatureCollection", features: on ? STATIONS.map(st => ({ type: "Feature",
    properties: { id: st.id, bad: !!F.sensors[st.id].flag[S.t], label: st.id + " " + sensorValue(st, S.t) },
    geometry: { type: "Point", coordinates: st.ll } })) : [] });
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
    '<path d="' + d + '" fill="none" stroke="#1B2A31" stroke-width="1.4"/>' +
    '<line x1="' + x + '" x2="' + x + '" y1="0" y2="' + Hh + '" stroke="#2C6CB0" stroke-width="1.5"/></svg>';
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
    return '<section class="connector"><header><h3>' + esc(c.n) + "</h3><p>" + esc(c.org + " · " + c.proto + " · a cada " + c.cad) + "</p></header><ul>" + rows + "</ul></section>";
  }).join("");
}

/* ---------- riscos e plano ---------- */
function drawHazards() {
  $("hazards").innerHTML = HAZ.map(h => {
    const p = F.prob[h.k], e = F.eta[h.k];
    const when = e == null ? (p >= 0.15 ? "limiar não cruzado em 72 h" : "") : e === 0 ? "limiar já ultrapassado" : "em " + e + " h, " + hourLabel(e);
    return '<li><div class="hz-top"><b>' + h.n + "</b><span>" + pct(p) + '</span></div><div class="bar"><i style="width:' + Math.max(1, p * 100) + "%;background:" + h.color + '"></i></div>' +
      (when ? '<p class="hz-eta">' + when + "</p>" : "") + "</li>";
  }).join("");
  const lv = LEVELS[F.level]; $("level").textContent = lv[0]; $("level").style.background = lv[1];
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
    : "<p class=\"muted\">Aprove ações do plano para montar a mensagem.</p>";
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
function drawHyeto() {
  const W = 356, Hh = 128, L = 30, B = 22, T = 8, cw = (W - L - 4) / H, maxV = Math.max(5, Math.ceil(F.peak / 5) * 5), y = v => Hh - B - (v / maxV) * (Hh - B - T);
  let s = "";
  for (let k = 0; k <= 2; k++) { const v = (maxV * k) / 2, yy = y(v); s += `<line x1="${L}" x2="${W - 4}" y1="${yy}" y2="${yy}" stroke="#A9B8B1" stroke-width="${k ? 0.6 : 1}"/><text x="${L - 5}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="#4E6068" font-family="Archivo">${Math.round(v)}</text>`; }
  for (let d = 1; d < 3; d++) { const x = L + d * 24 * cw; s += `<line x1="${x}" x2="${x}" y1="${T}" y2="${Hh - B}" stroke="#A9B8B1" stroke-dasharray="2 3"/>`; }
  ["Dia 1", "Dia 2", "Dia 3"].forEach((t, d) => (s += `<text x="${L + (d * 24 + 12) * cw}" y="${Hh - 6}" text-anchor="middle" font-size="10.5" fill="#4E6068" font-family="Archivo">${t}</text>`));
  F.hours.forEach((v, t) => { const c = v > 60 ? "#AE3A2C" : v > 30 ? "#C55A1F" : v >= 20 ? "#C4841C" : "#2C6CB0"; s += `<rect x="${L + t * cw + 0.4}" y="${y(v)}" width="${Math.max(0.8, cw - 0.8)}" height="${Math.max(0, Hh - B - y(v))}" fill="${c}"/>`; });
  let acc = 0; const pts = F.hours.map((v, t) => { acc += v; return [L + (t + 1) * cw, Hh - B - (acc / Math.max(S.rain, 1)) * (Hh - B - T)]; });
  if (S.rain > 0) s += `<polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#1B2A31" stroke-width="1.4"/>`;
  const xt = L + (S.t + 0.5) * cw; s += `<line x1="${xt}" x2="${xt}" y1="${T}" y2="${Hh - B}" stroke="#1B2A31" stroke-width="1.5"/>`;
  s += `<text x="${L}" y="${T + 2}" font-size="10" fill="#4E6068" font-family="Archivo">mm/h</text>`;
  $("hyeto").innerHTML = s;
  $("fPeak").textContent = fmt(F.peak, F.peak < 10 ? 1 : 0);
  $("fWhen").textContent = S.rain ? "D" + (Math.floor(F.peakT / 24) + 1) + " " + String(F.peakT % 24).padStart(2, "0") + "h" : "";
  $("fDay").textContent = Math.round(F.dayMax);
  const iv = [["Sem aviso do INMET pelos critérios de chuva", "var(--green)"], ["Equivale a aviso amarelo do INMET (perigo potencial)", "var(--ochre)"],
    ["Equivale a aviso laranja do INMET (perigo)", "var(--orange)"], ["Equivale a aviso vermelho do INMET (grande perigo)", "var(--brick)"]][F.inmet.level];
  $("inmet").style.borderLeftColor = iv[1];
  $("inmet").textContent = iv[0] + (F.inmet.level ? ", pelo critério de " + (F.inmet.byI ? "intensidade horária." : "acumulado diário.") : ".");
}
function drawDry() {
  $("anomOut").textContent = "+" + fmt(S.anom, 1) + " °C"; $("heatDaysOut").textContent = S.heatDays + (S.heatDays === 1 ? " dia" : " dias");
  $("rhMinOut").textContent = S.rhMin + "%"; $("dryDaysOut").textContent = S.dryDays + (S.dryDays === 1 ? " dia" : " dias"); $("windOut").textContent = S.wind + " km/h";
  $("fFma").textContent = fmt(F.fma, 1); $("fHi").textContent = fmt(F.hiMax, 0); $("fTmax").textContent = fmt(M.TMAX_CLIM + S.anom, 0);
  const iv = [["Sem aviso de onda de calor do INMET", "var(--green)"], ["Equivale a aviso amarelo de onda de calor do INMET", "var(--ochre)"],
    ["Equivale a aviso laranja de onda de calor do INMET", "var(--orange)"], ["Equivale a aviso vermelho de onda de calor do INMET", "var(--brick)"]][F.heatLevel];
  $("inmetHeat").style.borderLeftColor = iv[1];
  $("inmetHeat").textContent = iv[0] + ". Perigo de incêndio " + M.FMA_CLASSES[M.fmaClass(F.fma)].toLowerCase() + " pela FMA+; índice de calor máximo na faixa " + M.HI_CLASSES[M.hiClass(F.hiMax)].toLowerCase() + ".";
}

/* ---------- atualização ---------- */
function update(resetHour) {
  forecast();
  if (resetHour) setHour(S.mode === "chuva" ? (F.riseMax > 0.05 ? F.riseT : F.peakT) : F.hiT, true);
  $("fill").style.height = (S.rain / 250) * 100 + "%"; $("mm").textContent = S.rain; $("tube").setAttribute("aria-valuenow", S.rain);
  $("liters").textContent = S.rain + " litros por metro quadrado";
  $("anteOut").textContent = S.ante + " mm";
  $("soil").textContent = "Umidade do solo " + fmt(M.theta0(S.ante) * 100, 0) + "% (volume). CN ajustado " + fmt(F.sim.cn, 0) + ": " + Math.round(F.sim.C * 100) + "% da chuva vira escoamento.";
  $("g-chuva").hidden = S.mode !== "chuva"; $("g-seco").hidden = S.mode !== "seco";
  drawHazards(); drawHyeto(); drawDry(); drawHour();
}
function drawHour() { render(); drawSensorsTab(); plan(); if (S.mode === "chuva") drawHyeto(); }
function setHour(t, quiet) {
  S.t = Math.max(0, Math.min(H - 1, t)); $("hour").value = S.t; $("hourOut").textContent = hourLabel(S.t).replace("dia", "Dia");
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
["lR", "lS", "lH"].forEach(id => ($(id).onchange = render));
$("lO").onchange = () => map.getLayer("hist") && map.setLayoutProperty("hist", "visibility", $("lO").checked ? "visible" : "none");

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
  timer = setInterval(() => { if (S.t >= H - 1) return stop(); setHour(S.t + 1); }, 140);
};
$("hour").oninput = e => { stop(); setHour(+e.target.value); };

/* cidades e busca */
function goTo(city, btn) {
  document.querySelectorAll("#cities button").forEach(x => x.setAttribute("aria-pressed", x === btn));
  $("context").textContent = city.ctx || "";
  map.flyTo({ center: city.c, zoom: city.z || 12.5, pitch: S.is3D ? 62 : 0, bearing: S.is3D ? -18 : 0, duration: 2600, essential: true });
}
CITIES.forEach((c, i) => { const b = document.createElement("button"); b.type = "button"; b.textContent = c.n; b.setAttribute("aria-pressed", i === 0); b.onclick = () => goTo(c, b); $("cities").appendChild(b); });
$("context").textContent = CITIES[0].ctx;
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
          b.onclick = () => { ul.hidden = true; $("q").value = ""; goTo({ c: f.geometry.coordinates, z: 12.5, ctx: pr.name + (where ? ", " + where : "") }, null); };
          li.appendChild(b); ul.appendChild(li);
        });
        ul.hidden = !ul.children.length;
      }).catch(() => {});
  }, 400);
});

/* abas */
const TABS = ["cen", "sen", "pla", "met"];
TABS.forEach(k => ($("t-" + k).onclick = () => TABS.forEach(o => { $("t-" + o).setAttribute("aria-selected", o === k); $("p-" + o).hidden = o !== k; })));

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
if (import.meta.env.DEV) window.vespera = { map, S, get grid() { return grid; }, sample };
