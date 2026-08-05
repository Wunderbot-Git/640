// Pruebas del motor de calculo (reglas del torneo FedEx 6:40).
// Ejecutar: npm test  (usa node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNetScore,
  bestNetScores,
  computePlayerStanding,
  computeClassification,
  computePrizeWinners,
  TOURNAMENT_CONFIG,
} from '../src/scoring.js';

test('computeNetScore: neto = bruto - handicap', () => {
  assert.equal(computeNetScore(85, 12), 73);
  assert.equal(computeNetScore(90, 8.5), 81.5);
  assert.equal(computeNetScore(72, 0), 72);
});

test('bestNetScores: conserva los 6 menores en orden ascendente', () => {
  const nets = [80, 70, 75, 90, 68, 72, 85, 66];
  assert.deepEqual(bestNetScores(nets, 6), [66, 68, 70, 72, 75, 80]);
});

test('bestNetScores: con menos de 6 rondas devuelve todas', () => {
  assert.deepEqual(bestNetScores([70, 74, 72], 6), [70, 72, 74]);
});

test('computePlayerStanding: elegible con 6+ rondas, total = suma de 6 mejores', () => {
  const results = [72, 75, 70, 80, 68, 74, 90].map((n) => ({ net_score: n }));
  const s = computePlayerStanding({ id: 1, name: 'Ana' }, results, 10);
  assert.equal(s.roundsPlayed, 7);
  assert.equal(s.validRounds, 6);
  // 6 mejores: 68,70,72,74,75,80 = 439
  assert.equal(s.total, 439);
  assert.equal(s.netAverage, Math.round((439 / 6) * 10) / 10);
  assert.equal(s.eligible, true);
  assert.equal(s.status, 'Elegible');
  assert.equal(s.currentHandicap, 10);
});

test('computePlayerStanding: no elegible con menos de 6 rondas', () => {
  const results = [70, 72, 68].map((n) => ({ net_score: n }));
  const s = computePlayerStanding({ id: 2, name: 'Beto' }, results, null);
  assert.equal(s.roundsPlayed, 3);
  assert.equal(s.validRounds, 3);
  assert.equal(s.total, 210);
  assert.equal(s.eligible, false);
  assert.equal(s.status, 'No elegible para premios');
});

test('computeClassification: elegibles primero, luego por menor total', () => {
  const mk = (id, name, nets) => ({
    player: { id, name },
    results: nets.map((n) => ({ net_score: n })),
    currentHandicap: 10,
  });
  const entries = [
    mk(1, 'Alto', [70, 70, 70, 70, 70, 70]), // total 420, elegible
    mk(2, 'Bajo', [60, 60, 60, 60, 60, 60]), // total 360, elegible -> lider
    mk(3, 'Pocas', [50, 50, 50]), // total 150 pero NO elegible
  ];
  const cls = computeClassification(entries);
  assert.equal(cls[0].name, 'Bajo'); // menor total entre elegibles
  assert.equal(cls[0].isLeader, true);
  assert.equal(cls[0].position, 1);
  assert.equal(cls[1].name, 'Alto');
  // El de pocas rondas, pese a total bajo, va despues de los elegibles.
  assert.equal(cls[2].name, 'Pocas');
  assert.equal(cls[2].eligible, false);
});

test('computeClassification: diferencia respecto al lider', () => {
  const mk = (id, name, nets) => ({
    player: { id, name },
    results: nets.map((n) => ({ net_score: n })),
    currentHandicap: 5,
  });
  const cls = computeClassification([
    mk(1, 'Lider', [60, 60, 60, 60, 60, 60]), // 360
    mk(2, 'Segundo', [65, 65, 65, 65, 65, 65]), // 390
  ]);
  assert.equal(cls[0].diffFromLeader, 0);
  assert.equal(cls[1].diffFromLeader, 30);
});

test('computeClassification: jugadores sin rondas van al final sin posicion de total', () => {
  const entries = [
    { player: { id: 1, name: 'Jugo' }, results: [{ net_score: 70 }], currentHandicap: 8 },
    { player: { id: 2, name: 'NoJugo' }, results: [], currentHandicap: 8 },
  ];
  const cls = computeClassification(entries);
  assert.equal(cls[0].name, 'Jugo');
  assert.equal(cls[1].name, 'NoJugo');
  assert.equal(cls[1].roundsPlayed, 0);
  assert.equal(cls[1].diffFromLeader, null);
});

test('computePrizeWinners: solo elegibles y maximo 6', () => {
  const mk = (id, name, total, eligible) => ({
    playerId: id,
    name,
    total,
    eligible,
    position: id,
    roundsPlayed: eligible ? 6 : 3,
    validRounds: eligible ? 6 : 3,
    netAverage: total / 6,
  });
  const classification = [
    mk(1, 'A', 360, true),
    mk(2, 'B', 370, true),
    mk(3, 'C', 380, true),
    mk(4, 'D', 390, true),
    mk(5, 'E', 400, true),
    mk(6, 'F', 410, true),
    mk(7, 'G', 415, true),
    mk(8, 'H', 300, false),
  ];
  const winners = computePrizeWinners(classification);
  assert.equal(winners.length, 6);
  assert.equal(winners[0].prizePlace, 1);
  assert.equal(winners[5].name, 'F');
  assert.ok(!winners.some((w) => w.name === 'H')); // no elegible excluido
});

test('config del torneo coincide con las reglas FedEx 6:40', () => {
  assert.equal(TOURNAMENT_CONFIG.totalDates, 10);
  assert.equal(TOURNAMENT_CONFIG.bestN, 6);
  assert.equal(TOURNAMENT_CONFIG.minRoundsForPrizes, 6);
  assert.equal(TOURNAMENT_CONFIG.prizePlaces, 6);
});
