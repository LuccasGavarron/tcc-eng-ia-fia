# Petrópolis: calibração

## 1. Chuva em mm e efeito
- Cerca de 50 mm em 24 h (Vila Felipe): deslizamento na R. Itaboraí e o Quitandinha transborda na Coronel Veiga, pista fechada por 10 min (21/03/2018). https://www.jb.com.br/rio/noticias/2018/03/21/amp/chuvas-atingem-petropolis-e-terra-desliza-na-rua-do-palacio-quitandinha.html
- 53,8 mm em 24 h (33,42 mm em 1 h): Quitandinha transborda e a Coronel Veiga é interditada (20/05/2026). https://www.petropolisemcena.com.br/2026/05/boletim-defesa-civil-duas-ocorrencias-e.html
- 70 mm em 1 h: rio transborda na R. do Imperador; Coronel Veiga, R. Teresa, R. 24 de Maio e Av. Portugal alagam (13/12/2022). https://www.brasildefato.com.br/2022/12/13/municipio-de-petropolis-rj-e-atingido-por-forte-chuva-nesta-terca-feira-13/
- 81,4 mm em 24 h (Bingen): 9 ocorrências, sirenes não tocaram (17/10/2023). https://www.correiodamanha.com.br/correio-petropolitano/regiao-serrana/2023/10/99587-despreparo-para-as-chuvas.html
- 85 mm em 1 h (Independência) e 168,4 mm em 24 h: dois carros arrastados no Centro, deslizamento na Siméria, alerta extremo no celular (17/12/2025). https://diariodepetropolis.com.br/integra/chuva-causa-alagamentos-deslizamentos-e-arrasta-carros-em-petropolis-36993
- 196 mm em 12 h: 75 deslizamentos, prédio desaba na Independência, Quitandinha e Piabanha transbordam (22/03/2024). https://www.diariodepernambuco.com.br/noticia/brasil/2024/03/desabamento-causa-tres-mortes-em-petropolis-no-rio-de-janeiro.html
- 260 mm em 3h20 (São Sebastião, Cemaden), 125,8 mm/h no Alto da Serra: mais de 230 mortos, Morro da Oficina, Quitandinha a 5,01 m na Coronel Veiga (15/02/2022). https://www.petropolis.rj.gov.br/pmp/phocadownload/defesa-civil/relatorios/2025/Relatrio%20-%20%20Eventos%20chuvosos%20de%2015%20de%20fevereiro%20de%202022.pdf
- Mais de 300 mm em 24 h: Quitandinha alaga o Centro Histórico, segundo toque de sirene, sem vítimas (05/04/2025). https://eixos.com.br/energia-eletrica/chuva-em-petropolis-destruicao-falta-de-luz-e-acumulado-de-agua-de-um-mes-e-meio-em-24-horas/
- 534,4 mm em 24 h: 250 deslizamentos em 19 localidades (20/03/2022). https://agenciabrasil.ebc.com.br/geral/noticia/2022-03/petropolis-registrou-250-deslizamentos-em-24-horas-por-causa-da-chuva
- Leitura: o Quitandinha sai da calha na Coronel Veiga com uns 50 mm em 24 h; com 70 mm em 1 h o Centro alaga; acima de 190 mm em 12 h vêm dezenas de deslizamentos. Inferência a partir dos casos, não limiar oficial.

## 2. Nível de rio
- Cotas oficiais de transbordamento do INEA (lidas em 15/11/2026). Rio Quitandinha: Cel Veiga 3,3 m, Centro 2 m. Rio Piabanha: Bingen 3,35 m, Corrêas 6,95 m. Rio Palatino: Alto da Serra 4,31 m. https://alertadecheias.inea.rj.gov.br/mapa.php
- Cota em que o rio transborda no Centro: 2 m na régua INEA Centro (Rio Quitandinha, -22.51247, -43.18028). Sem chuva, a régua marcava 0,55 m, então sobra cerca de 1,45 m de folga. https://alertadecheias.inea.rj.gov.br/alertadecheias/224331320.html
- O INEA não publica cota de atenção ou alerta em metros. As cotas de alerta em estacoes.json são estimativa (cerca de 60% da folga até o transbordamento).
- Divergência: o relatório da Defesa Civil de 2022 dá 2,3 m como cota de transbordamento em Cel Veiga; o INEA hoje mostra 3,3 m. Não achei a explicação.

## 3. Critério de alerta da Defesa Civil
- Sirenes, segundo toque (mobilização para os pontos de apoio): 45 mm em 1 h com previsão de chuva forte, critério de 2022. As sirenes tocam por 2 h. https://www.petropolis.rj.gov.br/pmp/phocadownload/defesa-civil/relatorios/2025/Relatrio%20-%20%20Eventos%20chuvosos%20de%2015%20de%20fevereiro%20de%202022.pdf e https://www.cnnbrasil.com.br/nacional/moradores-de-petropolis-relatam-que-sirenes-nao-tocaram-durante-temporal/
- Plano Verão 2025/2026: sirenes com 35 mm/h; pontos de apoio abertos com 100 mm em 24 h (105 mm em jan/2026). https://www.correiodamanha.com.br/petropolitano/2026/01/252010-apesar-dos-esforcos-da-defesa-civil-mp-mantem-recomendacao.html (o texto do plano não foi achado)
- Estágios em 2022: Observação, Atenção, Alerta e Crise. Pelo menos 18 sirenes em 2022.
- 72 h: sem critério oficial achado. Limiar acadêmico para o Quitandinha: 60 mm em 24 h, 100 mm em 48 h, 140 mm em 72 h. https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-temporarias/externas/54a-legislatura/desastres-na-regiao-serrana-do-rio-de-janeiro/audiencias-publicas-1/apresentacao-do-prof.-dr.-antonio-jose-teixeira-guerra-professor-da-ufrj
- SMS 40199 com o CEP; alerta extremo por Cell Broadcast desde dez/2025. https://alertadecheias.inea.rj.gov.br/sobre.php

## 4. Câmera
- Sugestão: c: [-43.185, -22.51], r: 6000. Cobre o 1º distrito (Centro, Quitandinha, Alto da Serra, Independência, Mosela), onde estão quase todos os pontos do histórico.
- Para incluir Corrêas, Nogueira, Itaipava e o Vale do Cuiabá (2011), use c: [-43.15, -22.46], r: 13000.

## 5. Altitude da área urbana
- Mínimo 650 m, máximo 1050 m (Copernicus 90 m via Open-Meteo, nos bairros e pontos do histórico; p5 690 m, p95 980 m). O Pico do Couto, fora da área urbana, passa de 1.700 m.

## 6. Via principal
- R. Coronel Veiga (com a R. Washington Luiz), entre o Quitandinha e o Centro Histórico, na beira do Rio Quitandinha. Tem cancelas eletrônicas e foi fechada em 2018, 2022, 2023, 2024 e 2026. https://brasildefato.com.br/2024/03/22/petropolis-rj-tem-ruas-interditadas-devido-a-inundacoes-causadas-pelo-transbordamento-do-rio-quitandinha
