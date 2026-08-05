// Frontend SPA del torneo FedEx 6:40. Sin frameworks: fetch + render por vista.

/* ------------------------------ Utilidades ------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 1 }));

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
}
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

/* --------------------------------- Router -------------------------------- */

const views = {};
let currentView = 'dashboard';

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  switchView(btn.dataset.view);
});

function switchView(name) {
  currentView = name;
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name)
  );
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
  views[name]?.();
}

/* ------------------------------- Dashboard ------------------------------- */

views.dashboard = async function () {
  const root = $('#view-dashboard');
  root.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const d = await api('/dashboard');
    const leader = d.leader;
    root.innerHTML = `
      <h2>Dashboard</h2>
      <p class="subtitle">Estado del torneo · ${d.config.totalDates} fechas · mejores ${d.config.bestN} scores netos</p>

      <div class="grid stats">
        <div class="stat"><div class="label">Jugadores</div><div class="value">${d.totalPlayers}</div></div>
        <div class="stat"><div class="label">Elegibles</div><div class="value">${d.eligibleCount}</div></div>
        <div class="stat"><div class="label">No elegibles</div><div class="value">${d.notEligibleCount}</div></div>
        <div class="stat"><div class="label">Fechas jugadas</div><div class="value">${d.datesPlayed} / ${d.totalDates}</div></div>
        <div class="stat"><div class="label">Fechas restantes</div><div class="value">${d.datesRemaining}</div></div>
      </div>

      <div class="grid" style="grid-template-columns: 1fr 1fr; margin-top:16px;">
        <div class="card leader-card">
          <h3>Líder del torneo</h3>
          ${
            leader
              ? `<div class="leader-name">${esc(leader.name)}</div>
                 <div class="leader-meta">Total 6 mejores: <b>${fmt(leader.total)}</b> · Promedio ${fmt(leader.netAverage)} · ${leader.validRounds} rondas válidas</div>`
              : '<div class="leader-meta">Aún no hay jugadores elegibles.</div>'
          }
        </div>
        <div class="card">
          <h3>Próxima fecha</h3>
          ${
            d.nextDate
              ? `<div class="leader-name" style="color:var(--green-900)">${esc(d.nextDate.name)}</div>
                 <div class="muted">${esc(d.nextDate.play_date || 'Fecha por definir')}${d.nextDate.default_course ? ' · ' + esc(d.nextDate.default_course) : ''}</div>`
              : '<div class="muted">Todas las fechas se han disputado.</div>'
          }
        </div>
      </div>

      <div class="card">
        <h3>Top 6 · Puestos con premio</h3>
        ${renderTop6(d.top6)}
      </div>
    `;
  } catch (err) {
    root.innerHTML = `<p class="notice">${esc(err.message)}</p>`;
  }
};

function renderTop6(rows) {
  if (!rows.length) return '<p class="muted">Ningún jugador ha completado el mínimo de rondas todavía.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Jugador</th><th class="num">Total neto</th><th class="num">Promedio</th><th class="num">Rondas válidas</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr class="row-prize"><td class="pos">${r.prizePlace}</td><td>${esc(r.name)}</td>
        <td class="num">${fmt(r.total)}</td><td class="num">${fmt(r.netAverage)}</td><td class="num">${r.validRounds}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

/* ----------------------------- Clasificación ----------------------------- */

views.classification = async function () {
  const root = $('#view-classification');
  root.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const { classification, config } = await api('/classification');
    root.innerHTML = `
      <h2>Clasificación</h2>
      <p class="subtitle">Suma de los ${config.bestN} mejores scores netos · gana el menor total · mínimo ${config.minRoundsForPrizes} rondas para premio</p>
      ${
        classification.length === 0
          ? '<div class="card"><p class="muted">No hay jugadores registrados.</p></div>'
          : `<div class="card"><div class="table-wrap"><table>
        <thead><tr>
          <th>Pos.</th><th>Jugador</th><th class="num">Hcp vig.</th>
          <th class="num">Rondas</th><th class="num">Válidas</th>
          <th class="num">Total 6 mej.</th><th class="num">Prom. neto</th>
          <th>Estado</th><th class="num">Dif. líder</th>
        </tr></thead>
        <tbody>${classification.map(rowClassification).join('')}</tbody>
      </table></div></div>`
      }
    `;
    root.querySelectorAll('[data-profile]').forEach((b) =>
      b.addEventListener('click', () => showProfile(Number(b.dataset.profile)))
    );
  } catch (err) {
    root.innerHTML = `<p class="notice">${esc(err.message)}</p>`;
  }
};

