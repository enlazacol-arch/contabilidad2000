// Pruebas de captura-movil.js -- el código QR para tomar fotos de
// facturas desde el celular, sin iniciar sesión en ese aparato.
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const cm = require('../captura-movil');

const ahora = Date.parse('2026-10-09T15:00:00Z');
const sesion = (extra) => ({ revocado: false, expira_at: new Date(ahora + 60000), fotos_recibidas: 0, ...extra });

// Pool falso: responde según el texto de la consulta.
function poolFalso(respuestas) {
  return {
    consultas: [],
    async query(sql, params) {
      this.consultas.push({ sql, params });
      for (const [patron, filas] of respuestas) if (sql.includes(patron)) return { rows: filas, rowCount: filas.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

test('el token es largo, aleatorio, y en la base solo queda su hash', () => {
  const a = cm.generarToken();
  const b = cm.generarToken();
  assert.ok(cm.tokenBienFormado(a.token));
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, cm.hashToken(a.token));
  assert.notEqual(a.hash, a.token);
});

test('tokens mal formados ni se consultan en la base', async () => {
  for (const t of ['', 'abc', 'x'.repeat(44), "' OR 1=1 --".padEnd(43, 'a'), null, undefined]) {
    assert.equal(cm.tokenBienFormado(t), false, String(t));
  }
  const pool = poolFalso([]);
  assert.equal(await cm.buscarPorToken(pool, 'corto'), null);
  assert.equal(pool.consultas.length, 0);
});

test('estado del QR: activo, vencido, desactivado, lleno, inexistente', () => {
  assert.equal(cm.estadoSesion(sesion(), ahora), 'activa');
  assert.equal(cm.estadoSesion(sesion({ expira_at: new Date(ahora - 1) }), ahora), 'vencida');
  assert.equal(cm.estadoSesion(sesion({ expira_at: new Date(ahora) }), ahora), 'vencida');
  assert.equal(cm.estadoSesion(sesion({ revocado: true }), ahora), 'revocada');
  assert.equal(cm.estadoSesion(sesion({ fotos_recibidas: cm.MAX_FOTOS_POR_QR }), ahora), 'llena');
  assert.equal(cm.estadoSesion(null, ahora), 'inexistente');
  for (const e of ['vencida', 'revocada', 'llena', 'inexistente']) assert.ok(cm.MENSAJES_ESTADO[e]);
});

test('el QR dura 2 horas', () => {
  assert.equal(cm.DURACION_MS, 2 * 60 * 60 * 1000);
});

test('solo se reciben fotos y PDF, bien formados y de tamaño razonable', () => {
  assert.equal(cm.validarArchivo({ base64: 'QUJD', mediaType: 'image/jpeg' }), null);
  assert.equal(cm.validarArchivo({ base64: 'QUJD', mediaType: 'application/pdf' }), null);
  assert.equal(cm.validarArchivo({ base64: 'QUJD', mediaType: 'IMAGE/HEIC' }), null);
  assert.match(cm.validarArchivo({ base64: 'QUJD', mediaType: 'text/html' }), /Solo se aceptan/);
  assert.match(cm.validarArchivo({ base64: 'QUJD', mediaType: 'application/zip' }), /Solo se aceptan/);
  assert.match(cm.validarArchivo({ base64: '<script>', mediaType: 'image/png' }), /dañada/);
  assert.match(cm.validarArchivo({ base64: 'A'.repeat(21 * 1024 * 1024), mediaType: 'image/png' }), /pesada/);
  assert.match(cm.validarArchivo({}), /No llegó/);
});

test('dirección del QR: APP_URL en producción, IP local si es localhost', () => {
  assert.equal(cm.urlBase({ appUrl: 'https://app.enlaza.co/', protocolo: 'http', host: 'localhost:3000', ipLocal: '192.168.1.5' }), 'https://app.enlaza.co');
  assert.equal(cm.urlBase({ protocolo: 'http', host: 'localhost:3000', ipLocal: '192.168.1.5' }), 'http://192.168.1.5:3000');
  assert.equal(cm.urlBase({ protocolo: 'http', host: '127.0.0.1:3000', ipLocal: '10.0.0.8' }), 'http://10.0.0.8:3000');
  assert.equal(cm.urlBase({ protocolo: 'https', host: 'enlaza.onrender.com', ipLocal: '10.0.0.8' }), 'https://enlaza.onrender.com');
  assert.equal(cm.urlBase({ protocolo: 'http', host: 'localhost:3000', ipLocal: null }), 'http://localhost:3000');
});

test('el token va en el fragmento (#), que el navegador no manda al servidor', () => {
  assert.equal(cm.urlCaptura('https://x.co', 'TOKEN'), 'https://x.co/captura-movil.html#t=TOKEN');
});

test('IP de la red local: la primera IPv4 que no es interna', () => {
  assert.equal(cm.ipRedLocal({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.1.20' }],
  }), '192.168.1.20');
  assert.equal(cm.ipRedLocal({}), null);
});

test('un QR nuevo desactiva los anteriores del mismo usuario y cliente, y guarda solo el hash', async () => {
  const pool = poolFalso([]);
  const s = await cm.crearSesion(pool, { contadorId: 'F', usuarioId: 'U', clienteId: 'C' });
  assert.equal(pool.consultas.length, 2);
  assert.match(pool.consultas[0].sql, /UPDATE capturas_movil SET revocado = true/);
  assert.deepEqual(pool.consultas[0].params, ['U', 'C']);
  const insert = pool.consultas[1];
  assert.match(insert.sql, /INSERT INTO capturas_movil/);
  assert.equal(insert.params[1], cm.hashToken(s.token));
  assert.ok(!insert.params.includes(s.token), 'el token en claro nunca va a la base');
});

test('reservar foto es atómico y respeta vencimiento, desactivación y máximo', async () => {
  const pool = poolFalso([['fotos_recibidas + 1', [{ fotos_recibidas: 4 }]]]);
  assert.equal(await cm.reservarFoto(pool, 'S'), 4);
  const sql = pool.consultas[0].sql;
  assert.match(sql, /revocado = false/);
  assert.match(sql, /expira_at > now\(\)/);
  assert.match(sql, /fotos_recibidas < \$2/);
  assert.equal(await cm.reservarFoto(poolFalso([]), 'S'), null);
});

test('el QR deja de servir si al usuario le quitan permisos', async () => {
  const s = { usuario_id: 'U', contador_id: 'F', cliente_id: 'C' };
  const base = (extra = {}) => poolFalso([
    ['FROM users', extra.users || [{ firma_id: 'F', role: 'contador' }]],
    ['FROM miembro_clientes', extra.asignados || []],
    ['FROM clients', extra.clientes || [{ '?column?': 1 }]],
  ]);
  assert.equal(await cm.usuarioSigueAutorizado(base(), s), true);
  assert.equal(await cm.usuarioSigueAutorizado(base({ asignados: [{ cliente_id: 'C' }] }), s), true);
  assert.equal(await cm.usuarioSigueAutorizado(base({ users: [] }), s), false, 'usuario borrado');
  assert.equal(await cm.usuarioSigueAutorizado(base({ users: [{ firma_id: 'OTRA', role: 'contador' }] }), s), false, 'cambió de firma');
  assert.equal(await cm.usuarioSigueAutorizado(base({ users: [{ firma_id: 'F', role: 'solo_lectura' }] }), s), false, 'pasó a solo lectura');
  assert.equal(await cm.usuarioSigueAutorizado(base({ asignados: [{ cliente_id: 'OTRO' }] }), s), false, 'le quitaron el cliente');
  assert.equal(await cm.usuarioSigueAutorizado(base({ clientes: [] }), s), false, 'el cliente ya no existe');
});

test('un id malformado no llega a la base (404, no error 500)', async () => {
  const pool = poolFalso([]);
  assert.equal(await cm.buscarDelUsuario(pool, 'abc', 'U'), null);
  assert.equal(await cm.revocar(pool, '1; DROP TABLE x', 'U'), false);
  assert.equal(pool.consultas.length, 0);
});
