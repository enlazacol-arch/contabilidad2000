// Pruebas de db-conexion.js -- reintento de LECTURAS cuando se corta la
// conexión con la base ("después de 20 minutos no me sale el lote").
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { conReintento, esErrorDeConexion, esLectura } = require('../db-conexion');

const silencioso = { warn() {}, error() {} };
const errConexion = () => Object.assign(new Error('Connection terminated unexpectedly'), {});

// Pool falso: la primera llamada falla con `errorPrimera`, las demás responden.
function poolQueFallaUnaVez(errorPrimera) {
  const llamadas = [];
  return {
    llamadas,
    async query(sql) {
      llamadas.push(sql);
      if (llamadas.length === 1) throw errorPrimera;
      return { rows: [{ ok: 1 }] };
    },
  };
}

test('esErrorDeConexion: cortes de conexión sí, errores de la consulta no', () => {
  assert.equal(esErrorDeConexion(errConexion()), true);
  assert.equal(esErrorDeConexion(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  assert.equal(esErrorDeConexion(Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })), true);
  assert.equal(esErrorDeConexion(Object.assign(new Error('timeout exceeded when trying to connect'), {})), true);
  assert.equal(esErrorDeConexion(Object.assign(new Error('column "x" does not exist'), { code: '42703' })), false);
  assert.equal(esErrorDeConexion(Object.assign(new Error('algo interno'), { code: 'XX000' })), false); // XX000 genérico sin hablar de conexión
});

test('esLectura: solo SELECT/WITH sin escrituras', () => {
  assert.equal(esLectura('SELECT * FROM lotes_procesamiento'), true);
  assert.equal(esLectura('  with x as (select 1) select * from x'), true);
  assert.equal(esLectura({ text: 'SELECT 1' }), true);
  assert.equal(esLectura('INSERT INTO lote_items VALUES (1)'), false);
  assert.equal(esLectura('UPDATE invoices SET x = 1'), false);
  assert.equal(esLectura('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x'), false);
});

test('Una LECTURA que falla por la conexión se reintenta y funciona', async () => {
  const pool = conReintento(poolQueFallaUnaVez(errConexion()), { pausaMs: 1, log: silencioso });
  const r = await pool.query('SELECT * FROM lotes_procesamiento WHERE id = $1', ['x']);
  assert.deepEqual(r.rows, [{ ok: 1 }]);
  assert.equal(pool.llamadas.length, 2);
});

test('Una ESCRITURA no se reintenta (podría duplicarse)', async () => {
  const pool = conReintento(poolQueFallaUnaVez(errConexion()), { pausaMs: 1, log: silencioso });
  await assert.rejects(() => pool.query('INSERT INTO lote_items VALUES (1)'), /Connection terminated/);
  assert.equal(pool.llamadas.length, 1);
});

test('Un error de la consulta (no de conexión) no se reintenta', async () => {
  const pool = conReintento(poolQueFallaUnaVez(Object.assign(new Error('column "x" does not exist'), { code: '42703' })), { pausaMs: 1, log: silencioso });
  await assert.rejects(() => pool.query('SELECT x FROM t'), /does not exist/);
  assert.equal(pool.llamadas.length, 1);
});