function rowClassification(r) {
  const cls = [r.isLeader ? 'row-leader' : '', r.eligible && r.position <= 6 ? 'row-prize' : '']
    .filter(Boolean)
    .join(' ');
  return `<tr class="${cls}">
    <td class="pos">${r.roundsPlayed > 0 ? r.position : '—'}</td>
    <td><button class="link" data-profile="${r.playerId}">${esc(r.name)}</button></td>
    <td class="num">${fmt(r.currentHandicap)}</td>
    <td class="num">${r.roundsPlayed}</td>
    <td class="num">${r.validRounds}</td>
    <td class="num">${r.roundsPlayed > 0 ? fmt(r.total) : '—'}</td>
    <td class="num">${r.roundsPlayed > 0 ? fmt(r.netAverage) : '—'}</td>
    <td><span class="badge ${r.eligible ? 'ok' : 'no'}">${esc(r.status)}</span></td>
    <td class="num">${r.diffFromLeader != null ? (r.diffFromLeader > 0 ? '+' : '') + fmt(r.diffFromLeader) : '—'}</td>
  </tr>`;
}

/* ------------------------------- Resultados ------------------------------ */

let selectedResultDate = null;

views.results = async function () {
  const root = $('#view-results');
  root.innerHTML = '<p class="muted">Cargando…</p>';
  const [dates, players] = await Promise.all([api('/dates'), api('/players')]);
  const activePlayers = players.filter((p) => p.active);
  selectedResultDate = selectedResultDate || (dates.find((d) => !d.completed) || dates[0])?.id;

  root.innerHTML = `
    <h2>Ingreso de resultados</h2>
    <p class="subtitle">El score neto se calcula automáticamente (bruto − handicap vigente de la fecha).</p>
    <div class="section-actions">
      <div class="field"><label>Fecha (jornada)</label>
        <select id="resDate">${dates
          .map(
            (d) =>
              `<option value="${d.id}" ${d.id === selectedResultDate ? 'selected' : ''}>${esc(d.name)}${d.play_date ? ' · ' + esc(d.play_date) : ''}${d.completed ? ' ✓' : ''}</option>`
          )
          .join('')}</select></div>
    </div>
    <div class="card">
      <h3>Registrar resultado</h3>
      <div class="form-row">
        <div class="field"><label>Jugador</label>
          <select id="resPlayer">${activePlayers
            .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
            .join('')}</select></div>
        <div class="field"><label>Campo de golf</label><input id="resCourse" placeholder="Campo" /></div>
        <div class="field"><label>Score bruto</label><input id="resGross" type="number" step="1" placeholder="Ej. 85" /></div>
        <div class="field"><label>Handicap (si no está cargado)</label><input id="resHcp" type="number" step="0.1" placeholder="opcional" /></div>
        <button class="btn" id="resSave">Guardar</button>
      </div>
      <p class="small muted" style="margin-top:8px">Si el jugador ya tiene handicap cargado para la fecha, ese valor se usa automáticamente y el campo de handicap se ignora.</p>
    </div>
    <div class="card">
      <h3>Resultados de la fecha</h3>
      <div id="resTable"></div>
      <div style="margin-top:14px" id="resCompleteWrap"></div>
    </div>
  `;

  $('#resDate').addEventListener('change', (e) => {
    selectedResultDate = Number(e.target.value);
    views.results();
  });
  $('#resSave').addEventListener('click', saveResult);
  await renderResultsTable(dates);
};

