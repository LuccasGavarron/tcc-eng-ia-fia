// Motor 3D: CesiumJS. Com token do Cesium ion, a cidade é a malha fotorrealista do Google (3D Tiles);
// sem token, cai para satélite Esri sobre o globo liso. O resto do app só fala com esta interface.
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { icon, SENSOR_ICON, RISK_ICON } from "./icones.js";

window.CESIUM_BASE_URL = "/cesium/";
const C = Cesium.Color.fromCssColorString;
const rad = Cesium.Math.toRadians;
const RISK = { f: ["#2F80E0", 0.6], a: ["#C4841C", 0.42], s: ["#AE3A2C", 0.55], x: ["#E0612B", 0.55], h: ["#B0368A", 0.45] };

export async function createGlobe(container, { token, limite, onMoveEnd, popup }) {
  if (token) Cesium.Ion.defaultAccessToken = token;
  const v = new Cesium.Viewer(container, {
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    baseLayer: token ? false : Cesium.ImageryLayer.fromProviderAsync(Cesium.ArcGisMapServerImageryProvider.fromUrl(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer")),
    requestRenderMode: true, maximumRenderTimeChange: Infinity, msaaSamples: 2,
  });
  const sc = v.scene;
  // com requestRenderMode o canvas só acompanha o tamanho da janela se alguém pedir um quadro novo
  new ResizeObserver(() => { v.resize(); sc.requestRender(); }).observe(container);
  // a cidade solta no espaço
  sc.backgroundColor = C("#05080C"); sc.skyBox.show = false; sc.sun.show = false; sc.moon.show = false;
  sc.skyAtmosphere.show = false; sc.fog.enabled = false; sc.globe.showGroundAtmosphere = false; sc.globe.baseColor = Cesium.Color.BLACK;
  sc.globe.depthTestAgainstTerrain = true;

  const ring = limite.coordinates[0];
  let clipOn = true;
  const inside = (x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const clip = () => new Cesium.ClippingPolygonCollection({ inverse: true,
    polygons: [new Cesium.ClippingPolygon({ positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()) })] });
  let tiles = null;
  if (token) {
    try {
      tiles = await Cesium.createGooglePhotorealistic3DTileset({ maximumScreenSpaceError: 24, cacheBytes: 768 * 1024 * 1024 });
      tiles.clippingPolygons = clip();
      sc.primitives.add(tiles);
      sc.globe.show = false;
    } catch (e) { console.warn("3D Tiles indisponíveis", e); }
  }
  if (!tiles) sc.globe.clippingPolygons = clip();

  // borda da cidade com brilho
  const borda = v.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()), width: 3, clampToGround: true,
    material: C("#CFE9FA") } });

  // plano cartesiano escuro sob a cidade: malha de 1 km, linhas fortes a cada 5 km, eixos x e y pelo centro
  const plano = new Cesium.CustomDataSource("plano"); v.dataSources.add(plano);
  {
    const [lon0, lat0] = [-47.437, -23.47], H0 = 515, N = 35, km = 1000;
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
  const layer = id => { if (!layers[id]) { layers[id] = new Cesium.CustomDataSource(id); v.dataSources.add(layers[id]); } return layers[id]; };
  // ponytail: altura vem do relevo (Terrarium) + folga; prender ao 3D Tiles (CLAMP_TO_GROUND) refaz consulta a cada quadro e derrubava o FPS
  let elevAt = () => null;
  const pt = (ll, up = 25) => { const e = elevAt(ll[0], ll[1]); return Cesium.Cartesian3.fromDegrees(ll[0], ll[1], (e ?? 0) + up); };
  const ground = { disableDepthTestDistance: Number.POSITIVE_INFINITY };
  const shrink = { scaleByDistance: new Cesium.NearFarScalar(3000, 1, 40000, 0.5) };
  const label = (text, size, offY) => ({ text, font: "600 " + size + "px Archivo, sans-serif", fillColor: Cesium.Color.WHITE,
    outlineColor: C("#1B2A31"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, offY),
    verticalOrigin: Cesium.VerticalOrigin.TOP, ...ground });

  // marcador 3D: haste branca saindo do chão e selo com ícone no topo, sempre virado para a câmera
  const STALK = 60;
  function marker(ds, ll, img, pop, text, size, floor) {
    const e = floor ?? elevAt(ll[0], ll[1]) ?? 0;
    const base = Cesium.Cartesian3.fromDegrees(ll[0], ll[1], e), top = Cesium.Cartesian3.fromDegrees(ll[0], ll[1], e + STALK);
    ds.entities.add({ _pop: pop, polyline: { positions: [base, top], width: 2, arcType: Cesium.ArcType.NONE, material: Cesium.Color.WHITE.withAlpha(0.8) } });
    ds.entities.add({ position: top, _pop: pop,
      billboard: { image: img, width: size, height: size, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1500, 1.1, 40000, 0.4) },
      label: text ? { ...label(text, 12, 4), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500) } : undefined });
  }
  const draw = {
    risk(ds, fc) {
      for (const f of fc.features) {
        const k = f.properties.k, [col, a] = RISK[k] || ["#000", 0];
        // ícone só nas 3 maiores manchas de cada tipo, para não poluir
        const big = new Set([...f.geometry.coordinates].sort((p, q) => q[0].length - p[0].length).slice(0, 3));
        f.geometry.coordinates.forEach(poly => {
          // fora do município não há malha 3D: a mancha ficaria solta no preto
          if (clipOn) { const n = poly[0].length, cx = poly[0].reduce((a, p) => a + p[0], 0) / n, cy = poly[0].reduce((a, p) => a + p[1], 0) / n; if (!inside(cx, cy)) return; }
          const outer = Cesium.Cartesian3.fromDegreesArray(poly[0].flat());
          const holes = poly.slice(1).map(h => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(h.flat())));
          // pegada exata no chão
          ds.entities.add({ _pop: () => popup("risk", f.properties), _risk: true, polygon: { hierarchy: new Cesium.PolygonHierarchy(outer, holes), material: C(col).withAlpha(a * 0.8), classificationType: Cesium.ClassificationType.BOTH } });
          if (k !== "f" && k !== "s") return;
          if (clipOn && poly[0].some(p => !inside(p[0], p[1]))) return; // volume só para mancha inteira dentro do município
          // volume 3D: enchente vira lâmina d'água até a cota prevista; encosta vira casca vermelha
          const es = poly[0].filter((_, i) => i % 3 === 0).map(p => elevAt(p[0], p[1])).filter(e => e != null);
          if (es.length < 3) return;
          const lo = Math.min(...es), hi = Math.max(...es);
          const top = k === "f" ? lo + Math.max(1.5, f.properties.d || 0) * 2 : hi + 12; // ponytail: lâmina exagerada 2× para aparecer na vista da cidade
          ds.entities.add({ _pop: () => popup("risk", f.properties), _risk: true, polygon: { hierarchy: new Cesium.PolygonHierarchy(outer, holes), height: lo - 3, extrudedHeight: top,
            material: C(col).withAlpha(k === "f" ? 0.38 : 0.22), outline: false } });
          if (big.has(poly)) {
            const n = poly[0].length, cx = poly[0].reduce((s, p) => s + p[0], 0) / n, cy = poly[0].reduce((s, p) => s + p[1], 0) / n;
            const [g, c] = RISK_ICON[k];
            marker(ds, [cx, cy], icon(g, c), () => popup("risk", f.properties), null, 38, top);
          }
        });
      }
    },
    rios(ds, fc) {
      for (const f of fc.features) if (f.properties.w !== "s" || f.properties.n) ds.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(f.geometry.coordinates.flat()),
        width: f.properties.w === "r" ? 4 : f.properties.w === "c" ? 2.2 : 1.5, clampToGround: true, material: C("#7FC4F0").withAlpha(0.9) } });
    },
    hist(ds, fc) {
      for (const f of fc.features) marker(ds, f.geometry.coordinates, icon("alerta", "#C98A12"), () => popup("hist", f.properties), null, 28);
    },
    sens(ds, fc) {
      for (const f of fc.features) {
        const [g, c] = SENSOR_ICON[f.properties.c] || ["radar", "#4E6068"];
        marker(ds, f.geometry.coordinates, icon(g, c, f.properties.bad), () => popup("sens", f.properties), f.properties.label, 34);
      }
    },
    shel(ds, fc) {
      for (const f of fc.features) marker(ds, f.geometry.coordinates, icon("casa", "#3F7D55"), () => popup("shel", f.properties), f.properties.name, 40);
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
  function setData(id, data) {
    const ds = layer(id); DRAWN[id] = data;
    ds.entities.suspendEvents(); ds.entities.removeAll();
    if (data) draw[id](ds, data);
    ds.entities.resumeEvents(); sc.requestRender();
  }
  const DRAWN = {};
  const setElevation = fn => { elevAt = fn; for (const id of ["hist", "sens", "shel", "bairros", "risk"]) if (DRAWN[id]) setData(id, DRAWN[id]); };
  const show = (id, on) => { layer(id).show = on; sc.requestRender(); };

  // popup próprio, preso ao ponto clicado
  const pop = document.createElement("div"); pop.className = "pop"; pop.hidden = true; container.appendChild(pop);
  const close = () => (pop.hidden = true);
  const h = new Cesium.ScreenSpaceEventHandler(sc.canvas);
  h.setInputAction(e => {
    const p = sc.pick(e.position), ent = p && p.id;
    if (!ent || !ent._pop) return close();
    pop.innerHTML = '<button type="button" aria-label="Fechar">×</button>' + ent._pop();
    pop.firstChild.onclick = close;
    pop.style.left = e.position.x + "px"; pop.style.top = e.position.y + "px"; pop.hidden = false;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  // passar o mouse sobre uma área de perigo mostra o que é e o dado da hora
  const tip = document.createElement("div"); tip.className = "pop tip"; tip.hidden = true; container.appendChild(tip);
  let lastPick = 0;
  h.setInputAction(e => {
    const now = performance.now(); if (now - lastPick < 60) return; lastPick = now; // ponytail: pick é caro, 16 por segundo basta
    const p = sc.pick(e.endPosition), ent = p && p.id;
    sc.canvas.style.cursor = ent && ent._pop ? "pointer" : "";
    if (ent && ent._risk && pop.hidden) {
      tip.innerHTML = ent._pop(); tip.style.left = e.endPosition.x + "px"; tip.style.top = e.endPosition.y + "px"; tip.hidden = false;
    } else tip.hidden = true;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  v.camera.moveStart.addEventListener(close);
  v.camera.moveEnd.addEventListener(() => onMoveEnd && onMoveEnd());

  // câmera
  const cam = v.camera, ctrl = sc.screenSpaceCameraController;
  ctrl.zoomFactor = 14; // padrão 5 é lento no trackpad
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
    cam.flyToBoundingSphere(sphere, { duration, offset: new Cesium.HeadingPitchRange(is3D ? rad(-18) : 0, is3D ? rad(-48) : rad(-90), radius * (is3D ? 2.3 : 2.6)) });
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
  // modo científico: cidade em cinza com rampa hipsométrica e curvas de nível a cada 10 m (fortes a cada 50 m)
  const P0 = Cesium.Cartesian3.fromDegrees(-47.437, -23.47, 0), up0 = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(P0, new Cesium.Cartesian3());
  const RN = 6381000; // raio de curvatura local; o erro fica abaixo de 1 m em 20 km
  const sci = new Cesium.CustomShader({ lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: { u_c: { type: Cesium.UniformType.VEC3, value: Cesium.Cartesian3.subtract(P0, Cesium.Cartesian3.multiplyByScalar(up0, RN, new Cesium.Cartesian3()), new Cesium.Cartesian3()) },
      u_rn: { type: Cesium.UniformType.FLOAT, value: RN } },
    fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float h = length(fsInput.attributes.positionWC - u_c) - u_rn;
      float t = clamp((h - 530.0) / 200.0, 0.0, 1.0);
      vec3 ramp = mix(mix(vec3(0.06, 0.16, 0.40), vec3(0.09, 0.58, 0.60), smoothstep(0.0, 0.5, t)), vec3(0.97, 0.84, 0.33), smoothstep(0.5, 1.0, t));
      float g = dot(material.diffuse, vec3(0.299, 0.587, 0.114));
      vec3 col = mix(vec3(g) * 0.55, ramp, 0.5);
      float w = max(fwidth(h), 0.01);
      float d5 = abs(fract(h / 10.0 + 0.5) - 0.5) * 10.0, d25 = abs(fract(h / 50.0 + 0.5) - 0.5) * 50.0;
      float l5 = 1.0 - smoothstep(0.0, w, d5), l25 = 1.0 - smoothstep(0.0, w * 1.8, d25);
      col = mix(col, vec3(0.90, 0.97, 1.0), max(l5 * 0.18, l25 * 0.75));
      material.diffuse = col;
    }` });
  function setScience(on) { if (tiles) { tiles.customShader = on ? sci : undefined; sc.requestRender(); } }
  function focusCity(on) {
    borda.show = on; plano.show = on; clipOn = on;
    const c = on ? clip() : undefined;
    if (tiles) tiles.clippingPolygons = c; else sc.globe.clippingPolygons = c;
    if (layers.bairros) layers.bairros.show = on;
    sc.requestRender();
  }
  return { setData, setElevation, setScience, show, flyTo, setView, center, focusCity, viewer: v, photoreal: !!tiles };
}
