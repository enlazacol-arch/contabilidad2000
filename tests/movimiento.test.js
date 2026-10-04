// Pruebas de public/movimiento.js -- la regla única de ingreso/egreso.
// Cada caso es una situación real que antes clasificaba mal la factura
// (o que no debe romperse al cambiar la regla).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarNitComparable,
  calcularDvNit,
  nitsCoinciden,
  limpiarNitLeido,
  nitTieneTexto,
  nombresCompatibles,
  clasificarMovimiento,
} = require('../public/movimiento');

const clienteA = { id: 'A', nombre: 'Distribuidora Andina S.A.S.', nit: '900.123.456-7' };
const clienteB = { id: 'B', nombre: 'Café La Montaña', nit: '79456123' };
const clientes = [clienteA, clienteB];

// ---------- normalización y dígito de verificación ----------

test('normalizarNitComparable: quita puntos, espacios y el DV separado por guion', () => {
  assert.equal(normalizarNitComparable('900.123.456-7'), '900123456');
  assert.equal(normalizarNitComparable(' 900 123 456 '), '900123456');
  assert.equal(normalizarNitComparable('NIT 79.456.123'), '79456123');
  assert.equal(normalizarNitComparable(null), '');
});

test('calcularDvNit: coincide con el DV oficial de NIT conocidos', () => {
  assert.equal(calcularDvNit('800197268'), '4'); // DIAN
  assert.equal(calcularDvNit('800.197.268'), '4');
  assert.equal(calcularDvNit(''), '');
});

test('nitsCoinciden: mismo NIT con distinto formato', () => {
  assert.equal(nitsCoinciden('900123456', '900.123.456-7'), true);
  assert.equal(nitsCoinciden('800.197.268', '800197268'), true);
});

test('nitsCoinciden: acepta el DV pegado solo si es el DV correcto', () => {
  assert.equal(nitsCoinciden('8001972684', '800197268'), true);   // 4 es el DV de la DIAN
  assert.equal(nitsCoinciden('8001972685', '800197268'), false);  // dígito de más que no es el DV
  assert.equal(nitsCoinciden('800197268', '8001972684'), true);   // y al revés
});

test('nitsCoinciden: nunca por parecido ni con valores vacíos', () => {
  assert.equal(nitsCoinciden('900123457', '900123456'), false);
  assert.equal(nitsCoinciden('90012345', '900123456'), false);
  assert.equal(nitsCoinciden('', '900123456'), false);
  assert.equal(nitsCoinciden('900123456', ''), false);
});

// ---------- clasificación ----------

test('clasificarMovimiento: el cliente es el comprador -> egreso', () => {
  const r = clasificarMovimiento({ nit_cc: '800555111', adquiriente_nit: '900123456' }, clientes);
  assert.equal(r.tipoMovimiento, 'egreso');
  assert.equal(r.clienteId, 'A');
  assert.equal(r.confiado, true);
  assert.equal(r.motivo, 'adquiriente');
});

test('clasificarMovimiento: el cliente es el vendedor -> ingreso', () => {
  const r = clasificarMovimiento({ nit_cc: '79.456.123', adquiriente_nit: '1020304050' }, clientes);
  assert.equal(r.tipoMovimiento, 'ingreso');
  assert.equal(r.clienteId, 'B');
  assert.equal(r.motivo, 'emisor');
});

test('clasificarMovimiento: cliente guardado con puntos y guion, factura sin formato (antes fallaba)', () => {
  const r = clasificarMovimiento({ nit_cc: '800555111', adquiriente_nit: '900123456' }, clientes);
  assert.equal(r.clienteId, 'A');
  assert.equal(r.confiado, true);
});

test('clasificarMovimiento: la IA leyó el NIT con el DV pegado', () => {
  const dian = { id: 'D', nombre: 'DIAN', nit: '800.197.268-4' };
  const r = clasificarMovimiento({ nit_cc: '1020304050', adquiriente_nit: '8001972684' }, [dian]);
  assert.equal(r.clienteId, 'D');
  assert.equal(r.tipoMovimiento, 'egreso');
});

test('clasificarMovimiento: ningún NIT coincide -> egreso pero sin confirmar', () => {
  const r = clasificarMovimiento({ nit_cc: '800555111', adquiriente_nit: '811222333' }, clientes);
  assert.equal(r.tipoMovimiento, 'egreso');
  assert.equal(r.clienteId, '');
  assert.equal(r.confiado, false);
  assert.equal(r.motivo, 'sin_coincidencia');
});

test('clasificarMovimiento: la factura no trae adquiriente (POS, cuenta de cobro)', () => {
  const r = clasificarMovimiento({ nit_cc: '800555111', adquiriente_nit: '' }, clientes);
  assert.equal(r.confiado, false);
  assert.equal(r.motivo, 'sin_coincidencia');
});

test('clasificarMovimiento: la firma no tiene clientes', () => {
  const r = clasificarMovimiento({ nit_cc: '800555111', adquiriente_nit: '900123456' }, []);
  assert.equal(r.confiado, false);
  assert.equal(r.motivo, 'sin_clientes');
});

test('clasificarMovimiento: venta entre dos clientes de la firma -> egreso del comprador y avisa del vendedor', () => {
  const r = clasificarMovimiento({ nit_cc: '79456123', adquiriente_nit: '900123456' }, clientes);
  assert.equal(r.tipoMovimiento, 'egreso');
  assert.equal(r.clienteId, 'A');
  assert.equal(r.otroClienteId, 'B');
});