async function renderResultsTable(dates) {
  const detail = await api(`/dates/${selectedResultDate}/detail`);
  const wrap = $('#resTable');
  if (!detail.results.length) {
    wrap.innerHTML = '<p class="muted">Sin resultados registrados en esta fecha.</p>';
  } else {
    wrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Jugador</th><th>Campo</th><th class="num">Bruto</th><th class="num">Hcp</th><th class="num">Neto</th><th></th></tr></thead>
      <tbody>${detail.results
        .map(
          (r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.course || '—')}</td>
          <td class="num">${fmt(r.gross_score)}</td><td class="num">${fmt(r.handicap_used)}</td>
          <td class="num"><b>${fmt(r.net_score)}</b></td>
          <td><button class="btn danger small" data-del="${r.id}">Eliminar</button></td></tr>`
        )
        .join('')}</tbody></table></div>`;
    wrap.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api(`/results/${b.dataset.del}`, { method: 'DELETE' });
        toast('Resultado eliminado');
        views.results();
      })
    );
  }
  const date = dates.find((d) => d.id === selectedResultDate);
  $('#resCompleteWrap').innerHTML = `<label class="small"><input type="checkbox" id="resCompleted" ${date.completed ? 'checked' : ''}/> Marcar fecha como disputada (completada)</label>`;
  $('#resCompleted').addEventListener('change', async (e) => {
    await api(`/dates/${selectedResultDate}`, { method: 'PATCH', body: { completed: e.target.checked } });
    toast('Fecha actualizada');
  });
}

