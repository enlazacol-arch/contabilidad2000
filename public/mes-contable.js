'use strict';
// ---------- Mes contable de una factura ----------
// Una cosa es la fecha de EMISIÓN (fecha_factura, la que trae el
// documento) y otra el MES CONTABLE en que el contador la causa: una
// factura emitida en agosto que llega tarde puede hacer parte de la
// contabilidad de octubre. El contador decide el mes (no se llena
// solo); es obligatorio para aprobarla en Revisión.
//
// Los reportes contables (Facturas, Ingresos/Egresos, Balance, Listado
// de retenciones, Informe de auditoría) agrupan por mes contable; la
// fecha de emisión se sigue mostrando y guardando tal cual.
//
// Se carga como <script> en el navegador y con require() en server.js.

const MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function mesContableValido(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ''));
  return !!(m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2100);
}

// "DD/MM/AAAA" -> "AAAA-MM" ('' si la fecha no es válida).
function mesDeFecha(fecha) {
  const [d, m, y] = String(fecha || '').split('/');
  if (!d || !m || !/^\d{4}$/.test(String(y || '').trim())) return '';
  const mes = `${String(y).trim()}-${String(m).trim().padStart(2, '0')}`;
  return mesContableValido(mes) ? mes : '';
}

// El mes en que la factura cuenta para la contabilidad: el que eligió el
// contador o, si todavía no lo eligió (facturas de antes de este cambio
// o pendientes de revisar), el de emisión.
function mesContableDeFactura(inv) {
  if (inv && mesContableValido(inv.mes_contable)) return inv.mes_contable;
  return mesDeFecha(inv && inv.fecha_factura) || null;
}

