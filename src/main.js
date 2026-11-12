import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./style.css";

const TOKEN=import.meta.env.VITE_MAPBOX_TOKEN;
const $=id=>document.getElementById(id);
const CITIES=[
  {n:"Sorocaba",c:[-47.452,-23.492],z:12.6,ctx:"Cortada pelo Rio Sorocaba, com avenidas marginais e bairros baixos junto ao leito."},
  {n:"Petrópolis",c:[-43.178,-22.505],z:13,ctx:"Serra fluminense. Em 2022, chuvas extremas causaram deslizamentos com centenas de mortes."},
  {n:"São Sebastião",c:[-45.68,-23.79],z:12.4,ctx:"Litoral norte de SP. Em 2023, deslizamentos atingiram a Vila Sahy após chuva recorde."},
  {n:"Porto Alegre",c:[-51.215,-30.03],z:12,ctx:"Às margens do Guaíba. Em 2024, a cidade viveu a maior enchente de sua história."},
  {n:"Blumenau",c:[-49.066,-26.919],z:12.8,ctx:"Vale do Itajaí, com histórico de cheias e a tragédia de 2008."}
];
/* forma do hietograma por sistema: peso relativo de cada hora (0 a 71) */
const g=(t,m,s)=>Math.exp(-0.5*((t-m)/s)**2);
const SYSTEMS=[
  {id:"frente",n:"Frente fria",d:"Chuva em faixa, pico na passagem",w:t=>0.1+g(t,30,5)+0.6*g(t,30,1)},
  {id:"zcas",n:"ZCAS",d:"Chuva persistente por dias",w:t=>0.15+(t>8&&t<68?0.85:0.2)*(0.8+0.2*Math.sin(t/5))},
  {id:"conv",n:"Convecção de verão",d:"Pancadas fortes à tarde",w:t=>0.01+0.6*g(t,16,0.6)+0.9*g(t,40,0.6)+1*g(t,64,0.6)},
  {id:"cicl",n:"Ciclone extratropical",d:"Chuva volumosa e concentrada",w:t=>0.05+g(t,20,3)+0.7*g(t,20,0.8)+0.3*g(t,34,4)}
];
let rain=120, ante=80, sys=SYSTEMS[0], grid=null, shelters=[], is3D=true, hours=[], met={};

/* ---------- meteorologia ---------- */
function computeMet(){
  const w=Array.from({length:72},(_,t)=>sys.w(t)), sum=w.reduce((a,b)=>a+b,0);
  hours=w.map(v=>rain*v/sum);
  let peak=0,peakT=0; hours.forEach((v,t)=>{if(v>peak){peak=v;peakT=t;}});
  const days=[0,1,2].map(d=>hours.slice(d*24,d*24+24).reduce((a,b)=>a+b,0));
  const sat=Math.min(1,(ante+0.5*rain)/250);            // índice de saturação do solo
  const C=0.35+0.5*sat;                                   // coeficiente de escoamento
  const runoff=C*rain;
  const rise=runoff*0.06+Math.max(0,peak-10)*0.08;        // subida do nível d'água (m)
  const slideIdx=(rain+0.6*ante)/150;                     // índice de deflagração de deslizamentos
  const dayMax=Math.max(...days);
  const lvI=peak>60?3:peak>30?2:peak>=20?1:0, lvD=dayMax>100?3:dayMax>50?2:dayMax>=30?1:0;
  met={peak,peakT,days,dayMax,sat,C,runoff,rise,slideIdx,inmet:Math.max(lvI,lvD),byI:lvI>=lvD};
}

/* ---------- rios reais (OpenStreetMap) ---------- */
let rivers=null;
fetch("/rios-sorocaba.geojson").then(r=>r.json()).then(j=>{rivers=j;try{map.getSource("rios").setData(j);}catch(e){}if(grid)scheduleSample();});

/* ---------- mapa ---------- */
mapboxgl.accessToken=TOKEN;
const map=new mapboxgl.Map({container:"map",style:"mapbox://styles/mapbox/satellite-streets-v12",
  center:CITIES[0].c,zoom:CITIES[0].z,pitch:62,bearing:-18,antialias:true});
