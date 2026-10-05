// Pruebas de public/historial-contable.js -- aprender de la contabilidad
// anterior del cliente (Auxiliar General / Listado de movimientos).
// Datos inventados con la forma de los reportes de Contai.
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const HC = require('../public/historial-contable');
const R = require('../public/retenciones');

const ENCABEZADO_AUXILIAR = ['Cuenta', 'Nombre', 'Equivalencia', 'Nit', 'Nombre Nit', 'Nro Registro', 'Comprobante', 'Fecha', 'Documento', 'Documento Referencia', 'Detalle', 'Nivel', 'Saldo Anterior', 'Débitos', 'Créditos', 'Nuevo Saldo'];
const fila = (cuenta, nit, nombre, reg, doc, detalle, debito, credito) => [cuenta, '', '', nit, nombre, reg, '00002', '07/30/2026', doc, doc, detalle, 3, 0, debito, credito, 0];
const AUXILIAR = [
  ['C.R. EJEMPLO P.H.'], ['Auxiliar General Jul-31-2026'], ENCABEZADO_AUXILIAR,
  ['51-35', 'GASTOS POR SERVICIOS', '', '', '', '', '', '', '', '', '', 2, 0, 1000, 0, 1000], // resumen: se ignora
  fila('51-35-07', '900.111.222-3', 'SEGURIDAD EJEMPLO LTDA', '0001', '000044', 'VIGILANCIA JULIO', 20000000, 0),
  fila('83-95-19', '900.111.222-3', 'SEGURIDAD EJEMPLO LTDA', '0002', '000044', 'VIGILANCIA JULIO', 380000, 0),
  fila('51-95-25-01', '901.000.111-0', 'INSUMOS EJEMPLO S.A.S.', '0003', '000034', 'BOLSAS, DETERGENTE', 700000, 0),
  fila('51-95-30-01', '901.000.111-0', 'INSUMOS EJEMPLO S.A.S.', '0004', '000035', 'MARCADORES, CINTA', 130000, 0),
  fila('51-35-95-02', '901.222.333-4', 'FACTURACION EJEMPLO SAS', '0005', '000041', 'SERVICIO FACTURACION', 844626, 0),
  fila('23-65-25-02', '901.222.333-4', 'FACTURACION EJEMPLO SAS', '0006', '000041', 'SERVICIO FACTURACION', 0, 28391),
  fila('51-45-10-11', '1.055.917.398-3', 'PERSONA BOMBILLOS', '0007', '000038', 'BOMBILLO GU10', 12000, 0),
];

test('movimientosDesdeTabla: Auxiliar General (ignora las filas de resumen por cuenta)', () => {
  const { formato, movimientos } = HC.movimientosDesdeTabla(AUXILIAR);
  assert.equal(formato, 'auxiliar');
  assert.equal(movimientos.length, 7);
  assert.deepEqual({ cuenta: movimientos[0].cuenta, nit: movimientos[0].nit, debito: movimientos[0].debito }, { cuenta: '513507', nit: '900111222', debito: 20000000 });
});

test('movimientosDesdeTabla: Listado de Movimiento por Comprobante (Db/Cr y valor base)', () => {
  const listado = [
    ['Comprobante', 'Nombre', 'No. Registro', 'Cuenta', 'Equivalencia', 'Fecha', 'Documento', 'Docto. Referencia', 'Detalle', 'Id', 'Nit', 'Nivel', 'Valor', 'Valor Base'],
    ['00002', 'EGRESOS', '000702', '51-35-95-02', '', 'Jul/30/2026', '000000041', '000039616', 'SERVICIO FACTURACION', 'Db', '901.425.360-1', 6, 709770, 0],
    ['00002', 'EGRESOS', '000704', '23-65-25-02', '', 'Jul/30/2026', '000000041', '000039616', 'SERVICIO FACTURACION', 'Cr', '901.425.360-1', 6, 28391, 709775],
  ];
  const { formato, movimientos } = HC.movimientosDesdeTabla(listado);
  assert.equal(formato, 'listado');
  assert.equal(movimientos[1].credito, 28391);
  assert.equal(movimientos[1].base, 709775);
});

test('movimientosDesdeTabla: un archivo que no es contabilidad -> error claro', () => {
  assert.match(HC.movimientosDesdeTabla([['Nombre', 'Teléfono'], ['x', 'y']]).error, /Auxiliar General/);
});

test('conocimientoDesdeMovimientos: cuentas por proveedor, a quién no se le retiene y tarifa habitual', () => {
  const { movimientos } = HC.movimientosDesdeTabla(AUXILIAR);
  const k = HC.conocimientoDesdeMovimientos(movimientos, [{ codigo: '23652502', porcentaje: 4 }]);
  assert.equal(k.ivaCuentasOrden, true);
  assert.equal(k.terceros['900111222'], 'SEGURIDAD EJEMPLO LTDA');
  const insumos = k.cuentas.filter((c) => c.nit === '901000111').map((c) => c.cuenta).sort();
  assert.deepEqual(insumos, ['51952501', '51953001']);
  const r = (nit) => k.retencion.find((x) => x.nit === nit);
  assert.equal(r('900111222').noRetiene, true);
  assert.equal(r('901222333').noRetiene, false);
  assert.equal(r('901222333').tarifa, 0.04); // del plan (23652502 = 4%), no 28391/844626
  assert.equal(r('901222333').categoria, 'servicios');
  assert.equal(r('1055917398').noRetiene, false); // $12.000: bajo la base, no dice nada
});

test('normalizarNombreTercero: la puntuación y la sigla societaria no separan nombres', () => {
  assert.equal(HC.normalizarNombreTercero('GAMOEZ S.A.S.'), HC.normalizarNombreTercero('Gamoez SAS'));
  assert.equal(HC.normalizarNombreTercero('C.R. URB. BOSQUES DE LA MACARENA P.H.'), 'CR URB BOSQUES MACARENA PH');
});

test('lo importado alimenta la cuenta sugerida desde la primera factura', () => {
  const { movimientos } = HC.movimientosDesdeTabla(AUXILIAR);
  const k = HC.conocimientoDesdeMovimientos(movimientos);
  R.registrarSubcuentasAprendidas({});
  R.registrarHistorialSubcuentas(k.cuentas.map((c) => ({ cliente_id: 'C1', nit: c.nit, categoria: '*', subcuenta: c.cuenta, veces: c.veces, textos: c.detalles.join(' | ') })));
  // Proveedor conocido, siempre a la misma cuenta:
  assert.equal(R.subcuentaAprendida('900111222', 'vigilancia_aseo', 'C1', 'Servicio de vigilancia agosto'), '513507');
  // Proveedor conocido con varias cuentas: por concepto.
  assert.equal(R.subcuentaAprendida('901000111', 'compras', 'C1', 'MARCADOR BORRABLE'), '51953001');
  // Proveedor NUEVO: lo que el cliente ya causó con algo parecido.
  assert.equal(R.subcuentaAprendida('800000001', 'compras', 'C1', 'BOMBILLO LED 9W'), '51451011');
  R.registrarHistorialSubcuentas([]);
});

test('perfil "no se le retiene": no se propone retención', () => {
  const inv = { nit_cc: '900111222', fecha_factura: '15/07/2026', categoria_concepto: 'servicios', valor_sin_iva: 1000000, desglose_categorias: '{}' };
  assert.ok(R.calcularRetencionSugerida(inv, { agente_retenedor: true }, {}, null));
  assert.equal(R.calcularRetencionSugerida(inv, { agente_retenedor: true }, {}, { no_retener: true }), null);
});
