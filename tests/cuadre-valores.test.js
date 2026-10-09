// Pruebas de cuadre-valores.js -- el subtotal leído no incluía todas las
// líneas (caso real: Manos Activas SI 43076, Carga masiva, 9 oct. 2026).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { corregirSubtotalConItems } = require('../cuadre-valores');

// Lo que quedó guardado en el lote (prompt v4): líneas bien, subtotal = solo el AIU.
const leidaMal = () => ({
  valor_sin_iva: 290906, valor_iva: 55272, valor_con_iva: 346178, valor_letras_numero: 3255235,
  items: [{ descripcion: 'SERVICIO ASEO SEPTIEMBRE 2026', subtotal: 2909057 }, { descripcion: 'AIU', subtotal: 290906 }],
  confianza_campos: { valor_sin_iva: 1, valor_con_iva: 1 },
});

test('Manos Activas SI 43076: subtotal = solo la parte gravada -> se usa la suma de las líneas', () => {
  const d = leidaMal();
  assert.equal(corregirSubtotalConItems(d), true);
  assert.equal(d.valor_sin_iva, 3199963);
  assert.equal(d.valor_con_iva, 3255235);
  assert.equal(d.valor_iva, 55272);
  assert.equal(d.valor_sin_iva_leido, 290906);
  assert.match(d.aviso_valores, /\$290\.906.*\$3\.199\.963.*\$3\.255\.235/);
  assert.equal(d.confianza_campos.valor_sin_iva, 0.5);
});

test('Ítems como texto JSON (así a veces los manda la IA): igual se corrige', () => {
  const d = leidaMal();
  d.items = JSON.stringify(d.items);
  assert.equal(corregirSubtotalConItems(d), true);
  assert.equal(d.valor_con_iva, 3255235);
});

test('No toca nada si ya cuadra', () => {
  const d = { ...leidaMal(), valor_sin_iva: 3199963, valor_con_iva: 3255235 };
  assert.equal(corregirSubtotalConItems(d), false);
  assert.equal(d.aviso_valores, undefined);
});

test('No adivina sin valor en letras (no hay árbitro)', () => {
  const d = { ...leidaMal(), valor_letras_numero: 0 };
  assert.equal(corregirSubtotalConItems(d), false);
  assert.equal(d.valor_sin_iva, 290906);
});

test('No adivina si las líneas tampoco cuadran con las letras (líneas mal leídas)', () => {
  const d = leidaMal();
  d.items[0].subtotal = 3000000; // foto borrosa: la IA inventó dígitos
  assert.equal(corregirSubtotalConItems(d), false);
});

test('No toca nada si el total leído ya coincide con las letras (las líneas son las que fallan)', () => {
  const d = { ...leidaMal(), valor_sin_iva: 3199963, valor_con_iva: 3255235, items: [{ subtotal: 100 }] };
  assert.equal(corregirSubtotalConItems(d), false);
});
