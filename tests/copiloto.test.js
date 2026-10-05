// Pruebas de copiloto.js -- la lógica del copiloto de cuentas sin IA ni
// base de datos (qué cuentas se ofrecen, cuándo basta el proveedor,
// qué ejemplos se mandan y cómo se valida la respuesta).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('../copiloto');

const c = (codigo, concepto, extra = {}) => ({ codigo, concepto, activo: true, recibe_movimiento: true, ...extra });
const PUC = [
  c('5135', 'GASTOS POR SERVICIOS', { recibe_movimiento: false }),
  c('513507', 'VIGILANCIA'), c('513508', 'IVA VIGILANCIA'), c('513599', 'AJUSTES POR INFLACION'),
  c('51359501', 'SERVICIOS DE ADMINISTRACION'), c('51954501', 'MENSAJERIA Y BUSES'),
  c('51451011', 'MANTO ELECTRICO'), c('51959504', 'DOTACION', { activo: false }), c('111005', 'BANCOS'),
];

test('planDeGasto: solo gasto usable, sin cuentas "IVA ...", obsoletas, inactivas ni de otras clases', () => {
  assert.deepEqual(CP.planDeGasto(PUC).map((x) => x.codigo), ['513507', '51359501', '51954501', '51451011']);
});

test('cuentaUnicaDelProveedor: proveedor con historia suficiente -> su cuenta de siempre', () => {
  const ej = [{ nit: '71261773', cuenta: '51451005', detalle: 'BOMBA TRIFASICA', veces: 6 }];
  assert.equal(CP.cuentaUnicaDelProveedor(ej, '71261773', 'Cambio de rodamientos'), '51451005');
});

test('cuentaUnicaDelProveedor: poca historia y concepto distinto -> decide el copiloto', () => {
  // La administradora solo tenía un transporte; su cobro de administración no va a transporte.
  const ej = [{ nit: '43263751', cuenta: '51954501', detalle: 'TRANSPORTE AV VILLAS', veces: 1 }];
  assert.equal(CP.cuentaUnicaDelProveedor(ej, '43263751', 'Administración copropiedad julio'), '');
  assert.equal(CP.cuentaUnicaDelProveedor(ej, '43263751', 'Transporte a radicar documentos'), '51954501');
});

test('cuentaUnicaDelProveedor: varias cuentas con el proveedor -> no hay una sola', () => {
  const ej = [{ nit: '901627469', cuenta: '51952501', detalle: 'BOLSAS', veces: 5 }, { nit: '901627469', cuenta: '51953001', detalle: 'MARCADORES', veces: 2 }];
  assert.equal(CP.cuentaUnicaDelProveedor(ej, '901627469', 'Bolsas'), '');
});

test('elegirEjemplos: primero el proveedor, luego conceptos parecidos', () => {
  const ej = [
    { nit: '1', cuenta: 'A', detalle: 'PAPEL HIGIENICO', veces: 9 },
    { nit: '2', cuenta: 'B', detalle: 'BOMBILLO GU10', veces: 1 },
    { nit: '3', cuenta: 'C', detalle: 'VIGILANCIA', veces: 1 },
  ];
  assert.deepEqual(CP.elegirEjemplos(ej, '3', 'Bombillo LED 9W').map((e) => e.cuenta), ['C', 'B', 'A']);
});

test('construirPromptCopiloto: lleva el plan, los ejemplos y los ítems', () => {
  const p = CP.construirPromptCopiloto({ plan: CP.planDeGasto(PUC), ejemplos: [{ nombre: 'KAREN', detalle: 'BOMBILLO GU10', cuenta: '51451011' }], nit: '901949277', nombre: 'EL FORTIN', concepto: 'Bombillos', items: [{ descripcion: 'BOMBILLO LED', subtotal: 12773 }] });
  assert.match(p, /51451011 - MANTO ELECTRICO/);
  assert.match(p, /KAREN \| BOMBILLO GU10 \| 51451011/);
  assert.match(p, /0\. BOMBILLO LED -- \$12773/);
  assert.doesNotMatch(p, /513508/);
});

test('cuentasValidas: descarta índices inexistentes y códigos fuera del plan', () => {
  const plan = CP.planDeGasto(PUC);
  const r = CP.cuentasValidas({ cuentas: [{ indice: 0, codigo: '51451011' }, { indice: 1, codigo: '999999' }, { indice: 7, codigo: '513507' }] }, [{}, {}], plan);
  assert.deepEqual(r, [{ indice: 0, codigo: '51451011' }]);
  assert.deepEqual(CP.cuentasValidas(null, [{}], plan), []);
});
