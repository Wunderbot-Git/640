// Motor de calculo del torneo FedEx 6:40.
//
// Todas las funciones de este modulo son PURAS: reciben datos y devuelven
// resultados sin tocar la base de datos. Esto permite probarlas de forma
// aislada y garantiza que las reglas del torneo esten en un solo lugar.

/** Configuracion por defecto del torneo (reglas FedEx 6:40). */
export const TOURNAMENT_CONFIG = {
  totalDates: 10, // 10 fechas (sabados)
  bestN: 6, // se conservan los 6 mejores scores netos
  minRoundsForPrizes: 6, // minimo de rondas para ser elegible a premios
  prizePlaces: 6, // se premian los 6 primeros lugares
};

/**
 * Calcula el score neto de una ronda.
 * Neto = bruto - handicap (redondeado a un decimal para evitar ruido de coma flotante).
 *
 * @param {number} gross  Score bruto.
 * @param {number} handicap Handicap vigente usado en la jornada.
 * @returns {number} Score neto.
 */
export function computeNetScore(gross, handicap) {
  const net = Number(gross) - Number(handicap);
  return Math.round(net * 10) / 10;
}

/**
 * Selecciona los N mejores scores netos (los mas bajos) de un jugador.
 *
 * @param {number[]} netScores Lista de scores netos.
 * @param {number} bestN Cantidad de scores a conservar.
 * @returns {number[]} Los N mejores (menores) scores, en orden ascendente.
 */
export function bestNetScores(netScores, bestN = TOURNAMENT_CONFIG.bestN) {
  return [...netScores].sort((a, b) => a - b).slice(0, bestN);
}

/**
 * Calcula la fila de clasificacion de un unico jugador.
 *
 * @param {object} player Datos del jugador { id, name, ... }.
 * @param {Array<{net_score:number}>} results Resultados del jugador.
 * @param {number|null} currentHandicap Handicap vigente (para mostrar).
 * @param {object} config Configuracion del torneo.
 * @returns {object} Fila de clasificacion (sin posicion ni diferencia).
 */
export function computePlayerStanding(player, results, currentHandicap, config = TOURNAMENT_CONFIG) {
  const netScores = results.map((r) => Number(r.net_score));
  const roundsPlayed = netScores.length;
  const best = bestNetScores(netScores, config.bestN);
  const validRounds = best.length; // maximo bestN
  const total = best.reduce((sum, n) => sum + n, 0);
  const netAverage = validRounds > 0 ? Math.round((total / validRounds) * 10) / 10 : 0;
  const eligible = roundsPlayed >= config.minRoundsForPrizes;

  return {
    playerId: player.id,
    name: player.name,
    currentHandicap: currentHandicap ?? null,
    roundsPlayed,
    validRounds,
    total: Math.round(total * 10) / 10,
    netAverage,
    eligible,
    status: eligible ? 'Elegible' : 'No elegible para premios',
  };
}

/**
 * Construye la tabla de clasificacion completa y ordenada.
 *
 * Reglas de ordenamiento:
 *  1. Los jugadores ELEGIBLES (>= 6 rondas) se ubican primero. Es lo justo:
 *     una persona con pocas rondas podria tener un total bajo solo por haber
 *     jugado menos, asi que no debe encabezar a los elegibles.
 *  2. Dentro de cada grupo, gana el menor total neto acumulado.
 *  3. Desempates: mas rondas jugadas, luego orden alfabetico.
 *
 * La "diferencia respecto al lider" se mide contra el primer jugador elegible
 * (el lider real del torneo). Si aun no hay elegibles, se mide contra el primer
 * jugador de la tabla.
 *
 * @param {Array} entries Lista de { player, results, currentHandicap }.
 * @param {object} config Configuracion del torneo.
 * @returns {Array} Filas de clasificacion con position y diffFromLeader.
 */
export function computeClassification(entries, config = TOURNAMENT_CONFIG) {
  const rows = entries.map((e) =>
    computePlayerStanding(e.player, e.results, e.currentHandicap, config)
  );

  rows.sort((a, b) => {
    // Jugadores que no han jugado ninguna ronda van al final del todo.
    const aPlayed = a.roundsPlayed > 0;
    const bPlayed = b.roundsPlayed > 0;
    if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;

    // Elegibles primero.
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;

    // Menor total neto gana (solo relevante si ambos han jugado).
    if (aPlayed && a.total !== b.total) return a.total - b.total;

    // Desempates.
    if (a.roundsPlayed !== b.roundsPlayed) return b.roundsPlayed - a.roundsPlayed;
    return a.name.localeCompare(b.name, 'es');
  });

  // El lider es el primer jugador elegible; si no hay, el primero que haya jugado.
  const leader =
    rows.find((r) => r.eligible && r.roundsPlayed > 0) ||
    rows.find((r) => r.roundsPlayed > 0) ||
    null;

  return rows.map((row, index) => ({
    position: index + 1,
    ...row,
    diffFromLeader:
      leader && row.roundsPlayed > 0
        ? Math.round((row.total - leader.total) * 10) / 10
        : null,
    isLeader: leader ? row.playerId === leader.playerId : false,
  }));
}

/**
 * Determina los ganadores de premios: los primeros `prizePlaces` de la
 * clasificacion que ademas sean elegibles (>= minimo de rondas).
 *
 * @param {Array} classification Salida de computeClassification.
 * @param {object} config Configuracion del torneo.
 * @returns {Array} Filas premiadas con su lugar de premio (prizePlace).
 */
export function computePrizeWinners(classification, config = TOURNAMENT_CONFIG) {
  return classification
    .filter((row) => row.eligible)
    .slice(0, config.prizePlaces)
    .map((row, index) => ({ ...row, prizePlace: index + 1 }));
}
