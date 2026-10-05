'use strict';
// ---------- Facturas leídas sin guardar, por cliente ----------
//
// Compartido por Inicio, Clientes y la ficha del cliente. Muestra lo que
// quedó a medias en Escanear o Carga masiva: facturas que la IA ya leyó
// pero nadie guardó (alguien se salió y las dejó ahí), de cualquier
// persona de la firma, con quién las dejó y desde cuándo
// (GET /api/pendientes). Las guardadas sin aprobar son otra cosa (esperan
// en Revisión) y solo se mencionan aparte en la ficha del cliente.

let PENDIENTES_POR_CLIENTE = null; // clienteId -> {leidas, leidas_total, borradores}

async function cargarPendientes() {
  try {
    const res = await fetch('/api/pendientes');
    if (!res.ok) return new Map();
    const lista = await res.json();
    PENDIENTES_POR_CLIENTE = new Map(lista.map((p) => [p.cliente_id || '', p]));
  } catch (e) {
    PENDIENTES_POR_CLIENTE = new Map();
  }
  return PENDIENTES_POR_CLIENTE;
}

function pendientesDeCliente(clienteId) {
  return (PENDIENTES_POR_CLIENTE && PENDIENTES_POR_CLIENTE.get(clienteId || '')) || null;
}

// ¿Tiene facturas leídas sin guardar?
function tieneSinGuardar(clienteId) {
  const p = pendientesDeCliente(clienteId);
  return !!(p && p.leidas_total > 0);
}

const escaparPendientes = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "hace 3 horas", "hace 2 días"
function haceCuanto(fecha) {
  const t = new Date(fecha).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (min < 60) return `hace ${min} minuto${min === 1 ? '' : 's'}`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} hora${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

// "3 tuyas · 2 de Mafe"
function quienesTienenLeidas(p) {
  return p.leidas.map((l) => (l.propias ? `${l.cantidad} tuya${l.cantidad === 1 ? '' : 's'}` : `${l.cantidad} de ${l.usuario}`)).join(' · ');
}
const masAntigua = (p) => p.leidas.reduce((min, l) => (!min || new Date(l.desde) < new Date(min) ? l.desde : min), null);
const propiasDe = (p) => p.leidas.filter((l) => l.propias).reduce((s, l) => s + l.cantidad, 0);

// Marca corta para listas de clientes: solo las leídas sin guardar.
function badgePendientesHtml(clienteId) {
  const p = pendientesDeCliente(clienteId);
  if (!p || !p.leidas_total) return '';
  const detalle = `${quienesTienenLeidas(p)}. La más antigua, ${haceCuanto(masAntigua(p))}.`;
  return `<span class="pend-badge" title="${escaparPendientes(detalle)}">${p.leidas_total} sin guardar</span>`;
}

// Una fila del recuadro de Inicio.
function filaPendientesHtml(cliente) {
  const p = pendientesDeCliente(cliente.id);
  if (!p || !p.leidas_total) return '';
  const qs = cliente.id ? '?cliente=' + encodeURIComponent(cliente.id) : '';
  const destino = propiasDe(p) > 0 ? `/masivo.html${qs}` : (cliente.id ? `/cliente.html?id=${encodeURIComponent(cliente.id)}` : '/masivo.html');
  return `<a class="pend-fila" href="${destino}">
    <span class="pend-fila-info"><span class="pend-fila-nombre">${escaparPendientes(cliente.nombre)}</span>
      <span class="pend-fila-detalle">${escaparPendientes(quienesTienenLeidas(p))} · la más antigua ${escaparPendientes(haceCuanto(masAntigua(p)))}</span></span>
    <span class="pend-badge">${p.leidas_total} sin guardar</span>
  </a>`;
}

// Aviso para la ficha del cliente, con enlaces a donde se terminan.
function avisoPendientesHtml(clienteId) {
  const p = pendientesDeCliente(clienteId);
  if (!p) return '';
  const qs = '?cliente=' + encodeURIComponent(clienteId);
  const lineas = [];
  if (p.leidas_total) {
    const propias = propiasDe(p);
    const ajenas = p.leidas.filter((l) => !l.propias);
    lineas.push(`<div><b>${p.leidas_total} factura${p.leidas_total === 1 ? '' : 's'} leída${p.leidas_total === 1 ? '' : 's'} sin guardar</b> (${escaparPendientes(quienesTienenLeidas(p))}, la más antigua ${escaparPendientes(haceCuanto(masAntigua(p)))}).
      ${propias ? `<a class="pend-link" href="/masivo.html${qs}">Revisar y guardar las tuyas →</a>` : ''}
      ${ajenas.length ? `<span class="pend-nota">Las de ${escaparPendientes(ajenas.map((l) => l.usuario).join(' y '))} las termina quien las subió.</span>` : ''}</div>`);
  }
  if (p.borradores) {
    const n = p.borradores;
    lineas.push(`<div${p.leidas_total ? ' class="pend-secundaria"' : ''}><b>${n} factura${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} sin aprobar.</b>
      Mientras no ${n === 1 ? 'se apruebe' : 'se aprueben'}, no ${n === 1 ? 'cuenta' : 'cuentan'} en los totales, el kárdex ni los reportes de este cliente.
      <a class="pend-link" href="/revision.html${qs}">Revisar y aprobar →</a></div>`);
  }
  if (!lineas.length) return '';
  const titulo = p.leidas_total && p.borradores ? 'Pendientes de este cliente'
    : p.leidas_total ? 'Facturas sin guardar de este cliente' : 'Facturas por aprobar de este cliente';
  return `<div class="pend-aviso"><div class="pend-titulo">${titulo}</div>${lineas.join('')}</div>`;
}

(function estilosPendientes() {
  if (typeof document === 'undefined' || document.getElementById('estilosPendientes')) return;
  const st = document.createElement('style');
  st.id = 'estilosPendientes';
  // Colores del sistema (azul petróleo), no de alerta: es trabajo a medias,
  // no un error.
  st.textContent = `
    .pend-badge{ display:inline-flex; align-items:center; padding:2px 9px; border-radius:var(--r-pill, 999px);
      background:var(--pet-100); color:var(--pet-600); border:1px solid var(--pet-200); font-size:var(--t-12); font-weight:700; white-space:nowrap; }
    .pend-aviso{ margin:0 0 16px; padding:12px 14px; border:1px solid var(--pet-200); border-left:4px solid var(--pet-600); border-radius:var(--r-md, 10px);
      background:var(--pet-50); color:var(--ink); font-size:var(--t-13); display:flex; flex-direction:column; gap:6px; }
    .pend-titulo{ font-weight:700; color:var(--pet-800); }
    .pend-link{ font-weight:700; color:var(--pet-600); margin-left:6px; white-space:nowrap; }
    .pend-nota{ color:var(--ink-soft); margin-left:6px; }
    .pend-secundaria{ color:var(--ink-soft); }
    .pend-fila{ display:flex; justify-content:space-between; align-items:center; gap:12px; color:var(--ink); text-decoration:none; padding:6px 0; }
    .pend-fila + .pend-fila{ border-top:1px solid var(--pet-200); }
    .pend-fila-info{ display:flex; flex-direction:column; gap:2px; min-width:0; }
    .pend-fila-nombre{ font-size:var(--t-14); font-weight:600; }
    .pend-fila-detalle{ font-size:var(--t-12); color:var(--ink-soft); }
    .pend-fila:hover .pend-fila-nombre{ color:var(--pet-600); text-decoration:underline; }
  `;
  document.head.appendChild(st);
})();
