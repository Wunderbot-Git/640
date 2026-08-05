// Servicio de handicaps: sincronizacion / importacion de handicaps oficiales.
//
// La Federacion Colombiana de Golf no ofrece (a la fecha) una API publica
// documentada. Este servicio esta disenado como un PUNTO DE EXTENSION:
//   - Hoy soporta importacion manual y por CSV.
//   - `fetchFromFederation` es un adaptador conectable: cuando exista una API
//     o base de datos oficial, se implementa ahi sin tocar el resto del sistema.

import { setHandicap } from './repo.js';

/**
 * Adaptador de la Federacion Colombiana de Golf.
 * Devuelve un mapa { federation_id|name -> handicap } o lanza si no hay fuente.
 *
 * Sustituir el cuerpo por la llamada real (fetch a la API / base de datos)
 * cuando este disponible. Se deja sin implementar a proposito para no
 * inventar un endpoint inexistente.
 */
export async function fetchFromFederation() {
  throw new Error(
    'Sincronizacion automatica no disponible: la Federacion Colombiana de Golf no expone una API publica. ' +
      'Use la importacion por CSV o el ingreso manual de handicaps.'
  );
}

/**
 * Parsea un CSV simple de handicaps.
 * Formato esperado (con o sin encabezado):
 *   federation_id,handicap   o   name,handicap
 * Devuelve filas { key, handicap } donde key puede ser id de federacion o nombre.
 *
 * @param {string} csv
 * @returns {Array<{key:string, handicap:number}>}
 */
export function parseHandicapCsv(csv) {
  const rows = [];
  const lines = String(csv)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((p) => p.trim());
    if (parts.length < 2) continue;
    const [key, rawHandicap] = parts;
    const handicap = Number(String(rawHandicap).replace(',', '.'));
    // Saltar encabezados tipo "nombre,handicap".
    if (Number.isNaN(handicap)) continue;
    if (!key) continue;
    rows.push({ key, handicap });
  }
  return rows;
}

/**
 * Aplica una lista de handicaps a una fecha, emparejando cada fila con un
 * jugador por federation_id o por nombre (case-insensitive).
 *
 * @returns {{ applied:number, unmatched:Array<string> }}
 */
export function applyHandicapsToDate(db, dateId, entries, source = 'import') {
  const players = db.prepare('SELECT id, name, federation_id FROM players WHERE active = 1').all();
  const byFed = new Map();
  const byName = new Map();
  for (const p of players) {
    if (p.federation_id) byFed.set(String(p.federation_id).toLowerCase(), p);
    byName.set(p.name.toLowerCase(), p);
  }

  let applied = 0;
  const unmatched = [];
  for (const { key, handicap } of entries) {
    const k = String(key).toLowerCase();
    const player = byFed.get(k) || byName.get(k);
    if (!player) {
      unmatched.push(key);
      continue;
    }
    setHandicap(db, { playerId: player.id, dateId, handicap, source });
    applied++;
  }
  return { applied, unmatched };
}
