// Capa de base de datos (SQLite via modulo integrado node:sqlite).
// No requiere dependencias externas: usa el SQLite que trae Node >= 22.5.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'fedex640.db');

/**
 * Abre (o crea) la base de datos y garantiza el esquema.
 * @param {string} dbPath Ruta al archivo .db. Usar ':memory:' para pruebas.
 * @returns {DatabaseSync}
 */
export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  createSchema(db);
  return db;
}

/** Crea las tablas si no existen. */
export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      federation_id  TEXT,                         -- numero de la Federacion (opcional)
      active         INTEGER NOT NULL DEFAULT 1,   -- 1 activo, 0 retirado
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tournament_dates (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence      INTEGER NOT NULL UNIQUE,        -- 1..10
      name          TEXT NOT NULL,                  -- ej. "Fecha 1"
      play_date     TEXT,                           -- sabado (YYYY-MM-DD)
      default_course TEXT,                          -- campo por defecto de la jornada
      completed     INTEGER NOT NULL DEFAULT 0
    );

    -- Historial de handicaps: el handicap oficial vigente por jugador y por fecha.
    -- Se conserva para que los calculos no cambien despues.
    CREATE TABLE IF NOT EXISTS handicaps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      date_id       INTEGER NOT NULL REFERENCES tournament_dates(id) ON DELETE CASCADE,
      handicap      REAL NOT NULL,
      source        TEXT NOT NULL DEFAULT 'manual', -- manual | import | federacion
      recorded_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, date_id)
    );

    -- Resultados de cada jornada. El handicap usado se congela aqui.
    CREATE TABLE IF NOT EXISTS results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      date_id       INTEGER NOT NULL REFERENCES tournament_dates(id) ON DELETE CASCADE,
      course        TEXT,
      gross_score   REAL NOT NULL,
      handicap_used REAL NOT NULL,
      net_score     REAL NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, date_id)                    -- un resultado por jugador y fecha
    );

    CREATE INDEX IF NOT EXISTS idx_results_player ON results(player_id);
    CREATE INDEX IF NOT EXISTS idx_results_date   ON results(date_id);
    CREATE INDEX IF NOT EXISTS idx_handicaps_date ON handicaps(date_id);
  `);
}

/**
 * Siembra las 10 fechas del torneo si aun no existen.
 * Los sabados se generan a partir de una fecha de inicio.
 * @param {DatabaseSync} db
 * @param {string} firstSaturday Primer sabado (YYYY-MM-DD).
 */
export function seedDates(db, firstSaturday = '2026-02-07') {
  const count = db.prepare('SELECT COUNT(*) AS c FROM tournament_dates').get().c;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO tournament_dates (sequence, name, play_date) VALUES (?, ?, ?)`
  );
  const start = new Date(`${firstSaturday}T00:00:00Z`);
  for (let i = 0; i < TOTAL_DATES; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i * 7); // un sabado por semana
    insert.run(i + 1, `Fecha ${i + 1}`, d.toISOString().slice(0, 10));
  }
}

const TOTAL_DATES = 10;
