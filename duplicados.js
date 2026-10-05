'use strict';
// ---------- ¿Esta factura ya se causó? ----------
//
// La misma factura no se debe causar dos veces. Antes solo se detectaba
// el mismo archivo (mismos bytes) o el mismo NIT + número. Con las
// facturas reales de Bosques quedaban huecos:
//   - cuentas de cobro y servicios públicos sin número (IMB, Darío): la
//     misma, fotografiada dos veces, se guardaba dos veces;
//   - el NIT mal leído (GAMOEZ 39712 salió una vez 900627469): con otro
//     NIT, "mismo NIT y número" no la reconocía;
//   - el mismo gasto con dos soportes de distinto emisor (la reparación
//     del shut: cuenta de cobro de P.B.L. y de Darío por $2.100.000).
//
// evaluarDuplicado() decide, sin base de datos, con las facturas ya
// guardadas que podrían coincidir (las busca server.js). Devuelve
// { motivo, mensaje, existente } o null. Reglas, de más segura a más
// dudosa (todas se pueden saltar con "Guardar de todas formas"):
//   archivo      - mismo archivo
//   numero       - mismo NIT y mismo número
//   numero_valor - mismo número y mismo valor, con otro NIT (NIT mal leído)
//   sin_numero   - sin número: mismo NIT, mismo valor y misma fecha
//   mismo_gasto  - mismo cliente, mismo valor (desde $100.000), fechas a
//                  15 días o menos y el mismo concepto, de otro emisor

const soloDigitosDup = (s) => String(s == null ? '' : s).replace(/-\s*\d$/, '').replace(/[^0-9]/g, '');
const numeroFactura = (s) => String(s == null ? '' : s).replace(/[^0-9a-z]/gi, '').replace(/^0+/, '').toUpperCase();
const valorEntero = (v) => { const n = Math.round(Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''))); return Number.isFinite(n) ? n : 0; };
// "dd/mm/aaaa" -> días desde 1970 (o null).
function diaDeFecha(f) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(f || '').trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 86400000);
}
const PALABRAS_VACIAS_DUP = new Set(['SERVI', 'PAGO', 'FACTU', 'CUENT', 'COBRO', 'VALOR', 'TOTAL', 'SEGUN', 'PARA', 'CONJU', 'RESID', 'URBAN']);
const raicesDup = (t) => new Set(String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((p) => p.length >= 4).map((p) => p.slice(0, 5)).filter((r) => !PALABRAS_VACIAS_DUP.has(r)));
const nombreFactura = (f) => `${f.letras_fe || ''}${f.numeros_fe || ''}`.trim();

const VALOR_MINIMO_MISMO_GASTO = 100000;
const DIAS_MISMO_GASTO = 15;

function evaluarDuplicado(nueva, candidatas, opciones = {}) {
  const lista = Array.isArray(candidatas) ? candidatas : [];
  const nit = soloDigitosDup(nueva.nit_cc);
  const numero = numeroFactura(nueva.numeros_fe);
  const valor = valorEntero(nueva.valor_con_iva);
  const dia = diaDeFecha(nueva.fecha_factura);
  const quien = (f) => `${f.nombre_razon_social || 'otro proveedor'}${nombreFactura(f) ? ` (factura ${nombreFactura(f)})` : ''}`;

  if (nueva.file_hash) {
    const e = lista.find((f) => f.file_hash && f.file_hash === nueva.file_hash);
    if (e) return { motivo: 'archivo', mensaje: 'Este mismo archivo ya se guardó antes.', existente: e };
  }
  if (nit && numero) {
    const e = lista.find((f) => soloDigitosDup(f.nit_cc) === nit && numeroFactura(f.numeros_fe) === numero);
    if (e) return { motivo: 'numero', mensaje: `Ya existe una factura de este proveedor con el número ${nombreFactura(nueva)}.`, existente: e };
  }
  if (numero.length >= 3 && valor > 0) {
    const e = lista.find((f) => numeroFactura(f.numeros_fe) === numero && valorEntero(f.valor_con_iva) === valor && soloDigitosDup(f.nit_cc) !== nit);
    if (e) return { motivo: 'numero_valor', mensaje: `Ya existe una factura con el mismo número y el mismo valor: ${quien(e)}, NIT ${soloDigitosDup(e.nit_cc) || 'sin NIT'}. Puede que el NIT se haya leído mal.`, existente: e };
  }
  if (!numero && valor > 0 && dia !== null) {
    const e = lista.find((f) => (!nit || soloDigitosDup(f.nit_cc) === nit) && valorEntero(f.valor_con_iva) === valor && diaDeFecha(f.fecha_factura) === dia);
    if (e) return { motivo: 'sin_numero', mensaje: `Ya existe un documento ${nit ? 'de este proveedor ' : ''}sin número con el mismo valor y la misma fecha: ${quien(e)}.`, existente: e };
  }
  if (opciones.clienteId && valor >= VALOR_MINIMO_MISMO_GASTO && dia !== null) {
    const delConcepto = raicesDup(`${nueva.concepto || ''} ${(nueva.items || []).map((it) => it.descripcion || '').join(' ')}`);
    const e = lista.find((f) => {
      if (f.cliente_id !== opciones.clienteId || valorEntero(f.valor_con_iva) !== valor) return false;
      if (nit && soloDigitosDup(f.nit_cc) === nit) return false; // mismo emisor: lo cubren las reglas de arriba
      const d = diaDeFecha(f.fecha_factura);
      if (d === null || Math.abs(d - dia) > DIAS_MISMO_GASTO) return false;
      const comunes = [...raicesDup(f.concepto)].filter((r) => delConcepto.has(r)).length;
      return comunes >= 2;
    });
    if (e) return { motivo: 'mismo_gasto', mensaje: `Parece el mismo gasto que ${quien(e)}: mismo valor, fechas cercanas y el mismo concepto. Puede ser un segundo soporte (cotización, cuenta de cobro) del mismo pago.`, existente: e };
  }
  return null;
}

module.exports = { evaluarDuplicado, numeroFactura, valorEntero, diaDeFecha, soloDigitosDup };
