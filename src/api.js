// Manejadores de la API REST. Cada funcion recibe (ctx) con:
//   { db, params, query, body } y devuelve { status, body } o lanza HttpError.

import * as repo from './repo.js';
import {
  computeClassification,
  computePrizeWinners,
  computePlayerStanding,
  TOURNAMENT_CONFIG,
} from './scoring.js';
import { parseHandicapCsv, applyHandicapsToDate, fetchFromFederation } from './handicap.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ok = (body, status = 200) => ({ status, body });

function requireField(body, field) {
  if (body == null || body[field] === undefined || body[field] === null || body[field] === '') {
    throw new HttpError(400, `Falta el campo requerido: ${field}`);
  }
  return body[field];
}

/* ------------------------------ Config -------------------------------- */

export function getConfig() {
  return ok(TOURNAMENT_CONFIG);
}

/* ----------------------------- Jugadores ------------------------------ */

export function getPlayers({ db }) {
  return ok(repo.listPlayers(db));
}

export function postPlayer({ db, body }) {
  const name = requireField(body, 'name');
  const players = repo.listPlayers(db);
  if (players.length >= 40) {
    throw new HttpError(400, 'El torneo admite un maximo de 40 jugadores.');
  }
  if (players.some((p) => p.name.toLowerCase() === String(name).trim().toLowerCase())) {
    throw new HttpError(409, 'Ya existe un jugador con ese nombre.');
  }
  return ok(repo.createPlayer(db, { name, federation_id: body.federation_id ?? null }), 201);
}

export function patchPlayer({ db, params, body }) {
  const updated = repo.updatePlayer(db, Number(params.id), body || {});
  if (!updated) throw new HttpError(404, 'Jugador no encontrado.');
  return ok(updated);
}

export function deletePlayerHandler({ db, params }) {
  const player = repo.getPlayer(db, Number(params.id));
  if (!player) throw new HttpError(404, 'Jugador no encontrado.');
  const res = repo.deletePlayer(db, Number(params.id));
  if (!res.deleted) throw new HttpError(409, res.reason);
  return ok({ deleted: true });
}

export function getPlayerProfile({ db, params }) {
  const player = repo.getPlayer(db, Number(params.id));
  if (!player) throw new HttpError(404, 'Jugador no encontrado.');

  const results = repo.listResultsForPlayer(db, player.id);
  const handicaps = repo.listHandicapHistory(db, player.id);
  const latest = repo.latestHandicap(db, player.id);
  const standing = computePlayerStanding(
    player,
    results,
    latest ? latest.handicap : null
  );

  // Cuales rondas cuentan (las 6 mejores) para mostrar la evolucion.
  const sortedNets = [...results].map((r) => r.net_score).sort((a, b) => a - b);
  const countingThreshold = sortedNets.slice(0, TOURNAMENT_CONFIG.bestN);
  const countingSet = new Set();
  // Marca exactamente las N mejores (respetando duplicados) como contables.
  const counts = new Map();
  for (const n of countingThreshold) counts.set(n, (counts.get(n) || 0) + 1);
  const evolution = results.map((r) => {
    let counting = false;
    if ((counts.get(r.net_score) || 0) > 0) {
      counts.set(r.net_score, counts.get(r.net_score) - 1);
      counting = true;
    }
    return {
      sequence: r.sequence,
      date_name: r.date_name,
      play_date: r.play_date,
      course: r.course,
      gross_score: r.gross_score,
      handicap_used: r.handicap_used,
      net_score: r.net_score,
      counting,
    };
  });

  return ok({ player, standing, results: evolution, handicaps });
}

/* ------------------------------- Fechas ------------------------------- */

export function getDates({ db }) {
  return ok(repo.listDates(db));
}

export function patchDate({ db, params, body }) {
  const updated = repo.updateDate(db, Number(params.id), body || {});
  if (!updated) throw new HttpError(404, 'Fecha no encontrada.');
  return ok(updated);
}

export function getDateDetail({ db, params }) {
  const date = repo.getDate(db, Number(params.id));
  if (!date) throw new HttpError(404, 'Fecha no encontrada.');
  return ok({
    date,
    handicaps: repo.listHandicapsForDate(db, date.id),
    results: repo.listResultsForDate(db, date.id),
  });
}

