// Ícones dos marcadores 3D: selo redondo colorido com desenho branco, em SVG embutido.
const G = {
  chuva: '<path d="M7 13a4 4 0 0 1 .6-8 5 5 0 0 1 9.6 1.6A3.3 3.3 0 0 1 16.8 13z"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  solo: '<path d="M12 21v-8"  stroke="#fff" stroke-width="2" fill="none"/><path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7zM12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/><path d="M5 21h14" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  regua: '<path d="M4 9c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1M4 14c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1M4 19c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 3v4" stroke="#fff" stroke-width="2"/>',
  termo: '<path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><circle cx="12" cy="16.5" r="1.8" fill="currentColor"/>',
  radar: '<circle cx="12" cy="12" r="2"/><path d="M12 12L19 5M5.6 18.4a9 9 0 0 1 0-12.8M8.5 15.5a5 5 0 0 1 0-7M18.4 18.4a9 9 0 0 0 1.5-10.9" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>',
  carro: '<path d="M5 15l1.6-5a2 2 0 0 1 1.9-1.4h7a2 2 0 0 1 1.9 1.4L19 15v4h-2.5v-1.6h-9V19H5z"/><circle cx="8" cy="15" r="1.2" fill="currentColor"/><circle cx="16" cy="15" r="1.2" fill="currentColor"/>',
  alerta: '<path d="M12 3l10 18H2z"/><path d="M12 9v6M12 17.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  casa: '<path d="M3 11l9-7 9 7v10h-6v-6H9v6H3z"/>',
  gota: '<path d="M12 2.5C9 7 6 10.5 6 14a6 6 0 0 0 12 0c0-3.5-3-7-6-11.5z"/>',
  encosta: '<path d="M2 20l7-11 4 5 3-3 6 9z"/><circle cx="17" cy="6" r="2.2"/><circle cx="20.5" cy="10" r="1.4"/>',
  fogo: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.6-4.6 3-6 0 2 1 3 2 3-1-3 0-6 1-9z"/>',
  sol: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
};
const cache = {};
// selo de 64 px: anel branco, fundo na cor, desenho branco; ruim = anel vermelho
export function icon(glyph, color, bad) {
  const k = glyph + color + bad;
  return cache[k] || (cache[k] = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="29" fill="${bad ? "#E5484D" : "#fff"}"/><circle cx="32" cy="32" r="24.5" fill="${color}"/>
      <g transform="translate(17 17) scale(1.25)" fill="#fff" color="${color}">${G[glyph]}</g></svg>`));
}
export const SENSOR_ICON = { cemaden: ["chuva", "#2C6CB0"], lora: ["solo", "#5E8C3A"], ana: ["regua", "#1F7A8C"], inmet: ["termo", "#B5651D"], radar: ["radar", "#6B4FA0"], transito: ["carro", "#4E6068"] };
export const RISK_ICON = { f: ["gota", "#2F80E0"], s: ["encosta", "#AE3A2C"], x: ["fogo", "#E0612B"], h: ["sol", "#B0368A"] };
