'use strict';
// ---------- Contabilidad anterior del cliente (para aprender desde el día 1) ----------
//
// Al crear un cliente, la contadora puede subir el Auxiliar General (o el
// Listado de Movimiento por Comprobante) que exporta su programa contable
// (Contai, Siigo, World Office...). De ahí Enlaza aprende, sin esperar a
// que se causen facturas en Enlaza:
//   - a qué cuenta lleva cada proveedor y para qué (detalle del movimiento);
//   - a qué proveedores les retiene, a qué tarifa y en qué cuenta, y a
//     cuáles no (documentos sobre la base sin retención);
//   - nombre de cada tercero con su NIT (para corregir NIT mal leídos);
//   - si el IVA llevado al gasto se controla en cuentas de orden (8395).
//
// Probado con la contabilidad real de Bosques de la Macarena (julio 2026):
// con lo aprendido de su auxiliar, la cuenta del gasto coincidió con la
// contadora en ~60% desde la primera factura (20-28% sin él).
//
// Isomórfico: en el navegador sus funciones quedan globales, en el
// servidor se usan con require().

const quitarTildesHC = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const encabezadoHC = (s) => quitarTildesHC(s).trim().toLowerCase().replace(/\s+/g, ' ');

// "C.R. URB. BOSQUES DE LA MACARENA P.H." -> "CR URB BOSQUES MACARENA PH"
// "GAMOEZ S.A.S." y "Gamoez SAS" -> "GAMOEZ". Para comparar el nombre leído
// en una factura con el de la contabilidad sin que la puntuación o la
// sigla societaria los separen.
const PALABRAS_SOCIETARIAS = new Set(['SAS', 'S', 'A', 'LTDA', 'SA', 'EU', 'ESP', 'E', 'P', 'CIA', 'Y', 'DE', 'LA', 'EL', 'LOS', 'LAS', 'DEL', 'BIC', 'SCA', 'CTA']);
function normalizarNombreTercero(nombre) {
  return quitarTildesHC(nombre).toUpperCase()
    .replace(/\./g, '').replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/).filter((p) => p && !PALABRAS_SOCIETARIAS.has(p)).join(' ');
}

