# Gera public/campinas/{rios.geojson,escolas.json,bairros.json} a partir dos arquivos do
# Overpass em dados/campinas/ (mesma lógica dos arquivos de Sorocaba). Rodar: python3 dados/campinas.py
# A cobertura sai de: python3 dados/cobertura.py campinas
import json, os
D, P = 'dados/campinas/', 'public/campinas/'
LIM = json.load(open(P + 'limite.json'))['coordinates'][0]

def inside(x, y, P=LIM):
    c = False; j = len(P) - 1
    for i in range(len(P)):
        xi, yi = P[i]; xj, yj = P[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i
    return c

def els(f): return json.load(open(D + f))['elements']
def ll(e): c = e.get('center') or e; return round(c['lon'], 5), round(c['lat'], 5)
dump = lambda o, f: json.dump(o, open(P + f, 'w'), ensure_ascii=False, separators=(',', ':'))

# rios: waterways que cruzam o município (consulta por área), sem recorte, como em Sorocaba
feats = [{"type": "Feature", "properties": {"w": e['tags']['waterway'][0], "n": e['tags'].get('name', '')},
          "geometry": {"type": "LineString", "coordinates": [[round(p['lon'], 5), round(p['lat'], 5)] for p in e['geometry']]}}
         for e in els('osm_waterway.json') if e.get('geometry') and e['tags'].get('waterway') in ('river', 'stream', 'canal')]
dump({"type": "FeatureCollection", "features": feats}, 'rios.geojson')

# escolas: amenity=school com nome, centro do polígono, só dentro do limite
esc = [[e['tags']['name'], *ll(e)] for e in els('osm_school.json') if e['tags'].get('name')]
dump([x for x in esc if inside(x[1], x[2])], 'escolas.json')

# bairros: place=suburb|neighbourhood|quarter (nó ou polígono) do OSM. Campinas tem poucos
# (~100 contra 650 em Sorocaba), então completa com landuse=residential nomeado.
# ponytail: o complemento entra só se o nome ainda não existe.
seen, d = set(), []
for f, ok in (('osm_place.json', lambda t: t.get('place') in ('suburb', 'neighbourhood', 'quarter')),
              ('osm_residential.json', lambda t: True)):
    if not os.path.exists(D + f): continue
    for e in els(f):
        t = e.get('tags', {}); n = t.get('name', '').strip()
        if not n or not ok(t) or n.upper() in seen or 'PROPOSTO' in n.upper(): continue
        x, y = ll(e)
        if inside(x, y): seen.add(n.upper()); d.append([n, x, y, f != 'osm_place.json'])
# níveis: 0 = um nome por célula de 2,6 km, 1 = por célula de 900 m, 2 = o resto (igual a Sorocaba)
out, used = [], set()
for tier, km in ((0, 2.6), (1, 0.9)):
    cells = {}
    for x in d:
        if x[0] in used: continue
        s = km / 111; k = (int(x[1] // s), int(x[2] // s))
        # bairro do OSM (place) ganha do loteamento (residential) na mesma célula
        dist = (x[3], (x[1] - (k[0] + .5) * s) ** 2 + (x[2] - (k[1] + .5) * s) ** 2)
        if k not in cells or dist < cells[k][0]: cells[k] = (dist, x)
    for _, x in cells.values(): used.add(x[0]); out.append([*x[:3], tier])
out += [[*x[:3], 2] for x in d if x[0] not in used]
dump(out, 'bairros.json')
print('rios', len(feats), 'escolas', len(esc), 'bairros', len(out), [sum(o[3] == t for o in out) for t in (0, 1, 2)])