/* ------------------------------ Handicaps ----------------------------- */

export function putHandicap({ db, params, body }) {
  const dateId = Number(params.id);
  if (!repo.getDate(db, dateId)) throw new HttpError(404, 'Fecha no encontrada.');
  const playerId = Number(requireField(body, 'player_id'));
  const handicap = Number(requireField(body, 'handicap'));
  if (Number.isNaN(handicap)) throw new HttpError(400, 'Handicap invalido.');
  if (!repo.getPlayer(db, playerId)) throw new HttpError(404, 'Jugador no encontrado.');
  return ok(repo.setHandicap(db, { playerId, dateId, handicap, source: body.source || 'manual' }));
}

export function importHandicaps({ db, params, body }) {
  const dateId = Number(params.id);
  if (!repo.getDate(db, dateId)) throw new HttpError(404, 'Fecha no encontrada.');
  const csv = requireField(body, 'csv');
  const entries = parseHandicapCsv(csv);
  if (entries.length === 0) {
    throw new HttpError(400, 'No se encontraron filas validas en el CSV (formato: nombre_o_id,handicap).');
  }
  const res = applyHandicapsToDate(db, dateId, entries, 'import');
  return ok(res);
}

export async function syncHandicaps({ db, params }) {
  const dateId = Number(params.id);
  if (!repo.getDate(db, dateId)) throw new HttpError(404, 'Fecha no encontrada.');
  try {
    const map = await fetchFromFederation();
    const entries = Object.entries(map).map(([key, handicap]) => ({ key, handicap }));
    const res = applyHandicapsToDate(db, dateId, entries, 'federacion');
    return ok(res);
  } catch (err) {
    throw new HttpError(501, err.message);
  }
}

/* ------------------------------ Resultados ---------------------------- */

export function postResult({ db, body }) {
  const playerId = Number(requireField(body, 'player_id'));
  const dateId = Number(requireField(body, 'date_id'));
  const gross = Number(requireField(body, 'gross_score'));
  if (Number.isNaN(gross)) throw new HttpError(400, 'Score bruto invalido.');
  if (!repo.getPlayer(db, playerId)) throw new HttpError(404, 'Jugador no encontrado.');
  if (!repo.getDate(db, dateId)) throw new HttpError(404, 'Fecha no encontrada.');

  const res = repo.saveResult(db, {
    playerId,
    dateId,
    course: body.course ?? null,
    gross,
    handicap: body.handicap ?? null,
  });
  if (!res.ok) throw new HttpError(400, res.reason);
  return ok(res.result, 201);
}

export function deleteResultHandler({ db, params }) {
  repo.deleteResult(db, Number(params.id));
  return ok({ deleted: true });
}

/* ---------------------- Clasificacion y dashboard --------------------- */

export function getClassification({ db }) {
  const entries = repo.classificationEntries(db);
  const classification = computeClassification(entries);
  const prizeWinners = computePrizeWinners(classification);
  return ok({ classification, prizeWinners, config: TOURNAMENT_CONFIG });
}

export function getDashboard({ db }) {
  const entries = repo.classificationEntries(db);
  const classification = computeClassification(entries);
  const prizeWinners = computePrizeWinners(classification);
  const dates = repo.listDates(db);

  const played = dates.filter((d) => d.completed).length;
  // Proxima fecha: la primera no completada.
  const nextDate = dates.find((d) => !d.completed) || null;
  const leader = classification.find((r) => r.isLeader) || null;

  return ok({
    leader,
    top6: prizeWinners,
    eligibleCount: classification.filter((r) => r.eligible).length,
    notEligibleCount: classification.filter((r) => !r.eligible && r.roundsPlayed > 0).length,
    notStartedCount: classification.filter((r) => r.roundsPlayed === 0).length,
    totalPlayers: classification.length,
    nextDate,
    datesPlayed: played,
    datesRemaining: dates.length - played,
    totalDates: dates.length,
    config: TOURNAMENT_CONFIG,
  });
}
