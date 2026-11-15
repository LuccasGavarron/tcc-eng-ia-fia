# Confere os arquivos de public/<cidade>: JSON válido, formato e coordenadas dentro do limite.
# Rodar: python3 dados/conferir_campinas.py [campinas|petropolis]   (padrão: campinas)
import json, os, sys
P = f'public/{sys.argv[1] if len(sys.argv) > 1 else "campinas"}/'
L = json.load(open(P + 'limite.json'))
assert L['type'] == 'Polygon' and len(L['coordinates']) == 1
LIM = L['coordinates'][0]

def inside(x, y):
    c = False; j = len(LIM) - 1
    for i in range(len(LIM)):
        xi, yi = LIM[i]; xj, yj = LIM[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i
    return c

def fora(pts): return [p for p in pts if not inside(p[1], p[2])]
print('limite', len(LIM), 'vértices')

r = json.load(open(P + 'rios.geojson'))['features']
assert all(f['properties']['w'] in 'rcs' and 'n' in f['properties'] and f['geometry']['type'] == 'LineString' for f in r)
print('rios', len(r), {w: sum(f['properties']['w'] == w for f in r) for w in 'rcs'},
      'sem ponto dentro:', sum(not any(inside(*c) for c in f['geometry']['coordinates']) for f in r))

b = json.load(open(P + 'bairros.json'))
assert all(len(x) == 4 and x[3] in (0, 1, 2) for x in b) and not any('PROPOSTO' in x[0].upper() for x in b)
assert len({x[0] for x in b}) == len(b)
print('bairros', len(b), [sum(x[3] == t for x in b) for t in (0, 1, 2)], 'fora:', len(fora(b)))

e = json.load(open(P + 'escolas.json'))
assert all(len(x) == 3 for x in e)
print('escolas', len(e), 'fora:', len(fora(e)))

c = json.load(open(P + 'cobertura.json'))
assert len(c['veg']) == len(c['built']) == c['nx'] * c['ny'] and c['d'] == 0.002
assert c['west'] <= min(p[0] for p in LIM) and c['south'] <= min(p[1] for p in LIM)
assert c['west'] + c['nx'] * c['d'] >= max(p[0] for p in LIM) - 1e-9 and c['south'] + c['ny'] * c['d'] >= max(p[1] for p in LIM) - 1e-9
print('cobertura', c['nx'], 'x', c['ny'], 'veg>50%:', sum(v > 50 for v in c['veg']), 'built>20%:', sum(v > 20 for v in c['built']))

s = json.load(open(P + 'estacoes.json')); ids = {x['id'] for x in s}
assert len(ids) == len(s)
for x in s:
    assert {'id', 'c', 'n', 'll'} <= set(x)
    if x['c'] == 'ana': assert 0 < x['alert'] < x['over']
    if x['c'] == 'transito': assert x['river'] in ids
print('estacoes', len(s), {k: sum(x['c'] == k for x in s) for k in sorted({x['c'] for x in s})},
      'fora:', [x['id'] for x in s if not inside(*x['ll'])])

if os.path.exists(P + 'historico.json'):
    h = json.load(open(P + 'historico.json')); nomes = {p['nome'] for p in h['pontos']}
    for p in h['pontos']: assert p['fontes'] and p['datas'] and isinstance(p['aprox'], bool)
    for ep in h['episodios']:
        assert ep['fontes'] and set(ep['pontos']) <= nomes, ep['titulo']
    for a in h['areas_risco']: assert a['fonte']
    print('historico pontos', len(h['pontos']), 'episodios', len(h['episodios']), 'areas_risco', len(h['areas_risco']),
          'fora:', [p['nome'] for p in h['pontos'] if not inside(p['lon'], p['lat'])])
print('ok')
