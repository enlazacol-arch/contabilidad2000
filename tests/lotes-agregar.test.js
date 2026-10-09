// Pruebas de lotes.agregarArchivoALote -- las fotos que llegan desde el
// celular (código QR) se van sumando a un mismo lote de Carga masiva.
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const lotes = require('../public/lotes');

test('la foto se inserta ANTES de reabrir el lote, y el lote no se duplica', async () => {
  const consultas = [];
  const pool = { async query(sql, params) { consultas.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
  lotes.init({ pool, crypto });
  const itemId = await lotes.agregarArchivoALote('L1', 'F', 'C', 'U', { nombre: 'f.jpg', base64: 'QUJD', mediaType: 'image/jpeg', isPdf: false });
  assert.ok(itemId);
  const iLote = consultas.findIndex((q) => /INSERT INTO lotes_procesamiento/.test(q.sql));
  const iItem = consultas.findIndex((q) => /INSERT INTO lote_items/.test(q.sql));
  const iReabrir = consultas.findIndex((q) => /UPDATE lotes_procesamiento\s+SET total_items = total_items \+ 1/.test(q.sql));
  assert.match(consultas[iLote].sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.ok(iLote < iItem && iItem < iReabrir, 'orden: crear lote, insertar foto, reabrir');
  assert.match(consultas[iReabrir].sql, /WHEN estado = 'completado' THEN 'en_cola'/);
  assert.deepEqual(consultas[iLote].params, ['L1', 'F', 'C', 'U']);
  await new Promise((r) => setImmediate(r)); // deja terminar el motor (no encuentra nada pendiente)
});
