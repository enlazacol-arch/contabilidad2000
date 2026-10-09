// Pruebas de la excepción "Lectura dudosa" (public/excepciones.js) y de
// la retención "según tarifas por ítem" (public/retenciones.js).
// Caso real: factura de EPM (oct. 2026) -- la energía (2.803 kWh) salió
// en $25.828 y el total quedó en $444.387; el documento dice $3.001.188.
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { motivosLecturaDudosa, tieneExcepcion } = require('../public/excepciones');
const { corregirSubtotalConItems } = require('../cuadre-valores');
const R = require('../public/retenciones');

const epmLeida = () => ({
  valor_sin_iva: 444387, valor_iva: 0, valor_con_iva: 444387, total_a_pagar_impreso: 3001188,
  items: [
    { descripcion: 'Acueducto 44 m3', subtotal: 217622 },
    { descripcion: 'Alcantarillado 44 m3', subtotal: 170527 },
    { descripcion: 'Energía 2803 kWh', subtotal: 25828 },
    { descripcion: 'Otras Entidades', subtotal: 30410 },
    { descripcion: 'Ajuste al peso', subtotal: 0 },
  ],
  confianza_campos: { valor_sin_iva: 0.9, valor_con_iva: 0.9 },
});

test('EPM: el total impreso no cuadra con lo leído -> lectura dudosa, con el motivo', () => {
  const d = epmLeida();
  assert.equal(tieneExcepcion(d, 'lectura_dudosa'), true);
  assert.match(motivosLecturaDudosa(d)[0], /total a pagar impreso.*\$3\.001\.188.*\$444\.387/);
});

test('EPM: el total impreso NO arregla nada solo si las líneas tampoco cuadran (no se inventa)', () => {
  const d = epmLeida();
  assert.equal(corregirSubtotalConItems(d), false);
  assert.equal(d.valor_con_iva, 444387);
});

test('EPM: cuando el contador corrige la energía, la alerta desaparece sola', () => {
  const d = epmLeida();
  d.items[2].subtotal = 2582629; // valor correcto de la línea de energía
  d.valor_sin_iva = d.items.reduce((s, it) => s + it.subtotal, 0);
  d.valor_con_iva = d.valor_sin_iva;
  assert.equal(d.valor_con_iva, 3001188);
  assert.equal(tieneExcepcion(d, 'lectura_dudosa'), false);
});

test('Total impreso = total menos retenciones (neto a pagar): no es dudosa', () => {
  const d = { valor_sin_iva: 1000000, valor_iva: 190000, valor_con_iva: 1190000, rete_fuente: 40000, total_a_pagar_impreso: 1150000 };
  assert.equal(tieneExcepcion(d, 'lectura_dudosa'), false);
});

test('La IA misma dice que no leyó bien -> lectura dudosa con su explicación', () => {
  const d = { valor_sin_iva: 100, valor_con_iva: 100, lectura_dudosa: true, motivo_lectura_dudosa: 'el valor de la línea de Energía está borroso' };
  assert.match(motivosLecturaDudosa(d)[0], /Energía está borroso/);
});

test('Poca confianza de la IA en un valor clave -> lectura dudosa', () => {
  const d = { valor_sin_iva: 100, valor_con_iva: 100, confianza_campos: { valor_con_iva: 0.4, nit_cc: 0.9 } };
  assert.match(motivosLecturaDudosa(d)[0], /no está segura de el total/);
});

test('Las líneas no suman el subtotal -> lectura dudosa', () => {
  const d = { valor_sin_iva: 500, valor_con_iva: 500, items: [{ subtotal: 100 }, { subtotal: 200 }] };
  assert.match(motivosLecturaDudosa(d)[0], /líneas leídas suman \$300/);
});

test('Una factura bien leída no tiene alerta', () => {
  const d = { valor_sin_iva: 300, valor_iva: 0, valor_con_iva: 300, total_a_pagar_impreso: 300, items: [{ subtotal: 100 }, { subtotal: 200 }], confianza_campos: { valor_con_iva: 1 } };
  assert.deepEqual(motivosLecturaDudosa(d), []);
});

test('Sin valor en letras, el total impreso sirve de árbitro para corregir el subtotal', () => {
  const d = { valor_sin_iva: 290906, valor_iva: 55272, valor_con_iva: 346178, total_a_pagar_impreso: 3255235,
    items: [{ subtotal: 2909057 }, { subtotal: 290906 }] };
  assert.equal(corregirSubtotalConItems(d), true);
  assert.equal(d.valor_con_iva, 3255235);
  assert.match(d.aviso_valores, /total a pagar impreso/);
});

test('Retención por ítem: si la Rete Fuente de la ficha está en $0, cada ítem va en $0', () => {
  const item = { categoria_concepto: 'servicios', subtotal: 300000 };
  assert.equal(R.tarifaRetencionItem(item, 0), 0);
  assert.equal(R.tarifaRetencionItem(item, 12000), 0.04);
  assert.equal(R.tarifaRetencionItem({ ...item, tarifa_retencion: 0.06 }, 12000), 0.06);
  assert.equal(R.montoRetencionItem(item, 0.04), 12000);
});

test('Retención por ítem en aseo/vigilancia: sobre el AIU de la línea, no sobre el subtotal', () => {
  assert.equal(R.montoRetencionItem({ categoria_concepto: 'vigilancia_aseo', subtotal: 290906, aiu: '290906' }, 0.02), 5818);
  assert.equal(R.montoRetencionItem({ categoria_concepto: 'vigilancia_aseo', subtotal: 2909057, aiu: '' }, 0.02), null); // falta AIU
});

test('Valor a pagar: total con IVA − retenciones − abonado', () => {
  assert.deepEqual(R.netoAPagar({ valor_con_iva: 762904, rete_fuente: 25640 }), { total: 762904, retenciones: 25640, abonado: 0, neto: 737264 });
  assert.equal(R.netoAPagar({ valor_con_iva: 1000, rete_fuente: 40, rete_iva: 20, rete_ica: 5, valor_abonado: 100 }).neto, 835);
  assert.equal(R.textoNetoAPagar({ valor_con_iva: 762904, rete_fuente: 25640 }), '$737.264 (total $762.904 − retenciones $25.640)');
});
