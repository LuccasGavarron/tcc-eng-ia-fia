// Relevo para o modelo, independente do motor gráfico: lê os Terrain Tiles (Terrarium, AWS Open Data)
// e devolve uma função de altitude em metros por lon/lat.
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const cache = new Map();

function tile(z, x, y) {
  const k = z + "/" + x + "/" + y;
  if (!cache.has(k)) cache.set(k, new Promise(ok => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      ok(e);
    };
    img.onerror = () => ok(null);
    img.src = URL(z, x, y);
  }));
  return cache.get(k);
}

const tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const ty = (lat, z) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

// Carrega os tiles que cobrem o retângulo e devolve elevAt(lon, lat) síncrono (null fora da área).
export async function loadElevation(west, south, east, north, cellM) {
  const lat = (south + north) / 2, px = cellM / 3;
  const z = Math.max(9, Math.min(14, Math.round(Math.log2((156543 * Math.cos((lat * Math.PI) / 180)) / px))));
  const x0 = Math.floor(tx(west, z)), x1 = Math.floor(tx(east, z)), y0 = Math.floor(ty(north, z)), y1 = Math.floor(ty(south, z));
  const tiles = new Map(), jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(tile(z, x, y).then(e => tiles.set(x + "/" + y, e)));
  await Promise.all(jobs);
  return (lon, la) => {
    const fx = tx(lon, z), fy = ty(la, z), e = tiles.get(Math.floor(fx) + "/" + Math.floor(fy));
    if (!e) return null;
    const u = Math.min(255, Math.floor((fx % 1) * 256)), v = Math.min(255, Math.floor((fy % 1) * 256));
    return e[v * 256 + u];
  };
}
