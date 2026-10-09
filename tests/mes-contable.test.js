// Pruebas de public/mes-contable.js -- el mes en que se CAUSA una factura
// es distinto de su fecha de emisión (ej. emitida en agosto, causada en
// octubre).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../public/mes-contable');

test('mesContableValido: solo AAAA-MM con un mes real', () => {
  assert.equal(M.mesContableValido('2026-10'), true);
  assert.equal(M.mesContableValido('2026-13'), false);
  assert.equal(M.mesContableValido('2026-1'), false);
  assert.equal(M.mesContableValido('10/2026'), false);
  assert.equal(M.mesContableValido(''), false);
  assert.equal(M.mesContableValido(null), false);
});

test('mesDeFecha: DD/MM/AAAA -> AAAA-MM', () => {
  assert.equal(M.mesDeFecha('15/08/2026'), '2026-08');
  assert.equal(M.mesDeFecha('5/9/2026'), '2026-09');
  assert.equal(M.mesDeFecha('2026-08-15'), '');
  assert.equal(M.mesDeFecha(''), '');
});

test('mesContableDeFactura: el elegido por el contador manda; si no hay, el de emisión', () => {
  assert.equal(M.mesContableDeFactura({ fecha_factura: '15/08/2026', mes_contable: '2026-10' }), '2026-10');
  assert.equal(M.mesContableDeFactura({ fecha_factura: '15/08/2026', mes_contable: '' }), '2026-08');
  assert.equal(M.mesContableDeFactura({ fecha_factura: '15/08/2026', mes_contable: 'basura' }), '2026-08');
  assert.equal(M.mesContableDeFactura({ fecha_factura: '' }), null);
});

test('fechaAsientoContable: misma fecha si cae en el mes contable; si no, último día del mes contable', () => {
  assert.equal(M.fechaAsientoContable({ fecha_factura: '15/08/2026', mes_contable: '2026-08' }), '15/08/2026');
  assert.equal(M.fechaAsientoContable({ fecha_factura: '15/08/2026', mes_contable: '2026-10' }), '31/10/2026');
  assert.equal(M.fechaAsientoContable({ fecha_factura: '20/01/2028', mes_contable: '2028-02' }), '29/02/2028'); // bisiesto
  assert.equal(M.fechaAsientoContable({ fecha_factura: '15/08/2026', mes_contable: '' }), '15/08/2026');
});

test('nombreMesContable y mesActual', () => {
  assert.equal(M.nombreMesContable('2026-10'), 'octubre 2026');
  assert.equal(M.nombreMesContable('x'), '');
  assert.equal(M.mesActual(new Date(2026, 9, 9)), '2026-10');
});

test('mesesSugeridos: de la emisión al mes actual (máximo 4 botones)', () => {
  assert.deepEqual(M.mesesSugeridos('2026-08', '2026-10'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(M.mesesSugeridos('2026-01', '2026-10'), ['2026-01', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(M.mesesSugeridos('2026-10', '2026-10'), ['2026-10']);
  assert.deepEqual(M.mesesSugeridos('2026-12', '2026-10'), ['2026-10', '2026-12']); // fecha futura (mal leída)
  assert.deepEqual(M.mesesSugeridos('', '2026-10'), ['2026-10']);
});
