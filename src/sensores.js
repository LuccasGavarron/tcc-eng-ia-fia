// Rede de sensores simulada de Sorocaba. Cada conector imita o protocolo e a cadência
// de uma fonte real; as leituras saem do mesmo modelo físico do mapa, com ruído,
// falhas de comunicação e defeitos de propósito, para exercitar o controle de qualidade.
import { H, SOIL, dbz, rng } from "./model.js";

export const CONNECTORS = [
  { id: "cemaden", n: "Pluviômetros automáticos", org: "Cemaden", proto: "API REST, JSON", cad: "10 min", unit: "mm/h" },
  { id: "lora", n: "Umidade do solo nas encostas", org: "Rede própria", proto: "LoRaWAN para MQTT", cad: "15 min", unit: "%" },
  { id: "ana", n: "Réguas telemétricas", org: "ANA e DAEE", proto: "HidroWeb Telemetria, XML", cad: "15 min", unit: "m" },
  { id: "inmet", n: "Estação meteorológica automática", org: "INMET", proto: "API REST, JSON", cad: "1 h", unit: "°C" },
  { id: "radar", n: "Radar meteorológico banda S", org: "IPMet/Unesp", proto: "HDF5 via FTP", cad: "7,5 min", unit: "dBZ" },
  { id: "transito", n: "Laços indutivos de trânsito", org: "Prefeitura", proto: "MQTT", cad: "1 min", unit: "km/h" },
];