const soloDigitosHC = (s) => String(s == null ? '' : s).replace(/[^0-9]/g, '');
// "43.263.757-1" -> "43263757"; "-0" o vacío -> ''.
function nitDeContabilidad(s) {
  const t = String(s == null ? '' : s).trim().replace(/-\s*\d$/, '');
  const d = soloDigitosHC(t);
  return d.length >= 5 ? d : '';
}
const numeroHC = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  // "1.234.567,89" (es-CO) o "1234567.89"
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// De la tabla (filas de celdas, como sale del Excel/CSV) a movimientos:
// { cuenta, nit, nombre, comprobante, documento, referencia, fecha,
//   detalle, debito, credito, base }. Reconoce dos formatos:
//   - Auxiliar General: Cuenta | ... | Nit | Nombre Nit | Nro Registro |
//     Comprobante | Fecha | Documento | Documento Referencia | Detalle |
//     ... | Débitos | Créditos | ...  (solo filas con Nro Registro)
//   - Listado de Movimiento por Comprobante: Comprobante | ... | Cuenta |
//     ... | Documento | Docto. Referencia | Detalle | Id (Db/Cr) | Nit |
//     ... | Valor | Valor Base
// Devuelve { formato, movimientos } o { error }.
function movimientosDesdeTabla(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  let iEnc = -1;
  for (let r = 0; r < Math.min(lista.length, 20); r++) {
    const h = (lista[r] || []).map(encabezadoHC);
    if (h.includes('cuenta') && h.some((x) => x === 'nit') && (h.some((x) => x.startsWith('debito')) || h.includes('valor'))) { iEnc = r; break; }
  }
  if (iEnc === -1) {
    return { error: 'No se reconoció el archivo. Sube el Auxiliar General o el Listado de Movimiento por Comprobante tal como lo exporta el programa contable (con columnas Cuenta, Nit, Detalle y Débitos/Créditos o Valor).' };
  }
  const h = lista[iEnc].map(encabezadoHC);
  const col = (...nombres) => { for (const n of nombres) { const i = h.indexOf(n); if (i !== -1) return i; } return -1; };
  const c = {
    cuenta: col('cuenta'), nit: col('nit'), nombre: col('nombre nit', 'nombre tercero', 'tercero'),
    registro: col('nro registro', 'no. registro', 'nro. registro', 'registro'),
    comprobante: col('comprobante'), fecha: col('fecha'), documento: col('documento'),
    referencia: col('documento referencia', 'docto. referencia', 'doc. referencia'), detalle: col('detalle'),
    debitos: h.findIndex((x) => x.startsWith('debito')), creditos: h.findIndex((x) => x.startsWith('credito')),
    valor: col('valor'), dc: col('id', 'naturaleza', 'db/cr'), base: col('valor base', 'base'),
  };
  const esAuxiliar = c.debitos !== -1 && c.creditos !== -1;
  const celda = (fila, i) => (i === -1 ? '' : fila[i]);
  const movimientos = [];
  for (let r = iEnc + 1; r < lista.length; r++) {
    const f = lista[r] || [];
    const cuenta = soloDigitosHC(celda(f, c.cuenta));
    if (!cuenta) continue;
    // En el auxiliar, las filas de resumen por cuenta no tienen registro.
    if (esAuxiliar && c.registro !== -1 && !String(celda(f, c.registro) || '').trim()) continue;
    let debito, credito;
    if (esAuxiliar) { debito = numeroHC(celda(f, c.debitos)); credito = numeroHC(celda(f, c.creditos)); }
    else {
      const valor = numeroHC(celda(f, c.valor));
      const esCredito = /^c/i.test(String(celda(f, c.dc) || '').trim());
      debito = esCredito ? 0 : valor; credito = esCredito ? valor : 0;
    }
    movimientos.push({
      cuenta,
      nit: nitDeContabilidad(celda(f, c.nit)),
      nombre: String(celda(f, c.nombre) || '').replace(/\s+/g, ' ').trim(),
      comprobante: String(celda(f, c.comprobante) || '').trim(),
      documento: String(celda(f, c.documento) || '').trim(),
      referencia: String(celda(f, c.referencia) || '').trim(),
      fecha: celda(f, c.fecha) instanceof Date ? celda(f, c.fecha).toISOString().slice(0, 10) : String(celda(f, c.fecha) || '').trim(),
      detalle: String(celda(f, c.detalle) || '').replace(/\s+/g, ' ').trim(),
      debito, credito, base: numeroHC(celda(f, c.base)),
    });
  }
  return { formato: esAuxiliar ? 'auxiliar' : 'listado', movimientos };
}

// Base mínima más baja de retención (servicios, 2 UVT de 2026): un
// documento por debajo de esto sin retención no dice nada.
const BASE_MINIMA_RETENCION_HC = 104748;
// Cuenta de retención -> categoría de Enlaza, según la tarifa.
function categoriaDeCuentaRetencion(cuenta, tarifa, nit) {
  const c = String(cuenta || '');
  const t = Math.round(Number(tarifa) * 1000) / 1000;
  if (c.startsWith('236540')) return 'compras';
  if (c.startsWith('236530')) return t === 0.035 ? 'arrendamiento_inmuebles' : 'arrendamiento_muebles';
  if (c.startsWith('236515')) return /^[89]\d{8}$/.test(String(nit || '')) ? 'honorarios_juridica' : 'honorarios_natural';
  if (c.startsWith('236525')) {
    if (t === 0.04 || t === 0.06) return 'servicios';
    if (t === 0.02) return 'vigilancia_aseo';
  }
  return '';
}

