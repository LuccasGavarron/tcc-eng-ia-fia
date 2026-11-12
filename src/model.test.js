import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "./model.js";

test("SCS-CN: sem escoamento abaixo da abstração inicial, cresce com a chuva", () => {
  assert.equal(M.scsRunoff(5, 82), 0);
  assert.ok(M.scsRunoff(120, 82) > M.scsRunoff(60, 82));
  assert.ok(M.cnFor(1) > M.CN2 && M.cnFor(0) < M.CN2);
});

test("simulação: chuva maior e solo úmido sobem mais o rio", () => {
  const sys = M.SYSTEMS[0], rise = (r, a) => Math.max(...M.simulate(M.hyetograph(sys, r), a).rise);
  assert.ok(rise(200, 80) > rise(60, 80));
  assert.ok(rise(120, 200) > rise(120, 0));
  assert.ok(rise(0, 80) === 0);
  const r120 = rise(120, 80); assert.ok(r120 > 1.5 && r120 < 8, "subida plausível: " + r120);
});

test("HAND: drenagem é zero e cresce com a distância do rio", () => {
  const G = M.G, el = new Float32Array(G * G);
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) el[r * G + c] = 500 + Math.abs(c - 32) * 2;
  const hand = M.computeHAND(el, [[[32.5, 0], [32.5, 63.9]]], 0, 0, 1, 1);
  assert.equal(hand[10 * G + 32], 0);
  assert.equal(hand[10 * G + 42], 20);
  assert.equal(M.computeHAND(el, [], 0, 0, 1, 1), null);
});

test("índices de fogo e calor seguem as tabelas", () => {
  assert.equal(M.fmaClass(M.fmaPlus(1, 80, 0)), 0);
  assert.equal(M.fmaClass(M.fmaPlus(20, 20, 20)), 4);
  assert.ok(Math.abs(M.heatIndex(35, 50) - 41) < 2);   // tabela NOAA: 95 °F e 50% ≈ 105 °F
  assert.equal(M.inmetHeat(6, 4), 2);
});

test("modelos treinados separam bem o histórico de validação", () => {
  const m = M.trainModels();
  for (const k of ["f", "s", "x", "h"]) assert.ok(m[k].auc > 0.75, k + " auc " + m[k].auc);
  console.log(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { auc: +v.auc.toFixed(2), n: v.n, eventos: v.events }])));
});
