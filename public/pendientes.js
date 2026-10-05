'use strict';
// ---------- Pendientes por revisar, por cliente ----------
//
// Compartido por Inicio, Clientes y la ficha del cliente. Muestra, para
// cada cliente, lo que quedó a medias (GET /api/pendientes):
//   - facturas leídas en Escanear/Carga masiva que nadie ha guardado,
//     con quién las subió ("3 tuyas · 2 de Mafe");
//   - facturas guardadas sin aprobar, que esperan en Revisión.
// Así nadie de la firma pierde de vista lo que otro (o uno mismo, en otro
// aparato) dejó sin terminar.

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

const escaparPendientes = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "3 tuyas · 2 de Mafe"
function quienesTienenLeidas(p) {
  return p.leidas.map((l) => (l.propias ? `${l.cantidad} tuya${l.cantidad === 1 ? '' : 's'}` : `${l.cantidad} de ${l.usuario}`)).join(' · ');
}

// Marca corta para listas de clientes.
function badgePendientesHtml(clienteId) {
  const p = pendientesDeCliente(clienteId);
  if (!p) return '';
  const total = p.leidas_total + p.borradores;
  const partes = [];
  if (p.leidas_total) partes.push(`${p.leidas_total} leída${p.leidas_total === 1 ? '' : 's'} sin guardar (${quienesTienenLeidas(p)})`);
  if (p.borradores) partes.push(`${p.borradores} sin aprobar en Revisión`);
  return `<span class="pend-badge" title="${escaparPendientes(partes.join('. '))}">${total} por revisar</span>`;
}

// Aviso para la ficha del cliente, con enlaces a donde se terminan.
function avisoPendientesHtml(clienteId) {
  const p = pendientesDeCliente(clienteId);
  if (!p) return '';
  const qs = '?cliente=' + encodeURIComponent(clienteId);
  const lineas = [];
  if (p.leidas_total) {
    const propias = p.leidas.filter((l) => l.propias).reduce((s, l) => s + l.cantidad, 0);
    const ajenas = p.leidas.filter((l) => !l.propias);
    lineas.push(`<div><b>${p.leidas_total} factura${p.leidas_total === 1 ? '' : 's'} leída${p.leidas_total === 1 ? '' : 's'} sin guardar</b> (${escaparPendientes(quienesTienenLeidas(p))}).
      ${propias ? `<a class="pend-link" href="/masivo.html${qs}">Revisar las tuyas en Carga masiva →</a>` : ''}
      ${ajenas.length ? `<span class="pend-nota">Las de ${escaparPendientes(ajenas.map((l) => l.usuario).join(' y '))} las termina quien las subió.</span>` : ''}</div>`);
  }
  if (p.borradores) {
    lineas.push(`<div><b>${p.borradores} guardada${p.borradores === 1 ? '' : 's'} sin aprobar.</b> <a class="pend-link" href="/revision.html${qs}">Aprobar en Revisión →</a></div>`);
  }
  return `<div class="pend-aviso"><div class="pend-titulo">Pendientes por revisar de este cliente</div>${lineas.join('')}</div>`;
}

(function estilosPendientes() {
  if (typeof document === 'undefined' || document.getElementById('estilosPendientes')) return;
  const st = document.createElement('style');
  st.id = 'estilosPendientes';
  st.textContent = `
    .pend-badge{ display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:var(--r-pill, 999px);
      background:var(--warn-bg); color:var(--warn); font-size:var(--t-12); font-weight:700; white-space:nowrap; }
    .pend-aviso{ margin:0 0 16px; padding:12px 14px; border:1px solid var(--warn); border-left-width:4px; border-radius:var(--r-md, 10px);
      background:var(--warn-bg); color:var(--ink); font-size:var(--t-13); display:flex; flex-direction:column; gap:6px; }
    .pend-titulo{ font-weight:700; color:var(--warn); }
    .pend-link{ font-weight:700; color:var(--pet-600); margin-left:6px; white-space:nowrap; }
    .pend-nota{ color:var(--ink-soft); margin-left:6px; }
  `;
  document.head.appendChild(st);
})();