function mesActual(hoy) {
  const d = hoy || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nombreMesContable(mes) {
  if (!mesContableValido(mes)) return '';
  const [y, m] = mes.split('-');
  return `${MESES_NOMBRE[Number(m) - 1]} ${y}`;
}

// Fecha del asiento contable: la de emisión si cae en el mes contable;
// si no (factura causada en otro mes), el último día del mes contable --
// así el asiento queda dentro del periodo en que se causó.
function fechaAsientoContable(inv) {
  const fecha = String((inv && inv.fecha_factura) || '');
  const mes = inv && inv.mes_contable;
  if (!mesContableValido(mes) || mesDeFecha(fecha) === mes) return fecha;
  const [y, m] = mes.split('-').map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  return `${String(ultimoDia).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// ---------- Selector en pantalla (navegador) ----------
// Una fila de meses para elegir de un clic: desde el mes de emisión hasta
// el mes actual (una factura se causa en ese rango casi siempre), con
// "emisión" y "actual" marcados, y "Otro mes…" para cualquier otro. El
// elegido queda resaltado. Nunca elige solo: arranca con `valor` (vacío
// si nadie lo ha elegido).
//   renderSelectorMesContable(contenedor, { valor, fechaFactura, obligatorio, alCambiar })
// Devuelve el <input type="month"> (lleva el valor; oculto hasta "Otro mes…").

// Meses que se ofrecen como botón: de la emisión al actual; si son más de
// 4, la emisión y los 3 últimos. Si la emisión es posterior al mes actual
// (fecha mal leída), solo esos dos.
function mesesSugeridos(mesEmision, actual) {
  const sumar = (mes, n) => {
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  if (!mesContableValido(mesEmision) || mesEmision > actual) {
    return [mesEmision, actual].filter((m, i, a) => mesContableValido(m) && a.indexOf(m) === i).sort();
  }
  const rango = [];
  for (let m = mesEmision; m <= actual && rango.length < 25; m = sumar(m, 1)) rango.push(m);
  return rango.length <= 4 ? rango : [rango[0], ...rango.slice(-3)];
}

function renderSelectorMesContable(contenedor, opciones) {
  if (!contenedor) return null;
  const op = opciones || {};
  const wrap = document.createElement('div');
  wrap.className = 'mes-contable';

  const input = document.createElement('input');
  input.type = 'month';
  input.className = 'input mes-contable-input';
  input.value = mesContableValido(op.valor) ? op.valor : '';
  input.setAttribute('aria-label', 'Mes contable');
  if (op.obligatorio) input.setAttribute('aria-required', 'true');

  const fila = document.createElement('div');
  fila.className = 'mes-contable-opciones';
  fila.setAttribute('role', 'group');
  fila.setAttribute('aria-label', 'Mes contable');

  const ayuda = document.createElement('div');
  ayuda.className = 'fine mes-contable-ayuda';

  const mesEmision = mesDeFecha(op.fechaFactura);
  const actual = mesActual();
  const sugeridos = mesesSugeridos(mesEmision, actual);

  const fijar = (mes) => {
    input.value = mes;
    actualizar();
    if (typeof op.alCambiar === 'function') op.alCambiar(mes);
  };
  sugeridos.forEach((mes) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mes-atajo';
    b.dataset.mes = mes;
    b.setAttribute('aria-pressed', 'false');
    const [y, m] = mes.split('-');
    const etiqueta = mes === mesEmision ? 'emisión' : (mes === actual ? 'actual' : '');
    b.innerHTML = `<span class="mes-atajo-nombre">${MESES_NOMBRE[Number(m) - 1].slice(0, 3)} ${y}</span>${etiqueta ? `<span class="mes-atajo-etiqueta">${etiqueta}</span>` : ''}`;
    b.title = `${nombreMesContable(mes)}${etiqueta ? ' (mes de ' + etiqueta + ')' : ''}`;
    b.addEventListener('click', () => fijar(mes));
    fila.appendChild(b);
  });
  const otro = document.createElement('button');
  otro.type = 'button';
  otro.className = 'mes-atajo mes-atajo-otro';
  otro.innerHTML = '<span class="mes-atajo-nombre">Otro mes…</span>';
  otro.addEventListener('click', () => {
    input.hidden = false;
    input.focus();
    if (typeof input.showPicker === 'function') { try { input.showPicker(); } catch (e) { /* algunos navegadores no lo permiten */ } }
  });
  fila.appendChild(otro);
  // El selector de mes del navegador solo se muestra si hace falta: con
  // "Otro mes…" o si el mes elegido no está entre los botones.
  input.hidden = !(input.value && !sugeridos.includes(input.value));

  function actualizar() {
    const mes = input.value;
    const enBotones = sugeridos.includes(mes);
    fila.querySelectorAll('.mes-atajo').forEach((b) => {
      const activo = b.dataset.mes ? b.dataset.mes === mes : (!!mes && !enBotones);
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
    if (!mesContableValido(mes)) {
      ayuda.textContent = op.obligatorio
        ? 'Elige en qué mes contable se causa esta factura -- es obligatorio para aprobarla.'
        : 'Elige en qué mes contable se causa (puedes dejarlo para Revisión).';
      ayuda.style.color = op.obligatorio ? 'var(--err, #B42318)' : '';
    } else if (mesEmision && mes !== mesEmision) {
      ayuda.textContent = `Emitida en ${nombreMesContable(mesEmision)}, se causa en ${nombreMesContable(mes)}.`;
      ayuda.style.color = 'var(--warn, #8A5A00)';
    } else {
      ayuda.textContent = `Se causa en ${nombreMesContable(mes)}, el mismo mes de emisión.`;
      ayuda.style.color = '';
    }
  }
  input.addEventListener('change', () => {
    actualizar();
    if (typeof op.alCambiar === 'function') op.alCambiar(mesContableValido(input.value) ? input.value : '');
  });

  wrap.appendChild(fila);
  wrap.appendChild(input);
  wrap.appendChild(ayuda);
  contenedor.appendChild(wrap);
  actualizar();
  return input;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mesContableValido, mesDeFecha, mesContableDeFactura, mesActual, nombreMesContable, fechaAsientoContable, mesesSugeridos };
}
