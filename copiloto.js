'use strict';
// ---------- Copiloto de cuentas: lógica sin base de datos ----------
// Usado por POST /api/clients/:id/copiloto-cuentas (server.js) y por las
// pruebas con la contabilidad real de un cliente. Ver el comentario de esa
// ruta para el porqué.

const pucCliente = require('./public/puc-cliente');

const raices5 = (texto) => new Set(String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((p) => p.length >= 4).map((p) => p.slice(0, 5)));

// Cuentas de gasto del plan del cliente que se pueden ofrecer.
function planDeGasto(puc) {
  return (Array.isArray(puc) ? puc : []).filter((c) => /^5/.test(String(c.codigo)) && pucCliente.cuentaUsable(c)
    && !/^\s*IVA\b/i.test(String(c.concepto || '')) && !pucCliente.motivoObsoleta(c.codigo, c.concepto));
}

// Si con este proveedor siempre se usó la misma cuenta, esa ('' si no).
// Con poca historia (1-2 movimientos) solo si el concepto se parece: en
// Bosques, a la administradora solo se le había pagado un transporte, y
// su cuenta de cobro de administración no va a transporte.
function cuentaUnicaDelProveedor(ejemplos, nit, textoFactura) {
  const delProveedor = (ejemplos || []).filter((e) => nit && e.nit === nit);
  const cuentas = [...new Set(delProveedor.map((e) => e.cuenta))];
  if (cuentas.length !== 1) return '';
  const veces = delProveedor.reduce((s, e) => s + (Number(e.veces) || 1), 0);
  if (veces >= 3 || textoFactura === undefined) return cuentas[0];
  const delTexto = raices5(textoFactura);
  const seParece = delProveedor.some((e) => [...raices5(e.detalle)].some((r) => delTexto.has(r)));
  return seParece ? cuentas[0] : '';
}

// Los ejemplos más pertinentes: primero los del proveedor, luego los de
// conceptos parecidos a los ítems, luego los más usados.
function elegirEjemplos(ejemplos, nit, textoFactura, maximo = 60) {
  const delTexto = raices5(textoFactura);
  const puntaje = (e) => (nit && e.nit === nit ? 1000 : 0) + [...raices5(e.detalle)].filter((r) => delTexto.has(r)).length * 10 + Math.min(Number(e.veces) || 1, 9);
  return [...(ejemplos || [])].sort((a, b) => puntaje(b) - puntaje(a)).slice(0, maximo);
}

function construirPromptCopiloto({ plan, ejemplos, nit, nombre, concepto, items }) {
  const nombreCuenta = new Map(plan.map((c) => [String(c.codigo), String(c.concepto).trim()]));
  return `Eres el auxiliar contable de este cliente en Colombia. Escoge, para cada ítem de esta factura de compra, la cuenta de gasto del plan de cuentas PROPIO del cliente donde lo causaría su contadora.

Plan de cuentas de gasto del cliente (código - nombre), usa SOLO estos códigos:
${plan.map((c) => `${c.codigo} - ${String(c.concepto).trim()}`).join('\n')}

${ejemplos.length ? `Así ha causado esta contadora otras compras de este cliente (proveedor | detalle | cuenta) -- síguelos como criterio:\n${ejemplos.map((e) => `${e.nombre || e.nit} | ${e.detalle} | ${e.cuenta} ${nombreCuenta.get(e.cuenta) || ''}`).join('\n')}\n` : ''}
Factura: proveedor ${String(nombre || '').slice(0, 120)} (NIT ${nit || 'sin NIT'}), concepto: ${String(concepto || '').slice(0, 300)}.
Ítems:
${items.map((it, i) => `${i}. ${it.descripcion} -- $${it.subtotal}`).join('\n')}

Usa UNA sola cuenta para toda la factura, salvo que los ítems sean de naturaleza claramente distinta (ej. productos de aseo y útiles de papelería en la misma factura). Si el proveedor ya aparece en los ejemplos, usa la cuenta que la contadora le ha usado, salvo que el concepto sea claramente otro.

Responde SOLO JSON: {"cuentas": [{"indice": 0, "codigo": "..."}]} con un elemento por ítem.`;
}

// Valida la respuesta de la IA: índices existentes y códigos del plan.
function cuentasValidas(respuesta, items, plan) {
  const enPlan = new Set(plan.map((c) => String(c.codigo)));
  return (Array.isArray(respuesta && respuesta.cuentas) ? respuesta.cuentas : [])
    .map((c) => ({ indice: Number(c.indice), codigo: String(c.codigo || '').trim() }))
    .filter((c) => Number.isInteger(c.indice) && c.indice >= 0 && c.indice < items.length && enPlan.has(c.codigo));
}

module.exports = { planDeGasto, cuentaUnicaDelProveedor, elegirEjemplos, construirPromptCopiloto, cuentasValidas };
