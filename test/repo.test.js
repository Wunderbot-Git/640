// Pruebas de integracion de la capa de datos (base de datos en memoria).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDates } from '../src/db.js';
import * as repo from '../src/repo.js';
import { computeClassification } from '../src/scoring.js';

function freshDb() {
  const db = openDatabase(':memory:');
  seedDates(db);
  return db;
}

test('seedDates crea 10 fechas', () => {
  const db = freshDb();
  assert.equal(repo.listDates(db).length, 10);
  db.close();
});

test('handicap se congela y el neto se recalcula al guardar resultado', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const p = repo.createPlayer(db, { name: 'Ana' });
  repo.setHandicap(db, { playerId: p.id, dateId: dates[0].id, handicap: 12 });

  const r = repo.saveResult(db, { playerId: p.id, dateId: dates[0].id, gross: 85 });
  assert.equal(r.ok, true);
  assert.equal(r.result.net_score, 73); // 85 - 12

  // Cambiar el handicap recalcula el neto del resultado existente.
  repo.setHandicap(db, { playerId: p.id, dateId: dates[0].id, handicap: 10 });
  const updated = db.prepare('SELECT net_score FROM results WHERE id = ?').get(r.result.id);
  assert.equal(updated.net_score, 75); // 85 - 10
  db.close();
});

test('saveResult exige handicap si no hay uno cargado', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const p = repo.createPlayer(db, { name: 'Beto' });
  const res = repo.saveResult(db, { playerId: p.id, dateId: dates[0].id, gross: 90 });
  assert.equal(res.ok, false);
  db.close();
});

test('saveResult acepta handicap inline y lo guarda en el historial', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const p = repo.createPlayer(db, { name: 'Caro' });
  const res = repo.saveResult(db, { playerId: p.id, dateId: dates[0].id, gross: 88, handicap: 8 });
  assert.equal(res.ok, true);
  assert.equal(res.result.net_score, 80);
  const h = repo.getHandicap(db, p.id, dates[0].id);
  assert.equal(h.handicap, 8);
  db.close();
});

test('un resultado por jugador y fecha (upsert)', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const p = repo.createPlayer(db, { name: 'Dani' });
  repo.saveResult(db, { playerId: p.id, dateId: dates[0].id, gross: 90, handicap: 10 });
  repo.saveResult(db, { playerId: p.id, dateId: dates[0].id, gross: 80, handicap: 10 });
  const rows = db.prepare('SELECT * FROM results WHERE player_id = ?').all(p.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net_score, 70);
  db.close();
});

test('no se puede eliminar un jugador con resultados', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const p = repo.createPlayer(db, { name: 'Eli' });
  repo.saveResult(db, { playerId: p.id, dateId: dates[0].id, gross: 80, handicap: 10 });
  const res = repo.deletePlayer(db, p.id);
  assert.equal(res.deleted, false);
  db.close();
});

test('flujo completo -> clasificacion con lider correcto', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const ana = repo.createPlayer(db, { name: 'Ana' });
  const ben = repo.createPlayer(db, { name: 'Ben' });

  // Ana juega 6 rondas (elegible), Ben 3 (no elegible).
  for (let i = 0; i < 6; i++) {
    repo.saveResult(db, { playerId: ana.id, dateId: dates[i].id, gross: 80, handicap: 10 }); // neto 70
  }
  for (let i = 0; i < 3; i++) {
    repo.saveResult(db, { playerId: ben.id, dateId: dates[i].id, gross: 75, handicap: 10 }); // neto 65
  }

  const cls = computeClassification(repo.classificationEntries(db));
  assert.equal(cls[0].name, 'Ana'); // elegible => lider aunque Ben tenga netos menores
  assert.equal(cls[0].total, 420);
  assert.equal(cls[0].isLeader, true);
  assert.equal(cls[1].name, 'Ben');
  assert.equal(cls[1].eligible, false);
  db.close();
});

test('latestHandicap devuelve el de la fecha mas reciente', () => {
  const db = freshDb();
  const dates = repo.listDates(db);
  const p = repo.createPlayer(db, { name: 'Fabi' });
  repo.setHandicap(db, { playerId: p.id, dateId: dates[0].id, handicap: 15 });
  repo.setHandicap(db, { playerId: p.id, dateId: dates[3].id, handicap: 11 });
  assert.equal(repo.latestHandicap(db, p.id).handicap, 11);
  db.close();
});