map.addControl(new mapboxgl.NavigationControl({visualizePitch:true}),"bottom-right");
map.addControl(new mapboxgl.ScaleControl({unit:"metric"}),"bottom-left");

map.on("style.load",()=>{
  map.addSource("dem",{type:"raster-dem",url:"mapbox://mapbox.mapbox-terrain-dem-v1",tileSize:512,maxzoom:14});
  map.setTerrain({source:"dem",exaggeration:1.6});
  map.setFog({color:"rgb(220,230,236)","high-color":"rgb(40,80,130)","horizon-blend":0.08,"space-color":"rgb(12,20,30)","star-intensity":0});
  map.addSource("hs",{type:"raster-dem",url:"mapbox://mapbox.mapbox-terrain-dem-v1",tileSize:512,maxzoom:14});
  map.addLayer({id:"hillshade",type:"hillshade",source:"hs",layout:{visibility:"none"},paint:{"hillshade-exaggeration":0.55,"hillshade-shadow-color":"#1B2A31"}});
  map.addSource("rios",{type:"geojson",data:rivers||{type:"FeatureCollection",features:[]}});
  map.addLayer({id:"rios",type:"line",source:"rios",paint:{"line-color":"#7FC4F0",
    "line-width":["match",["get","w"],"r",3,"c",1.6,1.1],"line-opacity":0.9}});
  map.addSource("risk",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
  map.addLayer({id:"risk-fill",type:"fill",source:"risk",paint:{
    "fill-color":["match",["get","k"],"f","#2C6CB0","a","#C4841C","s","#AE3A2C","#000"],
    "fill-opacity":["match",["get","k"],"f",0.62,"a",0.45,"s",0.55,0],"fill-antialias":false}});
  map.addSource("shel",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
  map.addLayer({id:"shel-c",type:"circle",source:"shel",paint:{"circle-radius":8,"circle-color":"#E6ECE8","circle-stroke-color":"#1B2A31","circle-stroke-width":3,"circle-pitch-alignment":"map"}});
  map.addLayer({id:"shel-t",type:"symbol",source:"shel",layout:{"text-field":["get","name"],"text-size":12,"text-offset":[0,1.3],"text-anchor":"top"},
    paint:{"text-color":"#fff","text-halo-color":"#1B2A31","text-halo-width":1.6}});
  map.on("click","shel-c",e=>{const p=e.features[0].properties;new mapboxgl.Popup().setLngLat(e.lngLat).setHTML("<b>Abrigo sugerido</b><br>"+p.name+"<br><small>Exemplo, não é abrigo oficial</small>").addTo(map);});
  map.on("mouseenter","shel-c",()=>map.getCanvas().style.cursor="pointer");
  map.on("mouseleave","shel-c",()=>map.getCanvas().style.cursor="");
  scheduleSample();
});

/* 2D / 3D */
function setView(three){
  is3D=three; $("v3").setAttribute("aria-pressed",three);$("v2").setAttribute("aria-pressed",!three);
  try{
    map.setTerrain({source:"dem",exaggeration:three?1.6:1});
    map.setLayoutProperty("hillshade","visibility",three?"none":"visible");
  }catch(e){}
  if(three){map.dragRotate.enable();map.touchZoomRotate.enableRotation();map.easeTo({pitch:62,bearing:-18,duration:1200});}
  else{map.dragRotate.disable();map.touchZoomRotate.disableRotation();map.easeTo({pitch:0,bearing:0,duration:1200});}
}
$("v3").onclick=()=>setView(true); $("v2").onclick=()=>setView(false);

/* ---------- leitura do relevo ---------- */
let pending=false;
function scheduleSample(){ if(pending)return; pending=true; $("busy").hidden=false; map.once("idle",()=>{pending=false;sample();}); }
map.on("moveend",scheduleSample);
const G=64;
function sample(){
  const b=map.getBounds(), cen=map.getCenter(), f=is3D?0.42:0.48;
  const w=(b.getEast()-b.getWest())*f, h=(b.getNorth()-b.getSouth())*f;
  const west=cen.lng-w, south=cen.lat-h, dx=2*w/G, dy=2*h/G;
  const el=new Float32Array(G*G).fill(NaN);
  for(let r=0;r<G;r++)for(let c=0;c<G;c++){
    const v=map.queryTerrainElevation([west+(c+.5)*dx,south+(r+.5)*dy],{exaggerated:false});
    if(v!=null)el[r*G+c]=v;
  }
  const mx=dx*111320*Math.cos(cen.lat*Math.PI/180), my=dy*110540, slope=new Float32Array(G*G);
  for(let r=1;r<G-1;r++)for(let c=1;c<G-1;c++){const i=r*G+c;slope[i]=Math.hypot((el[i+1]-el[i-1])/(2*mx),(el[i+G]-el[i-G])/(2*my))*100;}
  const vals=Array.from(el).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
  $("busy").hidden=true;
  grid=vals.length<100?null:{west,south,dx,dy,el,slope,base:vals[Math.floor(vals.length*0.03)],hand:computeHAND(el,west,south,dx,dy)};
  render(); findShelters();
}

/* HAND (Height Above Nearest Drainage, Rennó et al. 2008, INPE):
   altura de cada célula acima da célula de drenagem mais próxima.
   Drenagem = células cortadas pelos rios do OSM. Sem rios na tela, devolve null. */
function computeHAND(el,west,south,dx,dy){
  if(!rivers)return null;
  const drain=new Int32Array(G*G).fill(-1), q=[];
  const mark=(x,y)=>{const c=Math.floor((x-west)/dx),r=Math.floor((y-south)/dy),i=r*G+c;
    if(c>=0&&r>=0&&c<G&&r<G&&drain[i]<0&&!isNaN(el[i])){drain[i]=i;q.push(i);}};
  for(const f of rivers.features){const p=f.geometry.coordinates;
    for(let k=1;k<p.length;k++){const[a,b]=p[k-1],[c,d]=p[k],n=Math.ceil(Math.max(Math.abs(c-a)/dx,Math.abs(d-b)/dy)*2)+1;
      for(let s=0;s<=n;s++)mark(a+(c-a)*s/n,b+(d-b)*s/n);}}
  if(q.length<3)return null;
  // busca em largura a partir da drenagem: cada célula herda a drenagem vizinha mais próxima
  for(let h=0;h<q.length;h++){const i=q[h],r=(i/G)|0,c=i%G;
    for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const rr=r+dr,cc=c+dc,j=rr*G+cc; if(rr<0||cc<0||rr>=G||cc>=G||drain[j]>=0||isNaN(el[j]))continue;
      drain[j]=drain[i];q.push(j);}}
  const hand=new Float32Array(G*G).fill(NaN);
  for(let i=0;i<G*G;i++)if(drain[i]>=0)hand[i]=Math.max(0,el[i]-el[drain[i]]);
  return hand;
}

/* ---------- risco ---------- */
let cl=null;
function classify(){
  const out={f:new Uint8Array(G*G),n:{f:0,a:0,s:0,t:0}}; if(!grid)return out;
  const thr=met.slideIdx<0.7?Infinity:Math.max(16,46-20*(met.slideIdx-0.7));
  for(let i=0;i<G*G;i++){
    const e=grid.el[i]; if(isNaN(e))continue; out.n.t++;
    let k=0;
    // com rios: compara a cheia com o HAND; sem rios: cota mais baixa da tela
    const hv=grid.hand?grid.hand[i]:e-grid.base;
    if(rain>0&&hv<met.rise)k=1; else if(met.rise>1&&hv<met.rise+Math.max(2,met.rise*0.35))k=2; else if(grid.slope[i]>thr)k=3;
    out.f[i]=k; if(k)out.n["_fas"[k]]++;
  }
  return out;
}
function render(){
  cl=classify(); const feats=[];
  if(grid){
    const showF=$("lF").checked, showS=$("lS").checked;
    for(let r=0;r<G;r++)for(let c=0;c<G;c++){
      const k=cl.f[r*G+c]; if(!k||(k<3&&!showF)||(k===3&&!showS))continue;
      const x0=grid.west+c*grid.dx,y0=grid.south+r*grid.dy,x1=x0+grid.dx,y1=y0+grid.dy;
      feats.push({type:"Feature",properties:{k:"_fas"[k]},geometry:{type:"Polygon",coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}});
    }
  }
  let src=null;try{src=map.getSource("risk");}catch(e){} if(src)src.setData({type:"FeatureCollection",features:feats});
  const t=cl.n.t||1, pc=v=>grid?(100*v/t).toFixed(1).replace(".",",")+"%":"–";
  $("rF").textContent=pc(cl.n.f);$("rA").textContent=pc(cl.n.a);$("rS").textContent=pc(cl.n.s);
  $("riseTxt").textContent=grid?"Nível d'água estimado em "+fmt(met.rise,1)+" m acima do fundo dos vales, com "+Math.round(met.C*100)+"% da chuva virando escoamento.":"Aproxime o mapa de uma cidade para ler o relevo.";
  drawShelters();
}

/* ---------- abrigos ---------- */
let req=0;
function findShelters(){
  const id=++req,b=map.getBounds();
  fetch("https://api.mapbox.com/search/searchbox/v1/category/school?language=pt&limit=25&bbox="+[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(5)).join(",")+"&access_token="+TOKEN)
  .then(r=>r.json()).then(j=>{if(id!==req)return;shelters=(j.features||[]).map(f=>({name:f.properties.name,c:f.geometry.coordinates}));drawShelters();})
  .catch(()=>{shelters=[];drawShelters();});
}
function safeShelters(){
  if(!grid||!cl)return[];
  return shelters.filter(s=>{const c=Math.floor((s.c[0]-grid.west)/grid.dx),r=Math.floor((s.c[1]-grid.south)/grid.dy);
    return c>=0&&r>=0&&c<G&&r<G&&cl.f[r*G+c]===0;}).slice(0,4);
}
function drawShelters(){
  const list=$("lH").checked&&opLevel()>=2?safeShelters():[];
  let src=null;try{src=map.getSource("shel");}catch(e){}
  if(src)src.setData({type:"FeatureCollection",features:list.map(s=>({type:"Feature",properties:{name:s.name},geometry:{type:"Point",coordinates:s.c}}))});
  plan();
}

/* ---------- nível operacional e plano ---------- */
function opLevel(){const s=Math.max(rain/220,met.peak/60,met.slideIdx/1.6);return s<0.25?0:s<0.5?1:s<0.8?2:3;}
const LEVELS=[["Observação","var(--green)"],["Atenção","var(--ochre)"],["Alerta","var(--orange)"],["Alerta máximo","var(--brick)"]];
function hourLabel(t){return "dia "+(Math.floor(t/24)+1)+", "+String(t%24).padStart(2,"0")+"h";}
function plan(){
  if(!cl)return;
  const n=cl.n,t=n.t||1,lv=opLevel(),safe=safeShelters(),items=[],before=Math.max(0,met.peakT-3);
  if(!grid)items.push(["Aproxime o mapa de uma cidade para o Véspera ler o relevo.",false]);
  else{
    if(lv===0)items.push(["Manter monitoramento de rotina de rios, pluviômetros e encostas.",false]);
    if(lv>=1)items.push(["Acompanhar radar e satélite em regime de nowcasting a partir de "+hourLabel(Math.max(0,met.peakT-6))+".",false]);
    if(n.f>0)items.push(["Interditar vias e travessias nas áreas em azul até "+hourLabel(before)+", antes do pico de "+fmt(met.peak,0)+" mm/h.",true]);
    if(n.a>0&&lv>=1)items.push(["Avisar por SMS os moradores das áreas em amarelo, com rota de saída para terreno mais alto.",true]);
    if(n.s>0)items.push(["Vistoriar as encostas em vermelho e retirar moradores das casas mais próximas. Solo "+soilWord(met.sat)+" reduz a coesão das encostas.",true]);
    if(lv>=2)items.push([safe.length?"Abrir como abrigo temporário: "+safe.slice(0,2).map(s=>s.name).join(" e ")+".":"Definir abrigos temporários em áreas altas, fora das manchas de risco.",true]);
    if(lv>=3)items.push(["Acionar evacuação preventiva e posicionar equipes de resgate nas partes altas antes de "+hourLabel(before)+".",true]);
  }
  $("plan").innerHTML=items.map(([s,a])=>"<li><span>"+s+(a?'<span class="approve">Aguarda aprovação da Defesa Civil</span>':"")+"</span></li>").join("");
}

/* ---------- hietograma ---------- */
function drawHyeto(){
  const W=356,H=128,L=30,B=22,T=8,cw=(W-L-4)/72, maxV=Math.max(5,Math.ceil(met.peak/5)*5), y=v=>H-B-(v/maxV)*(H-B-T);
  let s="";
  for(let k=0;k<=2;k++){const v=maxV*k/2,yy=y(v);s+=`<line x1="${L}" x2="${W-4}" y1="${yy}" y2="${yy}" stroke="#A9B8B1" stroke-width="${k?0.6:1}"/><text x="${L-5}" y="${yy+3.5}" text-anchor="end" font-size="10" fill="#4E6068" font-family="Archivo">${Math.round(v)}</text>`;}
  for(let d=1;d<3;d++){const x=L+d*24*cw;s+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${H-B}" stroke="#A9B8B1" stroke-dasharray="2 3"/>`;}
  ["Dia 1","Dia 2","Dia 3"].forEach((t,d)=>s+=`<text x="${L+(d*24+12)*cw}" y="${H-6}" text-anchor="middle" font-size="10.5" fill="#4E6068" font-family="Archivo">${t}</text>`);
  hours.forEach((v,t)=>{const c=v>60?"#AE3A2C":v>30?"#C55A1F":v>=20?"#C4841C":"#2C6CB0";s+=`<rect x="${L+t*cw+0.4}" y="${y(v)}" width="${Math.max(0.8,cw-0.8)}" height="${Math.max(0,H-B-y(v))}" fill="${c}"/>`;});
  // acumulado
  let acc=0,pts=hours.map((v,t)=>{acc+=v;return [L+(t+1)*cw,H-B-(acc/Math.max(rain,1))*(H-B-T)];});
  if(rain>0)s+=`<polyline points="${pts.map(p=>p.map(n=>n.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#1B2A31" stroke-width="1.4"/>`;
  s+=`<text x="${L}" y="${T+2}" font-size="10" fill="#4E6068" font-family="Archivo" dy="0">mm/h</text>`;
  $("hyeto").innerHTML=s;
  $("fPeak").textContent=fmt(met.peak,met.peak<10?1:0);
  $("fWhen").textContent=rain?"D"+(Math.floor(met.peakT/24)+1)+" "+String(met.peakT%24).padStart(2,"0")+"h":"–";
  $("fDay").textContent=Math.round(met.dayMax);
  const iv=[["Sem aviso do INMET pelos critérios de chuva","var(--green)"],["Equivale a aviso amarelo do INMET (perigo potencial)","var(--ochre)"],["Equivale a aviso laranja do INMET (perigo)","var(--orange)"],["Equivale a aviso vermelho do INMET (grande perigo)","var(--brick)"]][met.inmet];
  $("inmet").style.borderLeftColor=iv[1];
  $("inmet").textContent=iv[0]+(met.inmet?", pelo critério de "+(met.byI?"intensidade horária.":"acumulado diário."):".");
}

/* ---------- controles ---------- */
const fmt=(v,d)=>v.toFixed(d).replace(".",",");
function soilWord(s){return s<0.35?"seco":s<0.6?"moderadamente úmido":s<0.85?"muito úmido":"saturado";}
function update(){
  computeMet();
  $("fill").style.height=(rain/250*100)+"%"; $("mm").textContent=rain; $("tube").setAttribute("aria-valuenow",rain);
  $("liters").textContent=rain+" litros por metro quadrado";
  const lv=LEVELS[opLevel()]; $("level").textContent=lv[0]; $("level").style.background=lv[1];
  $("anteOut").textContent=ante+" mm";
  $("soil").textContent="Solo "+soilWord(met.sat)+": cerca de "+Math.round(met.C*100)+"% da chuva vira escoamento superficial.";
  drawHyeto(); render();
}
const tube=$("tube");
(function(){let h="";for(let v=0;v<=250;v+=50){const p=v/250*100;h+=`<i style="bottom:${p}%"></i><span style="bottom:${p}%">${v}</span>`;}$("ticks").innerHTML=h;})();
function setRain(v){rain=Math.max(0,Math.min(250,Math.round(v/5)*5));update();}
function fromPointer(e){const r=tube.getBoundingClientRect();setRain((1-(e.clientY-r.top)/r.height)*250);}
tube.addEventListener("pointerdown",e=>{tube.setPointerCapture(e.pointerId);fromPointer(e);});
tube.addEventListener("pointermove",e=>{if(tube.hasPointerCapture(e.pointerId))fromPointer(e);});
tube.addEventListener("keydown",e=>{const m={ArrowUp:5,ArrowRight:5,ArrowDown:-5,ArrowLeft:-5,PageUp:25,PageDown:-25}[e.key];if(m){e.preventDefault();setRain(rain+m);}});
document.querySelectorAll(".presets button").forEach(b=>b.onclick=()=>setRain(+b.dataset.v));
$("ante").oninput=e=>{ante=+e.target.value;update();};
["lF","lS"].forEach(id=>$(id).onchange=render); $("lH").onchange=drawShelters;

SYSTEMS.forEach((s,i)=>{const b=document.createElement("button");b.type="button";b.innerHTML="<b>"+s.n+"</b>"+s.d;b.setAttribute("aria-pressed",i===0);
  b.onclick=()=>{sys=s;document.querySelectorAll("#systems button").forEach(x=>x.setAttribute("aria-pressed",x===b));update();};$("systems").appendChild(b);});

function goTo(city,btn){
  document.querySelectorAll("#cities button").forEach(x=>x.setAttribute("aria-pressed",x===btn));
  $("context").textContent=city.ctx||"";
  map.flyTo({center:city.c,zoom:city.z||12.5,pitch:is3D?62:0,bearing:is3D?-18:0,duration:2600,essential:true});
}
CITIES.forEach((c,i)=>{const b=document.createElement("button");b.type="button";b.textContent=c.n;b.setAttribute("aria-pressed",i===0);b.onclick=()=>goTo(c,b);$("cities").appendChild(b);});
$("context").textContent=CITIES[0].ctx;

let tmr;
$("q").addEventListener("input",e=>{
  clearTimeout(tmr);const q=e.target.value.trim();if(q.length<3){$("sugg").hidden=true;return;}
  tmr=setTimeout(()=>{
    fetch("https://api.mapbox.com/search/geocode/v6/forward?types=place&limit=5&language=pt&q="+encodeURIComponent(q)+"&access_token="+TOKEN)
    .then(r=>r.json()).then(j=>{const ul=$("sugg");ul.innerHTML="";
      (j.features||[]).forEach(f=>{const li=document.createElement("li"),b=document.createElement("button");
        b.innerHTML=f.properties.name+" <small>"+(f.properties.place_formatted||"")+"</small>";
        b.onclick=()=>{ul.hidden=true;$("q").value="";goTo({c:f.geometry.coordinates,z:12.5,ctx:f.properties.full_address||f.properties.name},null);};
        li.appendChild(b);ul.appendChild(li);});
      ul.hidden=!ul.children.length;}).catch(()=>{});
  },250);
});

/* abas */
function tab(which){const cen=which==="c";$("tCen").setAttribute("aria-selected",cen);$("tMet").setAttribute("aria-selected",!cen);$("pCen").hidden=!cen;$("pMet").hidden=cen;}
$("tCen").onclick=()=>tab("c");$("tMet").onclick=()=>tab("m");

update();
