// Pruebas de segmentacion.js -- una factura que la IA partió en varios
// "documentos" se vuelve a unir (caso real: Manos Activas SI 43076).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { claveFactura, unirFacturasPartidas } = require('../segmentacion');

const LETRAS = 'TRES MILLONES DOSCIENTOS CINCUENTA Y CINCO MIL DOSCIENTOS TREINTA Y CINCO PESOS';
const parte = (extra) => ({
  nit_cc: '900310662', nombre_razon_social: 'SERVICIOS INTEGRALES MANOS ACTIVAS S.A.S', letras_fe: 'SI', numeros_fe: '43076',
  fecha_factura: '15/09/2026', valor_letras_texto: LETRAS, valor_letras_numero: 3255235, rete_fuente: 0, rete_iva: 0, rete_ica: 0,
  confianza_campos: { valor_sin_iva: 0.9 }, ...extra,
});
const servicio = parte({ valor_sin_iva: 2909057, valor_iva: 0, valor_con_iva: 2909057,
  items: [{ descripcion: 'SERVICIO ASEO SEPTIEMBRE 2026', subtotal: 2909057, categoria_concepto: 'vigilancia_aseo' }],
  desglose_categorias: {} });
const aiu = parte({ valor_sin_iva: 290906, valor_iva: 55272, valor_con_iva: 346178,
  items: [{ descripcion: 'AIU', subtotal: 290906, categoria_concepto: 'vigilancia_aseo' }],
  desglose_categorias: {}, confianza_campos: { valor_sin_iva: 0.6 } });

test('claveFactura: mismo emisor y número, aunque cambie el formato', () => {
  assert.equal(claveFactura({ nit_cc: '900.310.662-0', letras_fe: 'si', numeros_fe: '043076' }), claveFactura(servicio));
  assert.equal(claveFactura({ nit_cc: '900310662', numeros_fe: '' }), '');
  assert.equal(claveFactura({ nit_cc: '', numeros_fe: '43076' }), '');
});

test('Manos Activas SI 43076: servicio + AIU partidos -> una sola factura de $3.255.235', () => {
  const r = unirFacturasPartidas([servicio, aiu]);
  assert.equal(r.length, 1);
  const f = r[0];
  assert.equal(f.valor_sin_iva, 3199963);
  assert.equal(f.valor_iva, 55272);
  assert.equal(f.valor_con_iva, 3255235); // igual al valor en letras
  assert.equal(f.items.length, 2);
  assert.deepEqual(f.items.map((i) => i.descripcion), ['SERVICIO ASEO SEPTIEMBRE 2026', 'AIU']);
  assert.equal(f.confianza_campos.valor_sin_iva, 0.6); // la más baja
  assert.match(f.aviso_segmentacion, /2 partes.*\$2\.909\.057 y \$346\.178/);
});

test('La IA repitió la factura completa y además una parte: se queda la completa, sin sumar', () => {
  const completa = parte({ valor_sin_iva: 3199963, valor_iva: 55272, valor_con_iva: 3255235, items: [{ descripcion: 'x', subtotal: 3199963 }] });
  const r = unirFacturasPartidas([completa, aiu]);
  assert.equal(r.length, 1);
  assert.equal(r[0].valor_con_iva, 3255235);
  assert.equal(r[0].items.length, 1);
});

test('Sin valor en letras y la misma factura dos veces: no se duplica el total', () => {
  const a = parte({ valor_letras_numero: 0, valor_sin_iva: 100000, valor_iva: 19000, valor_con_iva: 119000, items: [] });
  const r = unirFacturasPartidas([a, { ...a }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].valor_con_iva, 119000);
});

test('No se unen: facturas distintas del mismo proveedor, o de proveedores distintos', () => {
  const otraFactura = parte({ numeros_fe: '43077', valor_con_iva: 500000 });
  const otroProveedor = parte({ nit_cc: '800111222', valor_con_iva: 500000 });
  assert.equal(unirFacturasPartidas([servicio, otraFactura, otroProveedor]).length, 3);
});

test('No se unen documentos sin número (cuentas de cobro sin consecutivo)', () => {
  const a = parte({ numeros_fe: '', valor_con_iva: 100 });
  const b = parte({ numeros_fe: '', valor_con_iva: 200 });
  assert.equal(unirFacturasPartidas([a, b]).length, 2);
});

test('Un solo documento: pasa igual, sin aviso', () => {
  const r = unirFacturasPartidas([servicio]);
  assert.equal(r.length, 1);
  assert.equal(r[0].aviso_segmentacion, undefined);
});