async function saveResult() {
  const body = {
    player_id: Number($('#resPlayer').value),
    date_id: selectedResultDate,
    course: $('#resCourse').value.trim() || null,
    gross_score: $('#resGross').value,
    handicap: $('#resHcp').value || null,
  };
  if (body.gross_score === '') return toast('Ingrese el score bruto', 'error');
  try {
    await api('/results', { method: 'POST', body });
    toast('Resultado guardado · neto calculado');
    $('#resGross').value = '';
    $('#resHcp').value = '';
    views.results();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------- Handicaps ------------------------------- */

let selectedHcpDate = null;

views.handicaps = async function () {
  const root = $('#view-handicaps');
  root.innerHTML = '<p class="muted">Cargando…</p>';
  const dates = await api('/dates');
  selectedHcpDate = selectedHcpDate || dates[0]?.id;

  root.innerHTML = `
    <h2>Handicaps oficiales</h2>
    <p class="subtitle">Handicap vigente por sábado. El historial se conserva para que los cálculos no cambien después.</p>
    <div class="notice">La Federación Colombiana de Golf no expone una API pública. Cargue los handicaps oficiales por CSV o manualmente antes de cada fecha. El botón "Sincronizar" queda listo para conectarse cuando exista una API.</div>
    <div class="section-actions">
      <div class="field"><label>Fecha (jornada)</label>
        <select id="hcpDate">${dates
          .map((d) => `<option value="${d.id}" ${d.id === selectedHcpDate ? 'selected' : ''}>${esc(d.name)}${d.play_date ? ' · ' + esc(d.play_date) : ''}</option>`)
          .join('')}</select></div>
      <button class="btn ghost" id="hcpSync">Sincronizar con Federación</button>
    </div>

    <div class="card">
      <h3>Importar por CSV</h3>
      <p class="small muted">Formato por línea: <code>nombre_o_id_federacion,handicap</code>. Ejemplo: <code>Juan Pérez,12.4</code></p>
      <textarea id="hcpCsv" placeholder="Juan Pérez,12.4&#10;María Gómez,8.1"></textarea>
      <div style="margin-top:10px"><button class="btn" id="hcpImport">Importar handicaps a la fecha</button></div>
    </div>

    <div class="card">
      <h3>Handicaps de la fecha</h3>
      <div id="hcpTable"></div>
    </div>
  `;

  $('#hcpDate').addEventListener('change', (e) => {
    selectedHcpDate = Number(e.target.value);
    views.handicaps();
  });
  $('#hcpImport').addEventListener('click', importHcp);
  $('#hcpSync').addEventListener('click', syncHcp);
  await renderHcpTable();
};

async function renderHcpTable() {
  const [detail, players] = await Promise.all([
    api(`/dates/${selectedHcpDate}/detail`),
    api('/players'),
  ]);
  const map = new Map(detail.handicaps.map((h) => [h.player_id, h]));
  const activePlayers = players.filter((p) => p.active);
  const wrap = $('#hcpTable');
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Jugador</th><th class="num">Handicap</th><th>Origen</th><th></th></tr></thead>
    <tbody>${activePlayers
      .map((p) => {
        const h = map.get(p.id);
        return `<tr>
          <td>${esc(p.name)}</td>
          <td class="num"><input type="number" step="0.1" style="width:90px" id="hcp-${p.id}" value="${h ? h.handicap : ''}" /></td>
          <td>${h ? `<span class="pill">${esc(h.source)}</span>` : '<span class="badge muted">sin cargar</span>'}</td>
          <td><button class="btn small" data-save="${p.id}">Guardar</button></td>
        </tr>`;
      })
      .join('')}</tbody></table></div>`;
  wrap.querySelectorAll('[data-save]').forEach((b) =>
    b.addEventListener('click', async () => {
      const val = $(`#hcp-${b.dataset.save}`).value;
      if (val === '') return toast('Ingrese un handicap', 'error');
      try {
        await api(`/dates/${selectedHcpDate}/handicaps`, {
          method: 'PUT',
          body: { player_id: Number(b.dataset.save), handicap: Number(val) },
        });
        toast('Handicap guardado');
        renderHcpTable();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

async function importHcp() {
  const csv = $('#hcpCsv').value;
  if (!csv.trim()) return toast('Pegue el CSV de handicaps', 'error');
  try {
    const res = await api(`/dates/${selectedHcpDate}/handicaps/import`, {
      method: 'POST',
      body: { csv },
    });
    let msg = `${res.applied} handicaps importados`;
    if (res.unmatched.length) msg += ` · sin coincidencia: ${res.unmatched.join(', ')}`;
    toast(msg, res.unmatched.length ? 'error' : 'ok');
    $('#hcpCsv').value = '';
    renderHcpTable();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function syncHcp() {
  try {
    await api(`/dates/${selectedHcpDate}/handicaps/sync`, { method: 'POST' });
    toast('Sincronizado');
    renderHcpTable();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------- Jugadores ------------------------------- */

views.players = async function () {
  const root = $('#view-players');
  root.innerHTML = '<p class="muted">Cargando…</p>';
  const players = await api('/players');
  root.innerHTML = `
    <h2>Jugadores <span class="pill">${players.length} / 40</span></h2>
    <p class="subtitle">Los administradores pueden agregar o retirar jugadores. Un jugador con resultados se retira (no se elimina) para conservar el historial.</p>
    <div class="card">
      <h3>Agregar jugador</h3>
      <div class="form-row">
        <div class="field"><label>Nombre</label><input id="plName" placeholder="Nombre y apellido" /></div>
        <div class="field"><label>ID Federación (opcional)</label><input id="plFed" placeholder="Nº federación" /></div>
        <button class="btn" id="plAdd">Agregar</button>
      </div>
    </div>
    <div class="card">
      <h3>Roster</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>ID Fed.</th><th>Estado</th><th></th></tr></thead>
        <tbody>${players.map(rowPlayer).join('') || '<tr><td colspan="4" class="muted">Sin jugadores.</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
  $('#plAdd').addEventListener('click', addPlayer);
  root.querySelectorAll('[data-profile]').forEach((b) =>
    b.addEventListener('click', () => showProfile(Number(b.dataset.profile)))
  );
  root.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/players/${b.dataset.toggle}`, { method: 'PATCH', body: { active: b.dataset.active === '0' } });
      toast('Jugador actualizado');
      views.players();
    })
  );
  root.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar jugador?')) return;
      try {
        await api(`/players/${b.dataset.del}`, { method: 'DELETE' });
        toast('Jugador eliminado');
        views.players();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
};

function rowPlayer(p) {
  return `<tr>
    <td><button class="link" data-profile="${p.id}">${esc(p.name)}</button></td>
    <td>${esc(p.federation_id || '—')}</td>
    <td><span class="badge ${p.active ? 'ok' : 'muted'}">${p.active ? 'Activo' : 'Retirado'}</span></td>
    <td><div class="row-actions">
      <button class="btn ghost small" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Retirar' : 'Reactivar'}</button>
      <button class="btn danger small" data-del="${p.id}">Eliminar</button>
    </div></td>
  </tr>`;
}

async function addPlayer() {
  const name = $('#plName').value.trim();
  if (!name) return toast('Ingrese el nombre', 'error');
  try {
    await api('/players', { method: 'POST', body: { name, federation_id: $('#plFed').value.trim() || null } });
    toast('Jugador agregado');
    views.players();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* --------------------------------- Fechas -------------------------------- */

views.dates = async function () {
  const root = $('#view-dates');
  root.innerHTML = '<p class="muted">Cargando…</p>';
  const dates = await api('/dates');
  root.innerHTML = `
    <h2>Fechas del torneo</h2>
    <p class="subtitle">10 fechas (sábados). Defina el campo y la fecha de cada jornada.</p>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Nombre</th><th>Fecha (sábado)</th><th>Campo por defecto</th><th>Estado</th><th></th></tr></thead>
      <tbody>${dates
        .map(
          (d) => `<tr>
        <td class="pos">${d.sequence}</td>
        <td>${esc(d.name)}</td>
        <td><input type="date" id="dt-date-${d.id}" value="${d.play_date || ''}" /></td>
        <td><input id="dt-course-${d.id}" value="${esc(d.default_course || '')}" placeholder="Campo" /></td>
        <td><span class="badge ${d.completed ? 'ok' : 'muted'}">${d.completed ? 'Disputada' : 'Pendiente'}</span></td>
        <td><button class="btn small" data-save="${d.id}">Guardar</button></td>
      </tr>`
        )
        .join('')}</tbody>
    </table></div></div>
  `;
  root.querySelectorAll('[data-save]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.save;
      await api(`/dates/${id}`, {
        method: 'PATCH',
        body: { play_date: $(`#dt-date-${id}`).value || null, default_course: $(`#dt-course-${id}`).value.trim() || null },
      });
      toast('Fecha guardada');
      views.dates();
    })
  );
};

/* ---------------------------- Perfil de jugador -------------------------- */

async function showProfile(id) {
  openModal('<p class="muted">Cargando perfil…</p>');
  try {
    const p = await api(`/players/${id}/profile`);
    const s = p.standing;
    openModal(`
      <h2 style="margin-top:0">${esc(p.player.name)}</h2>
      <p class="muted small">${p.player.federation_id ? 'ID Federación: ' + esc(p.player.federation_id) + ' · ' : ''}${p.player.active ? 'Activo' : 'Retirado'}</p>
      <div class="grid stats" style="margin:14px 0">
        <div class="stat"><div class="label">Total 6 mejores</div><div class="value small">${fmt(s.total)}</div></div>
        <div class="stat"><div class="label">Promedio neto</div><div class="value small">${fmt(s.netAverage)}</div></div>
        <div class="stat"><div class="label">Rondas jugadas</div><div class="value small">${s.roundsPlayed}</div></div>
        <div class="stat"><div class="label">Estado</div><div class="value small"><span class="badge ${s.eligible ? 'ok' : 'no'}">${s.eligible ? 'Elegible' : 'No elegible'}</span></div></div>
      </div>

      <h3 style="color:var(--green-700)">Historial y evolución</h3>
      ${
        p.results.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Campo</th><th class="num">Bruto</th><th class="num">Hcp</th><th class="num">Neto</th><th>Cuenta</th></tr></thead>
        <tbody>${p.results
          .map(
            (r) => `<tr>
          <td>${esc(r.date_name)}${r.play_date ? '<br><span class="small muted">' + esc(r.play_date) + '</span>' : ''}</td>
          <td>${esc(r.course || '—')}</td>
          <td class="num">${fmt(r.gross_score)}</td>
          <td class="num">${fmt(r.handicap_used)}</td>
          <td class="num"><b>${fmt(r.net_score)}</b></td>
          <td>${r.counting ? '<span class="badge ok">Top 6</span>' : '<span class="badge muted">descartada</span>'}</td>
        </tr>`
          )
          .join('')}</tbody></table></div>`
          : '<p class="muted">Aún no ha jugado ninguna ronda.</p>'
      }

      <h3 style="color:var(--green-700);margin-top:18px">Historial de handicaps</h3>
      ${
        p.handicaps.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th class="num">Handicap</th><th>Origen</th></tr></thead>
        <tbody>${p.handicaps
          .map((h) => `<tr><td>${esc(h.date_name)}</td><td class="num">${fmt(h.handicap)}</td><td><span class="pill">${esc(h.source)}</span></td></tr>`)
          .join('')}</tbody></table></div>`
          : '<p class="muted">Sin handicaps registrados.</p>'
      }
    `);
  } catch (err) {
    openModal(`<p class="notice">${esc(err.message)}</p>`);
  }
}

/* --------------------------------- Init ---------------------------------- */

switchView('dashboard');