// Lo que se aprende de los movimientos: por proveedor (NIT), sus cuentas
// de gasto con los detalles, y cómo se le retiene. `pucCliente` (opcional)
// da la tarifa exacta de cada cuenta de retención (ej. 23652502 = 4%): el
// auxiliar no trae la base, y si el IVA se sumó al gasto, dividir por el
// gasto da una tarifa corrida (3,4% en vez de 4%).
function conocimientoDesdeMovimientos(movimientos, pucCliente) {
  const movs = Array.isArray(movimientos) ? movimientos : [];
  const tarifaDelPlan = (cuenta) => {
    const c = (Array.isArray(pucCliente) ? pucCliente : []).find((x) => String(x.codigo) === String(cuenta));
    return c && Number(c.porcentaje) > 0 ? Number(c.porcentaje) / 100 : null;
  };
  const terceros = {};
  movs.forEach((m) => { if (m.nit && m.nombre && !terceros[m.nit]) terceros[m.nit] = m.nombre; });
  // Un "documento" = mismo comprobante, número y tercero.
  const docs = new Map();
  movs.forEach((m) => {
    if (!m.nit) return;
    const k = `${m.comprobante}|${m.documento}|${m.nit}`;
    if (!docs.has(k)) docs.set(k, []);
    docs.get(k).push(m);
  });
  const cuentas = new Map(); // nit|cuenta -> {nit, cuenta, detalles:Set, veces, valor}
  const retencion = new Map(); // nit -> {...}
  let ivaCuentasOrden = false;
  for (const filas of docs.values()) {
    const nit = filas[0].nit;
    const gasto = filas.filter((m) => /^[567]/.test(m.cuenta) && m.debito > 0);
    if (filas.some((m) => /^8395/.test(m.cuenta) && m.debito > 0)) ivaCuentasOrden = true;
    if (gasto.length === 0) continue;
    for (const g of gasto) {
      const k = `${nit}|${g.cuenta}`;
      if (!cuentas.has(k)) cuentas.set(k, { nit, cuenta: g.cuenta, detalles: new Set(), veces: 0, valor: 0 });
      const e = cuentas.get(k);
      if (g.detalle) e.detalles.add(g.detalle);
      e.veces++; e.valor += g.debito;
    }
    const totalGasto = gasto.reduce((s, g) => s + g.debito, 0);
    const rete = filas.filter((m) => /^2365/.test(m.cuenta) && m.credito > 0);
    if (!retencion.has(nit)) retencion.set(nit, { nit, documentosSobreBase: 0, conRetencion: 0, tarifas: [] });
    const r = retencion.get(nit);
    if (totalGasto >= BASE_MINIMA_RETENCION_HC) r.documentosSobreBase++;
    if (rete.length > 0) {
      r.conRetencion++;
      // Base: la del movimiento si la trae (listado); si no, el gasto menos
      // el IVA controlado en cuentas de orden.
      const ivaOrden = filas.filter((m) => /^8395/.test(m.cuenta) && m.debito > 0).reduce((s, m) => s + m.debito, 0);
      for (const x of rete) {
        const delPlan = tarifaDelPlan(x.cuenta);
        const base = x.base > 0 ? x.base : totalGasto - ivaOrden;
        const tarifa = delPlan !== null ? delPlan : (base > 0 ? Math.round((x.credito / base) * 1000) / 1000 : null);
        if (tarifa !== null) r.tarifas.push({ cuenta: x.cuenta, tarifa });
      }
    }
  }
  return {
    terceros,
    cuentas: [...cuentas.values()].map((e) => ({ ...e, detalles: [...e.detalles].slice(0, 12) })),
    retencion: [...retencion.values()].map((r) => {
      const masComun = r.tarifas.length ? r.tarifas.sort((a, b) => r.tarifas.filter((t) => t.tarifa === b.tarifa).length - r.tarifas.filter((t) => t.tarifa === a.tarifa).length)[0] : null;
      return {
        nit: r.nit, documentosSobreBase: r.documentosSobreBase, conRetencion: r.conRetencion,
        noRetiene: r.conRetencion === 0 && r.documentosSobreBase > 0,
        tarifa: masComun ? masComun.tarifa : null, cuentaRetencion: masComun ? masComun.cuenta : '',
        categoria: masComun ? categoriaDeCuentaRetencion(masComun.cuenta, masComun.tarifa, r.nit) : '',
      };
    }),
    ivaCuentasOrden,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizarNombreTercero, nitDeContabilidad, movimientosDesdeTabla, conocimientoDesdeMovimientos, categoriaDeCuentaRetencion };
}
