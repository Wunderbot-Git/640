# FedEx 6:40 · Sistema de gestión del torneo de golf

Aplicación para administrar el torneo de golf **FedEx 6:40**: registra los
resultados de cada fecha, calcula automáticamente el score neto y la
clasificación, y muestra el ranking actualizado después de cada jornada.

Construida **sin dependencias externas**: usa únicamente Node.js (>= 22.5) con
sus módulos integrados `node:http` y `node:sqlite`. No requiere `npm install`.

---

## Reglas del torneo implementadas

| Regla | Implementación |
|-------|----------------|
| 40 jugadores máximo | Validado al crear jugadores |
| Admins agregan / retiran jugadores | Alta, retiro (soft) y eliminación |
| 10 fechas (sábados) | Sembradas automáticamente al iniciar |
| Mínimo 6 rondas para premio | Estado *Elegible / No elegible* |
| Score neto = bruto − handicap | Cálculo automático |
| Handicap oficial vigente por sábado | Historial de handicaps por fecha (congelado) |
| 6 mejores scores netos | Suma de los 6 menores netos |
| Gana el menor total neto | Ordenamiento de la clasificación |
| Premios a los 6 primeros elegibles | `computePrizeWinners` |

### Clasificación

La tabla muestra: **posición, jugador, handicap vigente, rondas jugadas,
rondas válidas (máx. 6), total de las 6 mejores, promedio neto, estado y
diferencia respecto al líder.**

Los jugadores elegibles (≥ 6 rondas) se ordenan primero por menor total neto;
esto evita que alguien con pocas rondas encabece la tabla solo por haber jugado
menos. Los no elegibles aparecen debajo, marcados. El **líder** es el primer
jugador elegible.

### Handicaps y la Federación Colombiana de Golf

La Federación Colombiana de Golf **no expone (a la fecha) una API pública**.
Por eso el sistema permite al administrador **importar por CSV** o **ingresar
manualmente** los handicaps oficiales antes de cada fecha. El servicio
`src/handicap.js` deja un adaptador conectable (`fetchFromFederation`) para
enchufar una API o base de datos oficial cuando exista, sin tocar el resto del
sistema. El **historial de handicaps por fecha se conserva**, de modo que los
cálculos de jornadas pasadas nunca cambian.

---

## Cómo ejecutar

```bash
npm start          # servidor en http://localhost:3000
npm run dev        # con recarga automática (--watch)
npm test           # pruebas del motor de cálculo y de datos
```

Variables de entorno opcionales: `PORT` (por defecto 3000) y `DB_PATH` (por
defecto `data/fedex640.db`; use `:memory:` para una base efímera).

---

## Estructura

```
src/
  scoring.js   Motor de cálculo (funciones puras: neto, 6 mejores, elegibilidad, ranking)
  db.js        Esquema SQLite y siembra de las 10 fechas
  repo.js      Acceso a datos (jugadores, fechas, handicaps, resultados)
  handicap.js  Importación CSV + adaptador de la Federación (conectable)
  api.js       Manejadores de la API REST
  server.js    Servidor HTTP + enrutador + archivos estáticos
public/        Frontend SPA (dashboard, clasificación, resultados, handicaps, jugadores, fechas)
test/          Pruebas con node:test
```

## API REST (resumen)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard` | Líder, top 6, elegibles, próxima fecha, fechas jugadas/restantes |
| GET | `/api/classification` | Tabla de posiciones + ganadores de premio |
| GET/POST | `/api/players` | Listar / crear jugador |
| PATCH/DELETE | `/api/players/:id` | Actualizar (retirar) / eliminar |
| GET | `/api/players/:id/profile` | Perfil: historial, estadísticas, evolución |
| GET | `/api/dates` | Listar las 10 fechas |
| PATCH | `/api/dates/:id` | Editar fecha / marcar disputada |
| GET | `/api/dates/:id/detail` | Handicaps y resultados de la fecha |
| PUT | `/api/dates/:id/handicaps` | Fijar handicap de un jugador en la fecha |
| POST | `/api/dates/:id/handicaps/import` | Importar handicaps por CSV |
| POST | `/api/dates/:id/handicaps/sync` | Sincronizar con la Federación (adaptador) |
| POST | `/api/results` | Registrar resultado (calcula el neto) |
| DELETE | `/api/results/:id` | Eliminar resultado |

## Funcionalidades del frontend

- **Dashboard**: líder, top 6 con premio, conteo de elegibles/no elegibles,
  próxima fecha, fechas disputadas y restantes.
- **Clasificación**: tabla completa con todas las columnas requeridas.
- **Resultados**: ingreso por jornada con cálculo automático del neto.
- **Handicaps**: importación CSV, edición manual y estado por fecha.
- **Jugadores**: alta, retiro/reactivación, eliminación (roster de 40).
- **Fechas**: edición de fecha y campo, marcar como disputada.
- **Perfil del jugador**: historial de rondas (marcando cuáles cuentan entre
  las 6 mejores) y evolución del handicap.