test('clasificarMovimiento: con cliente fijo solo decide para ese cliente', () => {
  const egreso = clasificarMovimiento({ nit_cc: '79456123', adquiriente_nit: '900123456' }, clientes, { clienteFijo: clienteB });
  assert.equal(egreso.clienteId, 'B');
  assert.equal(egreso.tipoMovimiento, 'ingreso'); // B es el vendedor de esta factura
  assert.equal(egreso.otroClienteId, '');
});

test('clasificarMovimiento: cliente fijo sin coincidencia queda en ese cliente, sin confirmar', () => {
  const r = clasificarMovimiento({ nit_cc: '800555111', adquiriente_nit: '811222333' }, clientes, { clienteFijo: clienteA });
  assert.equal(r.clienteId, 'A');
  assert.equal(r.tipoMovimiento, 'egreso');
  assert.equal(r.confiado, false);
  assert.equal(r.motivo, 'cliente_fijo_sin_coincidencia');
});

// ---------- limpieza de NIT leído ----------

test('limpiarNitLeido: deja solo los dígitos de un NIT con formato', () => {
  assert.equal(limpiarNitLeido('900.579.294-9'), '900579294');
  assert.equal(limpiarNitLeido('NIT 71.261.773'), '71261773');
});

test('limpiarNitLeido: un nombre en el campo NIT queda vacío (caso reportado)', () => {
  assert.equal(limpiarNitLeido('bosques de la macarena'), '');
  assert.equal(limpiarNitLeido('Propiedad Horizontal'), '');
  assert.equal(limpiarNitLeido(''), '');
  assert.equal(limpiarNitLeido(null), '');
});

test('limpiarNitLeido: descarta números demasiado cortos o largos para ser NIT', () => {
  assert.equal(limpiarNitLeido('123'), '');
  assert.equal(limpiarNitLeido('1234567890123456'), '');
});

test('nitTieneTexto: detecta un nombre escrito en el campo NIT', () => {
  assert.equal(nitTieneTexto('bosques de la macarena'), true);
  assert.equal(nitTieneTexto('900.579.294-9'), false);
  assert.equal(nitTieneTexto('NIT 900579294'), true);
});

// ---------- El nombre también debe coincidir (caso real IMB, oct. 2026) ----------
const conjunto = { id: 'PH', nombre: 'CONJUNTO RESIDENCIAL URBANIZACION BOSQUES DE LA MACARENA P.H.', nit: '900579294' };

test('nombresCompatibles: mismo cliente escrito distinto sí; otra empresa no', () => {
  assert.equal(nombresCompatibles('Bosques de la Macarena', conjunto.nombre), true);
  assert.equal(nombresCompatibles('DISTRIBUIDORA ANDINA S.A.S.', 'Distribuidora Andina'), true);
  assert.equal(nombresCompatibles('IMB Ingenieria en Mantenimiento de Equipos de Bombeo', conjunto.nombre), false);
  assert.equal(nombresCompatibles('', conjunto.nombre), true); // sin nombre: no hay con qué comparar
});

test('IMB: la IA puso el NIT del conjunto como emisor -> ya no sale como INGRESO', () => {
  const r = clasificarMovimiento({
    nit_cc: '900579294', nombre_razon_social: 'IMB Ingenieria en Mantenimiento de Equipos de Bombeo',
    adquiriente_nit: '', adquiriente_nombre: 'BOSQUES DE LA MACARENA',
  }, [conjunto]);
  assert.notEqual(r.tipoMovimiento, 'ingreso');
  assert.equal(r.confiado, false);
  assert.equal(r.motivo, 'nombre_no_coincide');
  assert.match(r.aviso, /IMB/);
});

test('IMB bien leída: egreso del conjunto, confiado', () => {
  const r = clasificarMovimiento({
    nit_cc: '71261773', nombre_razon_social: 'ANDRÉS FELIPE OSORIO PEÑA',
    adquiriente_nit: '900579294', adquiriente_nombre: 'Bosques de la Macarena',
  }, [conjunto]);
  assert.equal(r.tipoMovimiento, 'egreso');
  assert.equal(r.clienteId, 'PH');
  assert.equal(r.confiado, true);
});

test('emisor y comprador con el mismo NIT: queda por confirmar con aviso', () => {
  const r = clasificarMovimiento({ nit_cc: '900579294', nombre_razon_social: 'IMB', adquiriente_nit: '900579294', adquiriente_nombre: 'Bosques de la Macarena' }, [conjunto]);
  assert.equal(r.tipoMovimiento, 'egreso');
  assert.equal(r.confiado, false);
  assert.match(r.aviso, /iguales/);
});

test('venta real del cliente (emisor = cliente, mismo nombre) sigue siendo ingreso', () => {
  const r = clasificarMovimiento({ nit_cc: '900.579.294-9', nombre_razon_social: 'CONJUNTO RESIDENCIAL BOSQUES DE LA MACARENA', adquiriente_nit: '71261773', adquiriente_nombre: 'Juan Pérez' }, [conjunto]);
  assert.equal(r.tipoMovimiento, 'ingreso');
  assert.equal(r.confiado, true);
});
