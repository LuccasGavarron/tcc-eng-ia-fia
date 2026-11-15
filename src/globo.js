// Motor 3D: CesiumJS. Com token do Cesium ion, a cidade é a malha fotorrealista do Google (3D Tiles);
// sem token, cai para satélite Esri sobre o globo liso. O resto do app só fala com esta interface.
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { icon as icon0, SENSOR_ICON, RISK_ICON } from "./icones.js";
const icon = (g, c, bad) => icon0(g, c, bad, 30); // selos dos pontos, com haste

window.CESIUM_BASE_URL = "/cesium/";
// o Google serve por HTTP/2: 18 pedidos simultâneos (padrão) deixava a malha chegando aos poucos
Cesium.RequestScheduler.maximumRequestsPerServer = 48;
const C = Cesium.Color.fromCssColorString;
const rad = Cesium.Math.toRadians;
// desaceleração estilo Apple: sai rápido e chega quase parando
const EASE = Cesium.EasingFunction.EXPONENTIAL_OUT;
const RISK = { f: ["#2F7BFF", 0.5], a: ["#F0B43C", 0.3], s: ["#E0503F", 0.32], x: ["#E0612B", 0.5], h: ["#C04A9A", 0.42] };

export async function createGlobe(container, { token, limite, origin = [-47.437, -23.47], alt = [530, 730], base = 515, onMoveEnd, popup }) {
  if (token) Cesium.Ion.defaultAccessToken = token;
  const v = new Cesium.Viewer(container, {
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    baseLayer: token ? false : Cesium.ImageryLayer.fromProviderAsync(Cesium.ArcGisMapServerImageryProvider.fromUrl(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer")),
    requestRenderMode: true, maximumRenderTimeChange: Infinity, msaaSamples: 1, // FXAA já suaviza; MSAA dobrava o custo por pixel
  });
  const sc = v.scene;
  // com requestRenderMode o canvas só acompanha o tamanho da janela se alguém pedir um quadro novo
  new ResizeObserver(() => { v.resize(); sc.requestRender(); }).observe(container);
  // a cidade solta no espaço
  sc.backgroundColor = C("#05080C"); sc.skyBox.show = false; sc.sun.show = false; sc.moon.show = false;
  sc.skyAtmosphere.show = false; sc.fog.enabled = false; sc.globe.showGroundAtmosphere = false; sc.globe.baseColor = Cesium.Color.BLACK;
  sc.globe.depthTestAgainstTerrain = true;
  // luz fixa de meio-dia em Sorocaba: o relógio real deixaria os prédios no escuro à noite
  v.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-01-15T15:00:00Z"); v.clock.shouldAnimate = false;

  const ring = limite.coordinates[0];
  let clipOn = true;
  const inside = (x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  // recorte com o contorno simplificado (Douglas-Peucker, ~60 m): cada vértice custa no shader de todo pixel
  const simp = (pts, eps) => {
    if (pts.length < 3) return pts;
    let dmax = 0, k = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-12;
      const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
      if (d > dmax) { dmax = d; k = i; }
    }
    return dmax > eps ? simp(pts.slice(0, k + 1), eps).slice(0, -1).concat(simp(pts.slice(k), eps)) : [a, b];
  };
  // anel fechado (primeiro = último): simplifica cada metade, senão a reta de referência tem comprimento zero
  const half = Math.floor(ring.length / 2);
  const clipRing = simp(ring.slice(0, half + 1), 0.0006).slice(0, -1).concat(simp(ring.slice(half), 0.0006)).slice(0, -1);
  const clip = () => new Cesium.ClippingPolygonCollection({ inverse: true,
    polygons: [new Cesium.ClippingPolygon({ positions: Cesium.Cartesian3.fromDegreesArray(clipRing.flat()) })] });
  let tiles = null;
  if (token) {
    try {
      tiles = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: 20,
        // colisão da câmera lia a malha de volta da GPU a cada quadro: travadas de 1,5 a 3,7 s
        enableCollision: false,
        // pede blocos também durante o zoom e sem priorizar o centro: a borda da tela não fica borrada esperando
        cullRequestsWhileMoving: false, foveatedScreenSpaceError: false, progressiveResolutionHeightFraction: 0, cacheBytes: 1536 * 1024 * 1024, maximumCacheOverflowBytes: 1024 * 1024 * 1024 });
      tiles.clippingPolygons = clip();
      sc.primitives.add(tiles);
      sc.globe.show = false;
    } catch (e) { console.warn("3D Tiles indisponíveis", e); }
  }
  if (!tiles) sc.globe.clippingPolygons = clip();
  // Sorocaba não tem malha fotogramétrica do Google: os prédios 3D vêm do OpenStreetMap (Cesium OSM Buildings)
  const FOTO = new Cesium.Cesium3DTileStyle({ color: "color('#E4E6E3', 1.0)" });
  const CIEN = new Cesium.Cesium3DTileStyle({ color: { conditions: [
    ["${feature['cesium#estimatedHeight']} >= 40", "color('#F2D35B')"], ["${feature['cesium#estimatedHeight']} >= 20", "color('#7FC9B8')"],
    ["${feature['cesium#estimatedHeight']} >= 9", "color('#3E8FB0')"], ["true", "color('#2A5878')"]] } });
  let osm = null, predOn = false;
  const cam = v.camera;
  if (token) {
    try {
      osm = await Cesium.createOsmBuildingsAsync({ style: FOTO, maximumScreenSpaceError: 28 }); osm.clippingPolygons = clip(); osm.show = false; sc.primitives.add(osm);
      // ponytail: prédios só abaixo de 9 km de altura da câmera; na vista da cidade inteira eles somem e não pesam
      cam.changed.addEventListener(() => { osm.show = predOn && cam.positionCartographic.height < 9000; });
      cam.percentageChanged = 0.1;
    }
    catch (e) { console.warn("OSM Buildings indisponível", e); }
  }

  // borda da cidade com brilho
  const borda = v.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()), width: 3, clampToGround: true,
    material: C("#CFE9FA") } });

  // plano cartesiano escuro sob a cidade: malha de 1 km, linhas fortes a cada 5 km, eixos x e y pelo centro
  const plano = new Cesium.CustomDataSource("plano"); v.dataSources.add(plano);
  {
    const [lon0, lat0] = origin, H0 = base, N = 35, km = 1000;
    const kx = 1 / (111320 * Math.cos(rad(lat0))), ky = 1 / 110540;
    const P = (x, y) => Cesium.Cartesian3.fromDegrees(lon0 + x * km * kx, lat0 + y * km * ky, H0);
    const line = (a, b, width, color) => plano.entities.add({ polyline: { positions: [a, b], width, material: color, arcType: Cesium.ArcType.NONE } });
    for (let i = -N; i <= N; i++) {
      if (!i) continue;
      const col = i % 5 ? C("#6FA8C8").withAlpha(0.14) : C("#6FA8C8").withAlpha(0.32), w = i % 5 ? 1 : 1.6;
      line(P(i, -N), P(i, N), w, col); line(P(-N, i), P(N, i), w, col);
    }
    const axis = C("#9FD6F7");
    line(P(-N - 3, 0), P(N + 3, 0), 2.4, axis); line(P(0, -N - 3), P(0, N + 3), 2.4, axis);
    const arrow = (a, b) => plano.entities.add({ polyline: { positions: [a, b], width: 14, arcType: Cesium.ArcType.NONE,
      material: new Cesium.PolylineArrowMaterialProperty(axis) } });
    arrow(P(N + 1, 0), P(N + 4, 0)); arrow(P(0, N + 1), P(0, N + 4));
    const txt = (x, y, t, size = 12) => plano.entities.add({ position: P(x, y), label: { text: t, font: "600 " + size + "px Archivo, sans-serif",
      fillColor: C("#9FD6F7").withAlpha(0.85), pixelOffset: new Cesium.Cartesian2(6, 6), verticalOrigin: Cesium.VerticalOrigin.TOP } });
    txt(N + 4.5, 0, "x", 18); txt(0, N + 4.5, "y", 18); txt(0, 0, "0");
    for (let i = -30; i <= 30; i += 10) if (i) { txt(i, 0, i + " km", 11); txt(0, i, i + " km", 11); }
  }

  // camadas dinâmicas
  const layers = {};
  const layer = id => { if (!layers[id]) { layers[id] = new Cesium.CustomDataSource(id); v.dataSources.add(layers[id]); if (GROUP[id]) group(layers[id], GROUP[id]); } return layers[id]; };
  // pontos muito juntos na tela viram um selo só com o número; clicar nele aproxima a câmera
  const GROUP = { hist: "#C98A12", foco: "#C2473A", shel: "#3F7D55", sens: "#2C6CB0" };
  function group(ds, color) {
    const cl = ds.clustering; cl.enabled = true; cl.pixelRange = 34; cl.minimumClusterSize = ds.name === "foco" ? 6 : 3; // no destaque cada ponto tem 3 billboards (haste, selo, onda): 6 = dois pontos cl.clusterLabels = false; cl.clusterPoints = false;
    cl.clusterEvent.addEventListener((list, c) => {
      const col = ds._groupColor || color, n = list.filter(e => e._head).length;
      c.label.show = false; c.billboard.show = true; c.billboard.id = { _cluster: list };
      c.billboard.image = count(n, col); c.billboard.width = c.billboard.height = n > 9 ? 50 : 44;
      c.billboard.color = dimOn && ds !== layers.foco ? DIM : Cesium.Color.WHITE;
      c.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER; c.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
    });
  }
  const countCache = {};
  const count = (n, col) => countCache[n + col] || (countCache[n + col] = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${col}" fill-opacity=".35"/>
    <circle cx="32" cy="32" r="23" fill="${col}" stroke="#fff" stroke-width="3"/><text x="32" y="39.5" text-anchor="middle" font-family="Archivo, sans-serif" font-weight="700" font-size="21" fill="#fff">${n}</text></svg>`));
  // ponytail: altura vem do relevo (Terrarium) + folga; prender ao 3D Tiles (CLAMP_TO_GROUND) refaz consulta a cada quadro e derrubava o FPS
  let elevAt = () => null;
  const pt = (ll, up = 25) => { const e = elevAt(ll[0], ll[1]); return Cesium.Cartesian3.fromDegrees(ll[0], ll[1], (e ?? 0) + up); };
  const ground = { disableDepthTestDistance: Number.POSITIVE_INFINITY };
  const shrink = { scaleByDistance: new Cesium.NearFarScalar(3000, 1, 40000, 0.5) };
  const label = (text, size, offY) => ({ text, font: "600 " + size + "px Archivo, sans-serif", fillColor: Cesium.Color.WHITE,
    outlineColor: C("#1B2A31"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, offY),
    verticalOrigin: Cesium.VerticalOrigin.TOP, ...ground });

  // marcador 3D: haste branca saindo do chão e selo com ícone no topo, sempre virado para a câmera
  // a haste faz parte da imagem: um só billboard por ponto, que o agrupamento esconde inteiro (haste em polyline piscava)
  const STALK = 30;
  function marker(ds, ll, img, pop, text, size, floor) {
    const e = floor ?? elevAt(ll[0], ll[1]) ?? 0, base = Cesium.Cartesian3.fromDegrees(ll[0], ll[1], e);
    return ds.entities.add({ position: base, _pop: pop, _head: true, _at: { ll, r: 260, top: base },
      billboard: { image: img, width: size, height: size * (64 + STALK) / 64, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1500, 1.1, 40000, 0.4) },
      label: text ? { ...label(text, 12, 4), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500) } : undefined });
  }
  // raio da mancha em metros, para o zoom enquadrar a área inteira
  const extent = (r, cx, cy) => Math.max(200, ...r.map(p => Math.hypot((p[0] - cx) * 111320 * Math.cos(rad(cy)), (p[1] - cy) * 110540)));
  const draw = {
    // faixas empilhadas: cada faixa mais funda soma cor sobre a anterior, o miolo fica mais escuro
    risk(ds, fc) {
      for (const f of fc.features) {
        const k = f.properties.k, [col, a] = RISK[k] || ["#000", 0];
        const big = f.properties.b === 0 ? new Set([...f.geometry.coordinates].sort((p, q) => q[0].length - p[0].length).slice(0, 3)) : new Set();
        f.geometry.coordinates.forEach(poly => {
          const n = poly[0].length, cx = poly[0].reduce((s, p) => s + p[0], 0) / n, cy = poly[0].reduce((s, p) => s + p[1], 0) / n;
          if (clipOn && !inside(cx, cy)) return; // fora do município não há malha 3D
          // ponytail: superfície comum na cota do relevo (+2 m por faixa), não classificação sobre a malha 3D;
          // classificação redesenhava a malha por mancha e derrubava de ~100 para 25 quadros por segundo
          const up = 2 + (f.properties.b || 0) * 1.2, P = r => r.map(p => pt(p, up));
          ds.entities.add({ _pop: () => popup("risk", f.properties), _risk: true, polygon: {
            hierarchy: new Cesium.PolygonHierarchy(P(poly[0]), poly.slice(1).map(h => new Cesium.PolygonHierarchy(P(h)))),
            perPositionHeight: true, material: C(col).withAlpha(a) } });
          // contorno da faixa externa: aparece mesmo quando a superfície fica atrás da malha 3D
          if (!f.properties.b) { const edge = C(col).withAlpha(0.95);
            ds.entities.add({ _pop: () => popup("risk", f.properties), _risk: true, polyline: { positions: P(poly[0].concat([poly[0][0]])), width: 2.5, arcType: Cesium.ArcType.NONE,
              material: edge, depthFailMaterial: edge.withAlpha(0.7) } }); }
          if (big.has(poly) && RISK_ICON[k]) { const [g, c] = RISK_ICON[k]; marker(ds, [cx, cy], icon(g, c), () => popup("risk", f.properties), null, 36)._at.r = extent(poly[0], cx, cy); }
        });
      }
    },
    rios(ds, fc) {
      // ponytail: linha na altura do relevo (+4 m) em vez de presa à malha 3D; polyline no chão é a camada mais cara do Cesium
      const col = C("#7FC4F0").withAlpha(0.9);
      for (const f of fc.features) if (f.properties.w !== "s" || f.properties.n) {
        // só os trechos dentro do município; fora dele a linha ficaria solta no preto
        const runs = [[]];
        for (const p of f.geometry.coordinates) { if (!clipOn || inside(p[0], p[1])) runs[runs.length - 1].push(p); else if (runs[runs.length - 1].length) runs.push([]); }
        for (const r of runs) if (r.length > 1) ds.entities.add({ polyline: { positions: r.map(p => pt(p, 4)), arcType: Cesium.ArcType.NONE,
          width: f.properties.w === "r" ? 3.5 : f.properties.w === "c" ? 2 : 1.4, material: col, depthFailMaterial: col.withAlpha(0.45) } });
      }
    },
    hist(ds, fc) {
      // no replay de um evento, os pontos que alagaram naquela data ficam vermelhos, maiores e com nome
      for (const f of fc.features) marker(ds, f.geometry.coordinates, icon("alerta", f.properties.hit ? "#C2473A" : "#C98A12", f.properties.hit), () => popup("hist", f.properties),
        f.properties.hit ? f.properties.nome : null, f.properties.hit ? 40 : 28);
    },
    sens(ds, fc) {
      ds._byId = {}; ds._ids = fc.features.map(f => f.properties.id).join();
      for (const f of fc.features) {
        const [g, c] = SENSOR_ICON[f.properties.c] || ["radar", "#4E6068"];
        const e = marker(ds, f.geometry.coordinates, icon(g, c, f.properties.bad), () => popup("sens", e._props), f.properties.id, 34);
        e._props = f.properties; ds._byId[f.properties.id] = e;
      }
    },
    shel(ds, fc) {
      for (const f of fc.features) marker(ds, f.geometry.coordinates, icon("casa", "#3F7D55"), () => popup("shel", f.properties), f.properties.name, 40);
    },
    busca(ds, fc) {
      for (const f of fc.features) marker(ds, f.geometry.coordinates, icon("pino", "#E3E9EE"), () => "<b>" + f.properties.name + "</b><br><small>" + f.properties.kind + "</small>", f.properties.name, 42);
    },
    // nível 0: um nome a cada 2,6 km; nível 1: a cada 900 m; nível 2: o resto, só bem de perto
    bairros(ds, list) {
      const far = [14000, 4500, 1800], size = [13, 12, 11];
      for (const [n, lon, lat, t] of list) ds.entities.add({ position: pt([lon, lat]),
        label: { ...label(n.toUpperCase(), size[t], 0), verticalOrigin: Cesium.VerticalOrigin.CENTER,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, far[t]),
          translucencyByDistance: new Cesium.NearFarScalar(far[t] * 0.6, 1, far[t], 0) } });
    },
  };
  const SIG = {};
  function setData(id, data) {
    const ds = layer(id), sig = data ? JSON.stringify(data) : "";
    if (SIG[id] === sig) return; // nada mudou: não reconstrói
    SIG[id] = sig;
    // sensores: mesmos pontos de antes, só troca ícone e texto (recriar 34 entidades por hora travava o play)
    if (id === "sens" && data && ds._ids === data.features.map(f => f.properties.id).join()) {
      DRAWN[id] = data;
      for (const f of data.features) { const e = ds._byId[f.properties.id]; if (!e) continue;
        // só troca o ícone quando a leitura passa a ser reprovada ou volta; texto fixo (redesenhar rótulo a cada hora custava ~250 ms por quadro)
        if (e._props.bad !== f.properties.bad) { const [g, c] = SENSOR_ICON[f.properties.c] || ["radar", "#4E6068"]; e.billboard.image = icon(g, c, f.properties.bad); }
        e._props = f.properties; }
      sc.requestRender(); return;
    }
    DRAWN[id] = data;
    ds.entities.suspendEvents(); ds.entities.removeAll();
    if (data) draw[id](ds, data);
    if (dimOn && id !== "foco") dimDs(ds);
    ds.entities.resumeEvents(); sc.requestRender();
  }
  const DRAWN = {};
  const setElevation = fn => { elevAt = fn; for (const id of ["hist", "sens", "shel", "bairros", "risk", "rios"]) if (DRAWN[id]) { SIG[id] = null; layer(id)._ids = null; setData(id, DRAWN[id]); } };
  const show = (id, on) => { if (id === "predios") { predOn = on; if (osm) osm.show = on && cam.positionCartographic.height < 9000; } else layer(id).show = on; sc.requestRender(); };

  // popup próprio, preso ao ponto clicado
  const pop = document.createElement("div"); pop.className = "pop"; pop.hidden = true; container.appendChild(pop);
  const close = () => (pop.hidden = true);
  const h = new Cesium.ScreenSpaceEventHandler(sc.canvas);
  h.setInputAction(e => {
    const p = sc.pick(e.position), ent = p && p.id;
    if (ent && ent._cluster) { stopOrbit(); const ps = ent._cluster.map(e => e.position.getValue(Cesium.JulianDate.now())).filter(Boolean);
      const sph = Cesium.BoundingSphere.fromPoints(ps);
      return cam.flyToBoundingSphere(sph, { duration: 2.4, easingFunction: EASE, offset: new Cesium.HeadingPitchRange(cam.heading, rad(-45), Math.max(900, sph.radius * 2.8)) }); }
    if (!ent || !ent._pop) return close();
    if (ent._at) return goTo(ent);
    pop.innerHTML = '<button type="button" aria-label="Fechar">×</button>' + ent._pop();
    pop.firstChild.onclick = close;
    pop.style.left = e.position.x + "px"; pop.style.top = e.position.y + "px"; pop.hidden = false;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  // clicar num ponto: voo suave até ele, enquadrando a área; o popup abre quando a câmera chega
  function goTo(ent) {
    stopOrbit();
    const { ll, r, top } = ent._at;
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(ll[0], ll[1], (elevAt(ll[0], ll[1]) ?? 0) + 20), r), {
      duration: 2.6, easingFunction: EASE,
      offset: new Cesium.HeadingPitchRange(cam.heading, rad(-38), r * 2.6),
      complete: () => { const xy = sc.cartesianToCanvasCoordinates(top); if (!xy) return;
        pop.innerHTML = '<button type="button" aria-label="Fechar">×</button>' + ent._pop(); pop.firstChild.onclick = close;
        pop.style.left = xy.x + "px"; pop.style.top = xy.y + "px"; pop.hidden = false; } });
  }
  // destaque: pontos de um tipo crescem e pulsam, a câmera voa até eles e gira devagar em volta
  const foco = layer("foco"), wave = icon0("anel");
  let orbit = null, pulse = false;
  function stopOrbit() { if (!orbit) return; sc.preUpdate.removeEventListener(orbit); orbit = null; cam.lookAtTransform(Cesium.Matrix4.IDENTITY); }
  sc.canvas.addEventListener("pointerdown", stopOrbit); sc.canvas.addEventListener("wheel", stopOrbit, { passive: true });
  // com destaque ligado, os outros pontos ficam apagados
  let dimOn = false;
  const DIM = Cesium.Color.WHITE.withAlpha(0.28);
  const dimDs = ds => { for (const e of ds.entities.values) { if (e.billboard) e.billboard.color = dimOn ? DIM : Cesium.Color.WHITE; } };
  function dim(on) { if (dimOn === on) return; dimOn = on; for (const id of ["hist", "sens", "shel", "risk", "busca"]) if (layers[id]) dimDs(layers[id]); }
  function spotlight(items, glyph, color, fly = true) {
    foco.entities.removeAll();
    if (!items || !items.length) { stopOrbit(); pulse = false; dim(false); sc.requestRenderMode = true; sc.requestRender(); return; }
    const t0 = performance.now(), pts = []; foco._groupColor = color;
    const sbd = new Cesium.NearFarScalar(1500, 1.1, 40000, 0.45);
    const bb = { verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: sbd, pixelOffsetScaleByDistance: sbd };
    items.forEach((it, i) => {
      // o ponto sobe do chão bem acima dos outros: sai rápido e para devagar
      const g = elevAt(it.ll[0], it.ll[1]) ?? 0, ph = i * 0.7, s = () => ((performance.now() - t0) / 1600 + ph) % 1;
      const rise = () => { const k = Math.min(1, (performance.now() - t0 - i * 40) / 1100); return 24 + 96 * (k <= 0 ? 0 : 1 - Math.pow(2, -10 * k)); };
      const base = Cesium.Cartesian3.fromDegrees(it.ll[0], it.ll[1], g), at = { ll: it.ll, r: it.r || 260, top: base };
      const up = new Cesium.CallbackProperty(() => new Cesium.Cartesian2(0, -rise()), false);
      foco.entities.add({ position: base, _pop: it.pop, _at: at, billboard: { ...bb, image: icon0("haste", color), width: 3, height: new Cesium.CallbackProperty(rise, false) } });
      foco.entities.add({ position: base, _pop: it.pop, _at: at, _head: true, billboard: { ...bb, image: icon0(glyph, color, true), width: 56, height: 56, pixelOffset: up,
        scale: new Cesium.CallbackProperty(() => 1 + 0.06 * Math.sin(s() * 6.283), false) } });
      // onda de radar saindo do ponto
      foco.entities.add({ position: base, billboard: { ...bb, image: wave, width: 56, height: 56, pixelOffset: up,
        scale: new Cesium.CallbackProperty(() => 1 + s() * 1.4, false), color: new Cesium.CallbackProperty(() => C(color).withAlpha(1 - s()), false) } });
      pts.push(base);
    });
    dim(true);
    pulse = true; sc.requestRenderMode = false; // a pulsação precisa de quadro contínuo
    if (!fly) return;
    stopOrbit();
    const sph = Cesium.BoundingSphere.fromPoints(pts), range = Math.max(1600, sph.radius * 2.6), pitch = rad(-40);
    let hd = cam.heading;
    cam.flyToBoundingSphere(sph, { duration: 3, easingFunction: EASE,
      offset: new Cesium.HeadingPitchRange(hd, pitch, range),
      // depois do voo, um giro de 70° que começa rápido e para devagar
      complete: () => { const h0 = hd, t1 = performance.now();
        orbit = () => { const k = Math.min(1, (performance.now() - t1) / 4200);
          cam.lookAt(sph.center, new Cesium.HeadingPitchRange(h0 + rad(70) * (1 - Math.pow(2, -10 * k)), pitch, range)); if (k >= 1) stopOrbit(); };
        sc.preUpdate.addEventListener(orbit); } });
  }
  // passar o mouse sobre uma área de perigo mostra o que é e o dado da hora
  const tip = document.createElement("div"); tip.className = "pop tip"; tip.hidden = true; container.appendChild(tip);
  // ponytail: scene.pick redesenha a cena num buffer de seleção; só roda com o mouse parado 120 ms e sem arrasto
  let hoverT = null, hoverEnt = null;
  h.setInputAction(e => {
    if (drag) { clearTimeout(hoverT); tip.hidden = true; hoverEnt = null; return; }
    const pos = Cesium.Cartesian2.clone(e.endPosition);
    // a dica acompanha o mouse na hora; a seleção (cara) roda 40 ms depois do último movimento
    if (!tip.hidden) { tip.style.left = pos.x + "px"; tip.style.top = pos.y + "px"; }
    clearTimeout(hoverT);
    hoverT = setTimeout(() => {
      const p = sc.pick(pos), ent = p && p.id;
      sc.canvas.style.cursor = ent && ent._pop ? "pointer" : "";
      if (ent && ent._risk && pop.hidden) {
        if (ent !== hoverEnt) tip.innerHTML = ent._pop();
        tip.style.left = pos.x + "px"; tip.style.top = pos.y + "px"; tip.hidden = false;
      } else tip.hidden = true;
      hoverEnt = ent || null;
    }, 40);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  v.camera.moveStart.addEventListener(close);
  v.camera.moveEnd.addEventListener(() => onMoveEnd && onMoveEnd());

  // câmera
  const ctrl = sc.screenSpaceCameraController;
  ctrl.zoomFactor = 14; // padrão 5 é lento no trackpad
  // piso da câmera pelo relevo (Terrarium), no lugar da colisão com a malha 3D, que travava
  sc.preUpdate.addEventListener(() => {
    const c = cam.positionCartographic, g = elevAt(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)) ?? alt[1];
    if (c.height < g + 80) cam.position = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, g + 80);
  });
  ctrl.inertiaZoom = 0.9; ctrl.inertiaTranslate = 0.9; // o zoom continua deslizando e para devagar
  // navegação: esquerdo arrasta o mapa, direito gira a visão em primeira pessoa, roda dá zoom, Ctrl+esquerdo ou meio inclina
  const E = Cesium.CameraEventType;
  ctrl.rotateEventTypes = []; ctrl.lookEventTypes = []; ctrl.translateEventTypes = [];
  ctrl.zoomEventTypes = [E.WHEEL, E.PINCH];
  ctrl.tiltEventTypes = [E.MIDDLE_DRAG, E.PINCH, { eventType: E.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL }];
  sc.canvas.addEventListener("contextmenu", e => e.preventDefault());
  let drag = null; // { mode, plane, p0, x, y }
  const groundAt = pos => {
    let p = sc.pickPositionSupported ? sc.pickPosition(pos) : null;
    if (!p) p = cam.pickEllipsoid(pos);
    return p;
  };
  const nav = new Cesium.ScreenSpaceEventHandler(sc.canvas);
  nav.setInputAction(e => {
    const p0 = groundAt(e.position);
    if (!p0) return;
    drag = { mode: "pan", p0, plane: Cesium.Plane.fromPointNormal(p0, Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p0, new Cesium.Cartesian3())) };
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  nav.setInputAction(e => { drag = { mode: "look", x: e.position.x, y: e.position.y }; }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
  const end = () => (drag = null);
  nav.setInputAction(end, Cesium.ScreenSpaceEventType.LEFT_UP);
  nav.setInputAction(end, Cesium.ScreenSpaceEventType.RIGHT_UP);
  nav.setInputAction(e => {
    if (!drag) return;
    if (drag.mode === "pan") {
      // o ponto agarrado fica sob o cursor: desloca a câmera no plano do chão
      const hit = Cesium.IntersectionTests.rayPlane(cam.getPickRay(e.endPosition), drag.plane);
      if (!hit) return;
      cam.position = Cesium.Cartesian3.add(cam.position, Cesium.Cartesian3.subtract(drag.p0, hit, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    } else {
      const dx = e.endPosition.x - drag.x, dy = e.endPosition.y - drag.y, k = 0.0035;
      drag.x = e.endPosition.x; drag.y = e.endPosition.y;
      // invertido: arrastar move a cena junto com o mouse
      cam.look(Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(cam.positionWC, new Cesium.Cartesian3()), -dx * k); // gira em torno da vertical
      if (is3D) cam.lookUp(dy * k); // vertical: arrastar para cima olha para baixo (preferência do usuário)
    }
    sc.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  nav.setInputAction(e => {}, Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.KeyboardEventModifier.CTRL); // Ctrl+esquerdo fica com a inclinação
  let is3D = true;
  function flyTo(lon, lat, radius, duration = 2.6) {
    const sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 600), radius);
    cam.flyToBoundingSphere(sphere, { duration, easingFunction: EASE, offset: new Cesium.HeadingPitchRange(is3D ? rad(-18) : 0, is3D ? rad(-48) : rad(-90), radius * (is3D ? 2.3 : 2.6)) });
  }
  function setView(three) {
    is3D = three; ctrl.enableTilt = three; ctrl.enableLook = three;
    const c = center();
    if (c) flyTo(c.lon, c.lat, c.dist / 2.4, 1.2);
  }
  // centro da tela no chão e distância da câmera até ele
  function center() {
    const px = new Cesium.Cartesian2(sc.canvas.clientWidth / 2, sc.canvas.clientHeight / 2);
    let p = sc.pickPositionSupported ? sc.pickPosition(px) : null;
    if (!p) p = cam.pickEllipsoid(px);
    if (!p) return null;
    const g = Cesium.Cartographic.fromCartesian(p);
    return { lon: Cesium.Math.toDegrees(g.longitude), lat: Cesium.Math.toDegrees(g.latitude), dist: Cesium.Cartesian3.distance(cam.positionWC, p) };
  }
  // modo científico: cidade em cinza com rampa hipsométrica (cor pela altitude)
  const P0 = Cesium.Cartesian3.fromDegrees(origin[0], origin[1], 0), up0 = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(P0, new Cesium.Cartesian3());
  const RN = 6381000; // raio de curvatura local; o erro fica abaixo de 1 m em 20 km
  const sci = new Cesium.CustomShader({ lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: { u_c: { type: Cesium.UniformType.VEC3, value: Cesium.Cartesian3.subtract(P0, Cesium.Cartesian3.multiplyByScalar(up0, RN, new Cesium.Cartesian3()), new Cesium.Cartesian3()) },
      u_rn: { type: Cesium.UniformType.FLOAT, value: RN } },
    fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float h = length(fsInput.attributes.positionWC - u_c) - u_rn;
      float t = clamp((h - ${alt[0].toFixed(1)}) / ${(alt[1] - alt[0]).toFixed(1)}, 0.0, 1.0);
      vec3 ramp = mix(mix(vec3(0.06, 0.16, 0.40), vec3(0.09, 0.58, 0.60), smoothstep(0.0, 0.5, t)), vec3(0.97, 0.84, 0.33), smoothstep(0.5, 1.0, t));
      float g = dot(material.diffuse, vec3(0.299, 0.587, 0.114));
      vec3 col = mix(vec3(g) * 0.55, ramp, 0.5);
      material.diffuse = col;
    }` });
  function setScience(on) {
    if (tiles) tiles.customShader = on ? sci : undefined;
    if (osm) osm.style = on ? CIEN : FOTO;
    sc.requestRender();
  }
  function focusCity(on) {
    borda.show = on; plano.show = on; clipOn = on;
    if (DRAWN.rios) { SIG.rios = null; setData("rios", DRAWN.rios); }
    const c = on ? clip() : undefined;
    if (tiles) tiles.clippingPolygons = c; else sc.globe.clippingPolygons = c;
    if (osm) osm.clippingPolygons = on ? clip() : undefined;
    if (layers.bairros) layers.bairros.show = on;
    sc.requestRender();
  }
  // pré-carregamento: percorre pontos de vista com a cena desenhando sem parar e espera os blocos de cada um
  async function preload(views, onProgress) {
    if (!tiles) return;
    sc.requestRenderMode = false;
    for (let i = 0; i < views.length; i++) {
      const [lon, lat, r, hd, pt] = views[i];
      cam.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 600), r),
        { duration: 0, offset: new Cesium.HeadingPitchRange(rad(hd), rad(pt), r * 2.3) });
      await new Promise(res => {
        const t0 = performance.now();
        const tick = () => (tiles.tilesLoaded && performance.now() - t0 > 400) || performance.now() - t0 > 7000 ? res() : setTimeout(tick, 100);
        setTimeout(tick, 150);
      });
      onProgress && onProgress((i + 1) / views.length);
    }
    sc.requestRenderMode = !pulse;
  }
  return { setData, setElevation, setScience, show, spotlight, preload, flyTo, setView, center, focusCity, viewer: v, photoreal: !!tiles };
}
