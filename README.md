# Véspera

Protótipo acadêmico de previsão de catástrofes (enchente, deslizamento, incêndio em vegetação e onda de calor) para a Defesa Civil, com Sorocaba como cidade piloto.

## Rodar

```
npm install
npm run dev      # http://localhost:5173
npm test         # modelo físico, aprendizado e sensores
npm run build
```

A análise por IA usa `/api/analise` (função do Vercel). Defina `XAI_API_KEY` no `.env.local` ou nas variáveis do Vercel. `AI_BASE_URL` e `AI_MODEL` trocam o provedor (qualquer API compatível com OpenAI).

## Estrutura

- `src/model.js`: hietograma, SCS Curve Number, balanço hídrico do solo, hidrograma de Nash, HAND, encostas, FMA+, índice de calor, regressão logística.
- `src/sensores.js`: conectores simulados (Cemaden, LoRaWAN, ANA/DAEE, INMET, radar IPMet, trânsito) com controle de qualidade.
- `src/main.js`: mapa MapLibre, linha do tempo de 72 h, abas Cenário, Sensores, Plano e Como funciona.
- `api/analise.js`: chamada ao modelo de linguagem, com a chave só no servidor.
- `public/`: dados de Sorocaba gerados do OpenStreetMap (rios, prédios, escolas, cobertura do solo).
- `dados/cobertura.py`: gera `public/cobertura-sorocaba.json` a partir dos arquivos do Overpass.

## Fontes

Satélite Sentinel-2 cloudless 2023 (EOX, CC BY-NC-SA 4.0), relevo Terrain Tiles (AWS Open Data), rótulos OpenFreeMap, dados © colaboradores do OpenStreetMap. Uso não comercial.
