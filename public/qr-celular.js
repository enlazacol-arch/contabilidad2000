'use strict';
// ---------- Tarjeta "Fotografía con tu celular" (código QR) ----------
// Compartida por Escanear y Carga masiva (ver <script src="/qr-celular.js">).
//
// En un computador no tiene sentido "Tomar foto" (no hay cámara útil
// para una factura física): en su lugar se muestra un código QR que
// abre /captura-movil.html en el celular. Las fotos que se toman allá
// entran a Carga masiva del cliente elegido y se leen con la IA en el
// servidor (ver captura-movil.js).
//
//   QrCelular.montar(contenedor, { clientes, clienteId })

(function(){
  // Computador = puntero fino con hover y pantalla ancha. Una tableta o
  // un celular siguen viendo "Tomar foto" como siempre.
  function esComputador(){
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 880;
  }

  const CSS = `
  .qrc{ background:var(--surface); border:1px solid var(--line); border-radius:var(--r-md); box-shadow:var(--shadow-sm); padding:20px 22px; margin-top:16px; }
  .qrc-cuerpo{ display:flex; gap:22px; align-items:center; }
  .qrc-texto{ flex:1 1 auto; min-width:0; }
  .qrc h3{ margin:0; font-family:var(--font-display); font-size:var(--t-16, 16px); font-weight:800; color:var(--text); }
  .qrc p{ margin:6px 0 0; font-size:var(--t-13); color:var(--text-2); line-height:1.5; }
  .qrc-fila{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:14px; }
  .qrc-fila select{ min-height:38px; max-width:280px; font-family:var(--font-ui); font-size:var(--t-14); padding:6px 10px; border:1px solid var(--border-strong); border-radius:var(--r-sm); background:var(--surface); color:var(--text); }
  .qrc-fila select:focus{ outline:none; border-color:var(--pet-600); box-shadow:var(--focus-ring); }
  .qrc-codigo{ flex:0 0 auto; width:184px; height:184px; padding:8px; background:#fff; border:1px solid var(--line); border-radius:var(--r-sm); display:flex; align-items:center; justify-content:center; }
  .qrc-codigo svg{ width:100%; height:100%; display:block; }
  .qrc-codigo.vencido svg{ opacity:.12; }
  .qrc-codigo .qrc-ph{ color:var(--text-3); text-align:center; font-size:var(--t-12); }
  .qrc-codigo svg[aria-hidden]{ width:44px; height:44px; color:var(--n-400); }
  .qrc-meta{ margin-top:10px; font-size:var(--t-13); color:var(--text-2); display:grid; gap:3px; }
  .qrc-meta b{ color:var(--text); }
  .qrc-recibidas{ color:var(--ok); font-weight:700; }
  .qrc-alerta{ margin-top:10px; font-size:var(--t-12); color:var(--warn); background:var(--warn-bg); border-radius:var(--r-sm); padding:7px 10px; }
  .qrc-link{ font-size:var(--t-13); font-weight:600; color:var(--pet-600); text-decoration:none; }
  .qrc-link:hover{ text-decoration:underline; }
  `;

  function inyectarCss(){
    if (document.getElementById('qrc-css')) return;
    const s = document.createElement('style');
    s.id = 'qrc-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function hora(fecha){
    return new Date(fecha).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  }

  const ICONO_CELULAR = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';

  function montar(contenedor, opciones){
    inyectarCss();
    const clientes = (opciones && opciones.clientes) || [];
    let clienteId = (opciones && opciones.clienteId) || '';
    let sesion = null; // { id, qrSvg, expiraAt, redLocal, fotosRecibidas, estado }
    let sondeo = null;
    let cargando = false;

    const raiz = document.createElement('section');
    raiz.className = 'qrc';
    raiz.setAttribute('data-permiso', 'escritura');
    contenedor.appendChild(raiz);

    function nombreCliente(id){
      const c = clientes.find((x) => x.id === id);
      return c ? c.nombre : '';
    }

    function render(){
      const fijo = !!(opciones && opciones.clienteId);
      const activa = sesion && sesion.estado === 'activa';
      const selector = fijo ? '' : `
        <select id="qrcCliente" aria-label="Cliente al que van las fotos">
          <option value="">Escoge el cliente…</option>
          ${clientes.map((c) => `<option value="${esc(c.id)}" ${c.id === clienteId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
        </select>`;

      let codigo;
      if (sesion) {
        codigo = `<div class="qrc-codigo ${activa ? '' : 'vencido'}" role="img" aria-label="Código QR para tomar fotos desde el celular">${sesion.qrSvg}</div>`;
      } else {
        codigo = `<div class="qrc-codigo"><div class="qrc-ph">${ICONO_CELULAR}<div>El código aparece aquí</div></div></div>`;
      }

      let meta = '';
      if (sesion) {
        const n = sesion.fotosRecibidas || 0;
        const estadoTxt = {
          activa: `Válido hasta las <b>${hora(sesion.expiraAt)}</b>`,
          vencida: '<b>Este código venció.</b> Genera uno nuevo.',
          revocada: '<b>Código desactivado.</b>',
          llena: '<b>Este código llegó al máximo de fotos.</b> Genera uno nuevo.',
          inexistente: '<b>Código no disponible.</b>',
        }[sesion.estado] || '';
        const destino = `/masivo.html?cliente=${encodeURIComponent(sesion.clienteId)}`;
        meta = `<div class="qrc-meta">
          <span>Fotos para <b>${esc(nombreCliente(sesion.clienteId))}</b></span>
          <span>${estadoTxt}</span>
          ${n > 0 ? `<span class="qrc-recibidas">✓ ${n} ${n === 1 ? 'foto recibida' : 'fotos recibidas'}</span>
          ${location.pathname === '/masivo.html' ? '' : `<a class="qrc-link" href="${destino}">Revisarlas en Carga masiva →</a>`}` : ''}
        </div>
        ${sesion.redLocal && activa ? '<div class="qrc-alerta">Modo local: el celular debe estar conectado a la misma red Wi-Fi que este computador.</div>' : ''}`;
      }

      const botones = sesion && activa
        ? `<button type="button" class="btn ghost btn--sm" id="qrcNuevo">Generar otro</button>
           <button type="button" class="btn ghost btn--sm" id="qrcDesactivar">Desactivar</button>`
        : `<button type="button" class="btn primary btn--sm" id="qrcGenerar" ${cargando ? 'disabled' : ''}>${cargando ? 'Generando…' : (sesion ? 'Generar uno nuevo' : 'Mostrar código QR')}</button>`;

      raiz.innerHTML = `<div class="qrc-cuerpo">
        <div class="qrc-texto">
          <h3>¿Facturas en papel? Fotografíalas con tu celular</h3>
          <p>Escanea el código con la cámara del celular, toma las fotos ahí mismo y llegan solas a Carga masiva, ya leídas por la IA. No hace falta iniciar sesión en el celular.</p>
          <div class="qrc-fila">${selector}${botones}</div>
          ${meta}
        </div>
        ${codigo}
      </div>`;

      const sel = raiz.querySelector('#qrcCliente');
      if (sel) sel.addEventListener('change', (e) => { clienteId = e.target.value; if (sesion) { detenerSondeo(); sesion = null; } render(); });
      const g = raiz.querySelector('#qrcGenerar') || raiz.querySelector('#qrcNuevo');
      if (g) g.addEventListener('click', generar);
      const d = raiz.querySelector('#qrcDesactivar');
      if (d) d.addEventListener('click', desactivar);
    }

    async function generar(){
      if (!clienteId) {
        if (window.Aviso) Aviso.mostrar('Escoge primero el cliente al que van las fotos.', { tipo: 'error' });
        const sel = raiz.querySelector('#qrcCliente');
        if (sel) sel.focus();
        return;
      }
      cargando = true;
      render();
      try {
        const res = await fetch('/api/captura-movil', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clienteId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo generar el código QR.');
        sesion = { ...data, clienteId, estado: 'activa', fotosRecibidas: 0 };
        iniciarSondeo();
      } catch (err) {
        if (window.Aviso) Aviso.mostrar(err.message, { tipo: 'error' });
      } finally {
        cargando = false;
        render();
      }
    }

    async function desactivar(){
      if (!sesion) return;
      try { await fetch('/api/captura-movil/' + encodeURIComponent(sesion.id), { method: 'DELETE' }); } catch (e) { /* se ve igual como desactivado */ }
      sesion.estado = 'revocada';
      detenerSondeo();
      render();
    }

    // Cada 5 s (solo con la pestaña visible) se mira cuántas fotos han
    // llegado y si el código sigue vigente.
    async function consultar(){
      if (!sesion || document.hidden) return;
      try {
        const res = await fetch('/api/captura-movil/' + encodeURIComponent(sesion.id));
        if (!res.ok) return;
        const data = await res.json();
        const cambio = data.estado !== sesion.estado || data.fotosRecibidas !== sesion.fotosRecibidas;
        sesion.estado = data.estado;
        sesion.fotosRecibidas = data.fotosRecibidas;
        if (data.estado !== 'activa') detenerSondeo();
        if (cambio) render();
      } catch (e) { /* sin red un momento: se reintenta en el próximo ciclo */ }
    }
    function iniciarSondeo(){ detenerSondeo(); sondeo = setInterval(consultar, 5000); }
    function detenerSondeo(){ if (sondeo) { clearInterval(sondeo); sondeo = null; } }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) consultar(); });

    render();
    return raiz;
  }

  window.QrCelular = { montar, esComputador };
})();
