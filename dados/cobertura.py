# Gera a cobertura (fração de vegetação e de área construída por célula de 0,002°, ~200 m)
# a partir do OpenStreetMap. Rodar: python3 dados/cobertura.py [sorocaba|campinas]
import json, math, sys, glob
CIDADES={  # caixa W,S,E,N; arquivos do Overpass; saída
 'sorocaba':((-47.60,-23.60,-47.33,-23.38),'dados/osm_veg.json',['dados/osm_building.json'],'public/cobertura-sorocaba.json'),
 'campinas':((-47.25,-23.07,-46.81,-22.72),'dados/campinas/osm_veg.json',sorted(glob.glob('dados/campinas/bld/*.json')),'public/campinas/cobertura.json'),
}
(W,S,E,N),VEG,BLD,OUT=CIDADES[sys.argv[1] if len(sys.argv)>1 else 'sorocaba']
D=0.002
nx,ny=round((E-W)/D),round((N-S)/D)
seen=set()  # prédio na borda de dois tiles vem duas vezes
def polys(f):
    for e in json.load(open(f))['elements']:
        if e['id'] in seen: continue
        seen.add(e['id']); g=e.get('geometry')
        if g and len(g)>3: yield [(p['lon'],p['lat']) for p in g]
def inside(x,y,P):
    c=False;j=len(P)-1
    for i in range(len(P)):
        xi,yi=P[i];xj,yj=P[j]
        if (yi>y)!=(yj>y) and x<(xj-xi)*(y-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
veg=[0]*(nx*ny); sub=4
for P in polys(VEG):
    xs=[p[0] for p in P];ys=[p[1] for p in P]
    c0,c1=max(0,int((min(xs)-W)/D)),min(nx-1,int((max(xs)-W)/D))
    r0,r1=max(0,int((min(ys)-S)/D)),min(ny-1,int((max(ys)-S)/D))
    for r in range(r0,r1+1):
        for c in range(c0,c1+1):
            for a in range(sub):
                for b in range(sub):
                    if inside(W+(c+(a+.5)/sub)*D,S+(r+(b+.5)/sub)*D,P): veg[r*nx+c]+=1
veg=[min(100,round(v*100/sub/sub)) for v in veg]
built=[0.0]*(nx*ny); k=math.cos(math.radians(round(-(S+N)/2,1)))*111320*110540
for P in (P for f in BLD for P in polys(f)):
    a=abs(sum(P[i][0]*P[i-1][1]-P[i-1][0]*P[i][1] for i in range(len(P))))/2*k
    cx=sum(p[0] for p in P)/len(P);cy=sum(p[1] for p in P)/len(P)
    c,r=int((cx-W)/D),int((cy-S)/D)
    if 0<=c<nx and 0<=r<ny: built[r*nx+c]+=a
cell=D*D*k
built=[min(100,round(100*b/cell)) for b in built]
json.dump({"west":W,"south":S,"d":D,"nx":nx,"ny":ny,"veg":veg,"built":built},open(OUT,'w'),separators=(',',':'))
print(nx,ny,'veg>50%:',sum(v>50 for v in veg),'built>20%:',sum(b>20 for b in built),'max built',max(built))