// fault: defeito simulado. rain: fator espacial da chuva. Réguas: cota de alerta e de transbordamento.
export const STATIONS = [
  { id: "P1", c: "cemaden", n: "Centro", ll: [-47.4580, -23.5015], rain: 1.0 },
  { id: "P2", c: "cemaden", n: "Zona Norte", ll: [-47.4630, -23.4500], rain: 1.12 },
  { id: "P3", c: "cemaden", n: "Zona Leste", ll: [-47.4100, -23.4950], rain: 0.9 },
  { id: "P4", c: "cemaden", n: "Zona Oeste", ll: [-47.5000, -23.4900], rain: 1.05, fault: "entupido" },
  { id: "U1", c: "lora", n: "Encosta Zona Norte", ll: [-47.4700, -23.4420], soil: 1.04 },
  { id: "U2", c: "lora", n: "Encosta Zona Leste", ll: [-47.4020, -23.4880], soil: 0.97 },
  { id: "U3", c: "lora", n: "Encosta Zona Oeste", ll: [-47.5120, -23.4780], soil: 1.0, fault: "sem sinal" },
  { id: "U4", c: "lora", n: "Encosta Zona Sul", ll: [-47.4450, -23.5350], soil: 1.06, fault: "bateria" },
  { id: "R1", c: "ana", n: "Rio Sorocaba, Centro", ll: [-47.45162, -23.49877], base: 1.4, gain: 1, lag: 0, alert: 3.8, over: 5.5 },
  { id: "R2", c: "ana", n: "Rio Sorocaba, montante", ll: [-47.44851, -23.53133], base: 1.2, gain: 0.85, lag: -2, alert: 3.4, over: 5 },
  { id: "R3", c: "ana", n: "Rio Pirajibu", ll: [-47.43791, -23.41755], base: 0.8, gain: 0.7, lag: -3, alert: 2.6, over: 3.6 },
  { id: "R4", c: "ana", n: "Córrego Itanguá", ll: [-47.49521, -23.48976], base: 0.4, gain: 0.55, lag: -6, alert: 1.8, over: 2.5 },
  { id: "M1", c: "inmet", n: "Sorocaba (A713)", ll: [-47.4339, -23.4261] },
  { id: "D1", c: "radar", n: "Célula sobre o Centro", ll: [-47.4560, -23.4990], rain: 1.0 },
  { id: "T1", c: "transito", n: "Av. Dom Aguirre, marginal", ll: [-47.4535, -23.4960], free: 60, river: "R1" },
  { id: "T2", c: "transito", n: "Marginal do Pirajibu", ll: [-47.4395, -23.4190], free: 50, river: "R3" },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const at = (arr, t) => arr[clamp(t, 0, arr.length - 1)];

// Controle de qualidade automático: faixa física, salto, valor travado, coerência com vizinhos.
function qc(st, v, t, out, neighborsRain) {
  if (v == null) return "sem comunicação";
  const prev = t > 0 ? out.v[t - 1] : null;
  // valor travado: 6 h zerado enquanto os vizinhos somam chuva
  if (st.c === "cemaden" && v === 0 && t >= 5 && out.v.slice(t - 5, t).every(x => x === 0) && neighborsRain > 5) return "zero com chuva nos vizinhos";
  if (st.c === "lora" && (v < 5 || v > 60)) return "fora da faixa física";
  if (st.c === "ana" && prev != null && Math.abs(v - prev) > 1.2) return "salto improvável";
  return "";
}

/* Gera as séries das 72 h a partir do estado do modelo.
   p.mode, p.hours (mm/h), p.sim (theta, stage, pluvial), p.dry (T, RH). */
export function simulateSensors(p) {
  const r = rng(11), noise = s => (r() - 0.5) * 2 * s, res = {};
  const rainAt = t => (p.mode === "chuva" ? p.hours[t] : 0);
  for (const st of STATIONS) {
    const out = { v: [], flag: [], battery: st.fault === "bateria" ? 18 : 70 + ((r() * 25) | 0), rssi: -70 - ((r() * 45) | 0) };
    for (let t = 0; t < H; t++) {
      let v;
      if (st.c === "cemaden") v = st.fault === "entupido" && t >= 18 ? 0 : Math.max(0, rainAt(t) * st.rain * (1 + noise(0.15)));
      else if (st.c === "radar") v = dbz(rainAt(t) * st.rain * (1 + noise(0.2)));
      else if (st.c === "lora") {
        const th = p.mode === "chuva" ? p.sim.theta[t] : SOIL.wp + 0.02 + 0.04 * Math.exp(-p.dryDays / 10);
        v = (st.fault === "sem sinal" && t >= 30 && t < 38) ? null : clamp(th * st.soil * 100 + noise(0.6), 0, 100);
      } else if (st.c === "ana") {
        const s = p.mode === "chuva" ? at(p.sim.stage, t + st.lag) : 0;
        v = st.base * (p.mode === "chuva" ? 1 : 0.7) + st.gain * s + noise(0.03);
        if (st.id === "R1" && t === 47) v += 2.1; // pico espúrio de 1 leitura: interferência no sensor de radar
      } else if (st.c === "inmet") {
        v = p.mode === "chuva" ? 21 - Math.min(5, rainAt(t) * 0.2) + 3 * Math.sin(((t % 24) - 9) / 24 * 2 * Math.PI) + noise(0.3) : p.dry.T[t] + noise(0.3);
        out.rh = out.rh || []; out.rh.push(p.mode === "chuva" ? clamp(88 + rainAt(t), 0, 100) : p.dry.RH[t]);
      } else if (st.c === "transito") {
        const rush = (t % 24 === 7 || t % 24 === 8 || t % 24 === 18) ? 0.55 : 1;
        const rv = STATIONS.find(s => s.id === st.river), lvl = res[rv.id].v[t] ?? rv.base;
        const block = clamp((lvl - rv.alert) / (rv.over - rv.alert), 0, 1);
        v = Math.max(0, st.free * rush * (1 - block) * (1 + noise(0.08)));
      }
      if (v != null) v = Math.round(v * 10) / 10;
      out.v.push(v);
      let neigh = 0;
      if (st.c === "cemaden") for (let k = Math.max(0, t - 5); k <= t; k++) neigh += rainAt(k) * 0.9;
      out.flag.push(qc(st, v, t, out, neigh));
    }
    res[st.id] = out;
  }
  return res;
}

// Leitura válida (passa no controle de qualidade) mais recente até a hora t.
export function lastValid(series, t) {
  for (let k = t; k >= 0; k--) if (!series.flag[k]) return { v: series.v[k], age: t - k };
  return null;
}

// Primeira hora em que uma régua cruza a cota de alerta ou de transbordamento.
export function gaugeCross(series, st, key) {
  const i = series.v.findIndex((v, k) => v != null && !series.flag[k] && v >= st[key]);
  return i < 0 ? null : i;
}
