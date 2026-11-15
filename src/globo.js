// Motor 3D: CesiumJS. Com token do Cesium ion, a cidade é a malha fotorrealista do Google (3D Tiles);
// sem token, cai para satélite Esri sobre o globo liso. O resto do app só fala com esta interface.
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

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
    requestRenderMode: true, maximumRenderTimeChange: Infinity, msaaSamples: 4,
  });
  const sc = v.scene;
  // a cidade solta no espaço
  sc.backgroundColor = Cesium.Color.BLACK; sc.skyBox.show = false; sc.sun.show = false; sc.moon.show = false;
  sc.skyAtmosphere.show = false; sc.fog.enabled = false; sc.globe.showGroundAtmosphere = false; sc.globe.baseColor = Cesium.Color.BLACK;
  sc.globe.depthTestAgainstTerrain = true;

  const ring = limite.coordinates[0];
  const clip = () => new Cesium.ClippingPolygonCollection({ inverse: true,
    polygons: [new Cesium.ClippingPolygon({ positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()) })] });
  let tiles = null;
  if (token) {
    try {
      tiles = await Cesium.createGooglePhotorealistic3DTileset();
      tiles.clippingPolygons = clip();
      sc.primitives.add(tiles);
      sc.globe.show = false;
    } catch (e) { console.warn("3D Tiles indisponíveis", e); }
  }
  if (!tiles) sc.globe.clippingPolygons = clip();

  // borda da cidade com brilho
  const borda = v.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()), width: 7, clampToGround: true,
    material: new Cesium.PolylineGlowMaterialProperty({ color: C("#9FD6F7"), glowPower: 0.35 }) } });

  // camadas dinâmicas
  const layers = {};
  const layer = id => { if (!layers[id]) { layers[id] = new Cesium.CustomDataSource(id); v.dataSources.add(layers[id]); } return layers[id]; };
  const pt = (ll, h = 0) => Cesium.Cartesian3.fromDegrees(ll[0], ll[1], h);
  const ground = { heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY };
  const label = (text, size, offY) => ({ text, font: "600 " + size + "px Archivo, sans-serif", fillColor: Cesium.Color.WHITE,
    outlineColor: C("#1B2A31"), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, offY),
    verticalOrigin: Cesium.VerticalOrigin.TOP, ...ground });

  const draw = {
    risk(ds, fc) {
      for (const f of fc.features) {
        const [col, a] = RISK[f.properties.k] || ["#000", 0];
        for (const poly of f.geometry.coordinates) ds.entities.add({ polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(poly[0].flat()),
            poly.slice(1).map(h => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(h.flat())))),
          material: C(col).withAlpha(a), classificationType: Cesium.ClassificationType.BOTH } });
      }
    },
    rios(ds, fc) {
      for (const f of fc.features) ds.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(f.geometry.coordinates.flat()),
        width: f.properties.w === "r" ? 4 : f.properties.w === "c" ? 2.2 : 1.5, clampToGround: true, material: C("#7FC4F0").withAlpha(0.9) } });
    },
    hist(ds, fc) {
      for (const f of fc.features) ds.entities.add({ position: pt(f.geometry.coordinates), _pop: () => popup("hist", f.properties),
        point: { pixelSize: 9, color: C("#1B2A31"), outlineColor: C("#F2C14E"), outlineWidth: 2.5, ...ground } });
    },
    sens(ds, fc) {
      for (const f of fc.features) ds.entities.add({ position: pt(f.geometry.coordinates), _pop: () => popup("sens", f.properties),
        point: { pixelSize: 11, color: f.properties.bad ? C("#AE3A2C") : Cesium.Color.WHITE, outlineColor: C("#1B2A31"), outlineWidth: 3, ...ground },
        label: { ...label(f.properties.label, 12, 10), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9000) } });
    },
    shel(ds, fc) {
      for (const f of fc.features) ds.entities.add({ position: pt(f.geometry.coordinates), _pop: () => popup("shel", f.properties),
        point: { pixelSize: 14, color: C("#E6ECE8"), outlineColor: C("#3F7D55"), outlineWidth: 3.5, ...ground }, label: label(f.properties.name, 13, 12) });
    },
    bairros(ds, list) {
      for (const [n, lon, lat, k] of list) ds.entities.add({ position: pt([lon, lat]),
        label: { ...label(n.toUpperCase(), k === "s" ? 13 : 11, 0), verticalOrigin: Cesium.VerticalOrigin.CENTER,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, k === "s" ? 22000 : 7000) } });
    },
  };
  function setData(id, data) {
    const ds = layer(id);
    ds.entities.suspendEvents(); ds.entities.removeAll();
    if (data) draw[id](ds, data);
    ds.entities.resumeEvents(); sc.requestRender();
  }
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
  h.setInputAction(e => { const p = sc.pick(e.endPosition); sc.canvas.style.cursor = p && p.id && p.id._pop ? "pointer" : ""; },
    Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  v.camera.moveStart.addEventListener(close);
  v.camera.moveEnd.addEventListener(() => onMoveEnd && onMoveEnd());

  // câmera
  const cam = v.camera, ctrl = sc.screenSpaceCameraController;
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
  function focusCity(on) {
    borda.show = on;
    const c = on ? clip() : undefined;
    if (tiles) tiles.clippingPolygons = c; else sc.globe.clippingPolygons = c;
    if (layers.bairros) layers.bairros.show = on;
    sc.requestRender();
  }
  return { setData, show, flyTo, setView, center, focusCity, viewer: v, photoreal: !!tiles };
}
