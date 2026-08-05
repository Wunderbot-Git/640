// Acceso a datos: consultas reutilizables sobre la base de datos.

import { computeNetScore } from './scoring.js';

/* ----------------------------- Jugadores ----------------------------- */

export function listPlayers(db) {
  return db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE').all();
}

export function getPlayer(db, id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

export function createPlayer(db, { name, federation_id = null }) {
  const info = db
    .prepare('INSERT INTO players (name, federation_id) VALUES (?, ?)')
    .run(name.trim(), federation_id);
  return getPlayer(db, info.lastInsertRowid);
}

export function updatePlayer(db, id, fields) {
  const current = getPlayer(db, id);
  if (!current) return null;
  const name = fields.name != null ? String(fields.name).trim() : current.name;
  const federation_id =
    fields.federation_id !== undefined ? fields.federation_id : current.federation_id;
  const active = fields.active !== undefined ? (fields.active ? 1 : 0) : current.active;
  db.prepare('UPDATE players SET name = ?, federation_id = ?, active = ? WHERE id = ?').run(
    name,
    federation_id,
    active,
    id
  );
  return getPlayer(db, id);
}

/** Elimina un jugador solo si no tiene resultados registrados. */
export function deletePlayer(db, id) {
  const results = db.prepare('SELECT COUNT(*) AS c FROM results WHERE player_id = ?').get(id).c;
  if (results > 0) {
    return { deleted: false, reason: 'El jugador ya tiene resultados; retirelo en vez de eliminarlo.' };
  }
  db.prepare('DELETE FROM players WHERE id = ?').run(id);
  return { deleted: true };
}

/* ------------------------------- Fechas ------------------------------- */

export function listDates(db) {
  return db.prepare('SELECT * FROM tournament_dates ORDER BY sequence').all();
}

export function getDate(db, id) {
  return db.prepare('SELECT * FROM tournament_dates WHERE id = ?').get(id);
}

export function updateDate(db, id, fields) {
  const current = getDate(db, id);
  if (!current) return null;
  const name = fields.name ?? current.name;
  const play_date = fields.play_date !== undefined ? fields.play_date : current.play_date;
  const default_course =
    fields.default_course !== undefined ? fields.default_course : current.default_course;
  const completed = fields.completed !== undefined ? (fields.completed ? 1 : 0) : current.completed;
  db.prepare(
    'UPDATE tournament_dates SET name = ?, play_date = ?, default_course = ?, completed = ? WHERE id = ?'
  ).run(name, play_date, default_course, completed, id);
  return getDate(db, id);
}

/* ------------------------------ Handicaps ----------------------------- */

export function getHandicap(db, playerId, dateId) {
  return db
    .prepare('SELECT * FROM handicaps WHERE player_id = ? AND date_id = ?')
    .get(playerId, dateId);
}

/** Handicap mas reciente conocido de un jugador (para "handicap vigente"). */
export function latestHandicap(db, playerId) {
  return db
    .prepare(
      `SELECT h.* FROM handicaps h
       JOIN tournament_dates d ON d.id = h.date_id
       WHERE h.player_id = ?
       ORDER BY d.sequence DESC LIMIT 1`
    )
    .get(playerId);
}

export function listHandicapsForDate(db, dateId) {
  return db
    .prepare(
      `SELECT h.*, p.name FROM handicaps h
       JOIN players p ON p.id = h.player_id
       WHERE h.date_id = ? ORDER BY p.name COLLATE NOCASE`
    )
    .all(dateId);
}

export function listHandicapHistory(db, playerId) {
  return db
    .prepare(
      `SELECT h.*, d.sequence, d.name AS date_name, d.play_date
       FROM handicaps h JOIN tournament_dates d ON d.id = h.date_id
       WHERE h.player_id = ? ORDER BY d.sequence`
    )
    .all(playerId);
}

/**
 * Inserta o actualiza el handicap de un jugador para una fecha (upsert).
 * Al cambiar el handicap se recalcula el neto de un resultado existente en esa fecha.
 */
export function setHandicap(db, { playerId, dateId, handicap, source = 'manual' }) {
  const h = Number(handicap);
  db.prepare(
    `INSERT INTO handicaps (player_id, date_id, handicap, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, date_id)
     DO UPDATE SET handicap = excluded.handicap, source = excluded.source, recorded_at = datetime('now')`
  ).run(playerId, dateId, h, source);

  // Si ya hay un resultado en esa fecha, recomputar su handicap y neto.
  const result = db
    .prepare('SELECT * FROM results WHERE player_id = ? AND date_id = ?')
    .get(playerId, dateId);
  if (result) {
    const net = computeNetScore(result.gross_score, h);
    db.prepare('UPDATE results SET handicap_used = ?, net_score = ? WHERE id = ?').run(
      h,
      net,
      result.id
    );
  }
  return getHandicap(db, playerId, dateId);
}

/* ------------------------------ Resultados ---------------------------- */

export function listResultsForDate(db, dateId) {
  return db
    .prepare(
      `SELECT r.*, p.name FROM results r
       JOIN players p ON p.id = r.player_id
       WHERE r.date_id = ? ORDER BY r.net_score`
    )
    .all(dateId);
}

export function listResultsForPlayer(db, playerId) {
  return db
    .prepare(
      `SELECT r.*, d.sequence, d.name AS date_name, d.play_date
       FROM results r JOIN tournament_dates d ON d.id = r.date_id
       WHERE r.player_id = ? ORDER BY d.sequence`
    )
    .all(playerId);
}

/**
 * Registra (o actualiza) el resultado de un jugador en una fecha.
 * El handicap se toma del historial de la fecha; si no existe, se exige el
 * handicap explicito (que ademas queda guardado en el historial).
 */
export function saveResult(db, { playerId, dateId, course = null, gross, handicap = null }) {
  let hRow = getHandicap(db, playerId, dateId);
  let handicapUsed;
  if (hRow) {
    handicapUsed = hRow.handicap;
  } else if (handicap != null && handicap !== '') {
    setHandicap(db, { playerId, dateId, handicap, source: 'manual' });
    handicapUsed = Number(handicap);
  } else {
    return {
      ok: false,
      reason:
        'No hay handicap registrado para este jugador en esta fecha. Importe o ingrese el handicap primero.',
    };
  }

  const net = computeNetScore(gross, handicapUsed);
  db.prepare(
    `INSERT INTO results (player_id, date_id, course, gross_score, handicap_used, net_score)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id, date_id)
     DO UPDATE SET course = excluded.course, gross_score = excluded.gross_score,
                   handicap_used = excluded.handicap_used, net_score = excluded.net_score`
  ).run(playerId, dateId, course, Number(gross), handicapUsed, net);

  const saved = db
    .prepare('SELECT * FROM results WHERE player_id = ? AND date_id = ?')
    .get(playerId, dateId);
  return { ok: true, result: saved };
}

export function deleteResult(db, id) {
  db.prepare('DELETE FROM results WHERE id = ?').run(id);
}

/* ----------------------- Entradas de clasificacion -------------------- */

/**
 * Arma las entradas { player, results, currentHandicap } necesarias para
 * computeClassification. Incluye a todos los jugadores activos.
 */
export function classificationEntries(db) {
  const players = db
    .prepare('SELECT * FROM players WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all();
  return players.map((player) => {
    const results = db
      .prepare('SELECT net_score FROM results WHERE player_id = ?')
      .all(player.id);
    const latest = latestHandicap(db, player.id);
    return { player, results, currentHandicap: latest ? latest.handicap : null };
  });
}
