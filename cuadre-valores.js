'use strict';

// ---------- Subtotal leído que no cuadra con la propia factura ----------
//
// Caso real (Manos Activas SI 43076, Carga masiva, 9 oct. 2026): la
// factura tiene dos líneas -- "SERVICIO ASEO" $2.909.057 con IVA 0% y
// "AIU" $290.906 con IVA 19% ($55.272). La IA leyó bien las dos líneas,
// pero como "valor sin IVA" tomó solo la parte GRAVADA ($290.906), y el
// total quedó en $346.178 en vez de $3.255.235.
//
// La misma factura lo contradecía por dos lados: las líneas suman
// $3.199.963, y el valor en LETRAS dice $3.255.235 = líneas + IVA. Cuando
// esas dos pruebas coinciden entre sí y el subtotal leído no, se usa la
// suma de las líneas. Sin el valor en letras no hay árbitro y no se toca
// nada (queda el aviso "ítems no coinciden" de siempre).

function itemsDe(datos) {
  if (Array.isArray(datos.items)) return datos.items;
  if (typeof datos.items === 'string') {
    try { const x = JSON.parse(datos.items); return Array.isArray(x) ? x : []; } catch (e) { return []; }
  }
  return [];
}

function pesos(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
}

// Muta `datos` si corresponde. Devuelve true si corrigió algo.
function corregirSubtotalConItems(datos) {
  if (!datos || typeof datos !== 'object') return false;
  const items = itemsDe(datos);
  if (items.length === 0) return false;
  const sumaItems = items.reduce((s, it) => s + (Number(it && it.subtotal) || 0), 0);
  const subtotal = Number(datos.valor_sin_iva) || 0;
  const iva = Number(datos.valor_iva) || 0;
  const total = Number(datos.valor_con_iva) || 0;
  // Árbitro: el valor en letras o, si no hay, el total a pagar impreso
  // (prompt v6) -- los dos los escribe el propio documento.
  const letras = Number(datos.valor_letras_numero) || Number(datos.total_a_pagar_impreso) || 0;
  if (!(sumaItems > 0) || !(letras > 0)) return false;
  const cerca = (a, b) => Math.abs(a - b) <= 1;
  if (cerca(sumaItems, subtotal)) return false;      // ya cuadra
  if (cerca(total, letras)) return false;            // el total leído ya es el del documento
  if (!cerca(sumaItems + iva, letras)) return false; // las líneas tampoco cuadran con las letras: no se adivina

  datos.valor_sin_iva_leido = subtotal;
  datos.valor_con_iva_leido = total;
  datos.valor_sin_iva = Math.round(sumaItems);
  datos.valor_con_iva = Math.round(sumaItems + iva);
  datos.aviso_valores = `El valor sin IVA leído (${pesos(subtotal)}) no incluía todas las líneas de la factura: las líneas suman ${pesos(sumaItems)} y, con el IVA, dan ${pesos(sumaItems + iva)}, igual al ${Number(datos.valor_letras_numero) ? 'valor en letras' : 'total a pagar impreso'}. Se usó ese valor -- revísalo contra el documento.`;
  if (datos.confianza_campos && typeof datos.confianza_campos === 'object') {
    datos.confianza_campos.valor_sin_iva = Math.min(Number(datos.confianza_campos.valor_sin_iva ?? 1), 0.5);
    datos.confianza_campos.valor_con_iva = Math.min(Number(datos.confianza_campos.valor_con_iva ?? 1), 0.5);
  }
  return true;
}

module.exports = { corregirSubtotalConItems };
