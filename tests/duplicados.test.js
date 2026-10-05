// Pruebas de duplicados.js -- la misma factura no se causa dos veces.
// Casos tomados de las facturas reales de Bosques (julio 2026).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluarDuplicado } = require('../duplicados');

const guardada = (extra) => ({ id: 'g1', cliente_id: 'BOSQ', nombre_razon_social: 'GAMOEZ S.A.S.', nit_cc: '901627469', letras_fe: 'MED', numeros_fe: '39712', fecha_factura: '15/07/2026', valor_con_iva: '1194870', concepto: 'Insumos para piscina', file_hash: 'h1', ...extra });

test('mismo archivo', () => {
  assert.equal(evaluarDuplicado({ file_hash: 'h1' }, [guardada()]).motivo, 'archivo');
});

test('mismo NIT y número (con ceros o letras distintas)', () => {
  assert.equal(evaluarDuplicado({ nit_cc: '901.627.469-0', numeros_fe: '039712', valor_con_iva: 1 }, [guardada()]).motivo, 'numero');
});

test('mismo número y valor con otro NIT: el NIT se leyó mal (GAMOEZ 900627469)', () => {
  const r = evaluarDuplicado({ nit_cc: '900627469', numeros_fe: '39712', valor_con_iva: 1194870, fecha_factura: '15/07/2026' }, [guardada()]);
  assert.equal(r.motivo, 'numero_valor');
  assert.match(r.mensaje, /NIT se haya leído mal/);
});

test('cuenta de cobro sin número fotografiada dos veces (IMB): mismo NIT, valor y fecha', () => {
  const imb = guardada({ nombre_razon_social: 'ANDRES FELIPE OSORIO', nit_cc: '71261773', numeros_fe: '', letras_fe: '', valor_con_iva: '750000', fecha_factura: '17/07/2026', concepto: 'Multicontrol', file_hash: 'x' });
  assert.equal(evaluarDuplicado({ nit_cc: '71261773', numeros_fe: '', valor_con_iva: 750000, fecha_factura: '17/07/2026' }, [imb]).motivo, 'sin_numero');
});

test('dos cuentas de cobro distintas del mismo proveedor, mismo valor y fecha, CON número: no es duplicado (IMB 720 y 721)', () => {
  const c720 = guardada({ nit_cc: '71261773', numeros_fe: '720', valor_con_iva: '280000', fecha_factura: '17/07/2026', file_hash: 'a' });
  assert.equal(evaluarDuplicado({ nit_cc: '71261773', numeros_fe: '721', valor_con_iva: 280000, fecha_factura: '17/07/2026' }, [c720]), null);
});

test('el mismo gasto con dos soportes de distinto emisor (reparación del shut, P.B.L. y Darío)', () => {
  const pbl = guardada({ nombre_razon_social: 'P.B.L COMERCIALIZADORA', nit_cc: '3350761', numeros_fe: '983', valor_con_iva: '2100000', fecha_factura: '02/07/2026', concepto: 'Reparación shut de basuras con cambio de ducto', file_hash: 'p' });
  const dario = { nit_cc: '', nombre_razon_social: 'DARIO BERMUDEZ LOAIZA', numeros_fe: '', valor_con_iva: 2100000, fecha_factura: '01/07/2026', concepto: 'Reparación shut de basuras, cambio de ducto' };
  const r = evaluarDuplicado(dario, [pbl], { clienteId: 'BOSQ' });
  assert.equal(r.motivo, 'mismo_gasto');
  // Sin saber el cliente (al leer), esta regla no se aplica.
  assert.equal(evaluarDuplicado(dario, [pbl]), null);
});

test('mismo valor y fecha cercana pero otro concepto, u otro cliente: no es duplicado', () => {
  const admin = guardada({ nombre_razon_social: 'ANGELA GARCIA', nit_cc: '43263751', numeros_fe: '', valor_con_iva: '4000000', fecha_factura: '30/07/2026', concepto: 'Administración copropiedad julio', file_hash: 'q' });
  const reparacion = { nit_cc: '3350761', numeros_fe: '990', valor_con_iva: 4000000, fecha_factura: '28/07/2026', concepto: 'Reparación de cubierta' };
  assert.equal(evaluarDuplicado(reparacion, [admin], { clienteId: 'BOSQ' }), null);
  assert.equal(evaluarDuplicado({ ...reparacion, concepto: 'Administración copropiedad julio' }, [admin], { clienteId: 'OTRO' }), null);
});

test('la administración de cada mes (mismo valor, ~30 días) no es duplicado', () => {
  const junio = guardada({ nit_cc: '43263751', numeros_fe: '', valor_con_iva: '4000000', fecha_factura: '30/06/2026', concepto: 'Administración copropiedad junio', file_hash: 'j' });
  assert.equal(evaluarDuplicado({ nit_cc: '43263751', numeros_fe: '', valor_con_iva: 4000000, fecha_factura: '30/07/2026', concepto: 'Administración copropiedad julio' }, [junio], { clienteId: 'BOSQ' }), null);
});
