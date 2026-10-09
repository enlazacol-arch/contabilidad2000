'use strict';

// ---------- Captura desde el celular con código QR ----------
//
// Las facturas físicas casi nunca están junto al computador: Escanear y
// Carga masiva muestran (en pantallas de computador) un código QR que
// abre /captura-movil.html en el celular, para tomar las fotos ahí sin
// iniciar sesión con Google en ese aparato.
//
// El QR lleva un permiso temporal (token) que SOLO sirve para subir
// fotos de UN cliente, a nombre del usuario que lo generó, durante
// DURACION_MS. No deja ver facturas, clientes ni nada más. En la base
// solo se guarda el hash del token -- quien lea la tabla no puede
// armar un QR válido.
//
// Las fotos entran a un lote de Carga masiva (uno por QR, ver
// lotes.agregarArchivoALote): el servidor las lee con la IA en segundo
// plano y Carga masiva de ese cliente las muestra solas ("subidas desde
// otro aparato").

const crypto = require('crypto');

const DURACION_MS = 2 * 60 * 60 * 1000; // 2 horas
const MAX_FOTOS_POR_QR = 300;
const MAX_BYTES_ARCHIVO = 15 * 1024 * 1024; // ya comprimidas en el celular, una foto pesa ~1 MB
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

function generarToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Un token bien formado: 32 bytes en base64url = 43 caracteres. Se
// revisa antes de ir a la base para no gastar consultas en basura.
function tokenBienFormado(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

// 'activa' | 'vencida' | 'revocada' | 'inexistente' | 'llena'
function estadoSesion(sesion, ahora = Date.now()) {
  if (!sesion) return 'inexistente';
  if (sesion.revocado) return 'revocada';
  if (new Date(sesion.expira_at).getTime() <= ahora) return 'vencida';
  if (Number(sesion.fotos_recibidas || 0) >= MAX_FOTOS_POR_QR) return 'llena';
  return 'activa';
}

const MENSAJES_ESTADO = {
  inexistente: 'Este código QR no es válido. Genera uno nuevo desde Enlaza en el computador.',
  vencida: 'Este código QR ya venció. Genera uno nuevo desde Enlaza en el computador.',
  revocada: 'Este código QR fue desactivado. Genera uno nuevo desde Enlaza en el computador.',
  llena: `Este código QR ya recibió ${MAX_FOTOS_POR_QR} fotos. Genera uno nuevo desde Enlaza en el computador.`,
};

// Devuelve un mensaje de error, o null si el archivo se puede recibir.
function validarArchivo({ base64, mediaType } = {}) {
  if (!base64 || typeof base64 !== 'string') return 'No llegó la foto.';
  if (!TIPOS_PERMITIDOS.includes(String(mediaType || '').toLowerCase())) {
    return 'Solo se aceptan fotos (JPG, PNG, WEBP, HEIC) o PDF.';
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) return 'La foto llegó dañada -- intenta tomarla de nuevo.';
  if (base64.length * 0.75 > MAX_BYTES_ARCHIVO) return 'La foto es demasiado pesada (máximo 15 MB).';
  return null;
}

// Dirección del celular: APP_URL (producción) o la del propio pedido.
// Si es localhost, el celular no llegaría nunca (localhost en el
// celular es el celular), así que en desarrollo se cambia por la IP de
// este computador en la red local -- el celular tiene que estar en la
// misma red Wi-Fi.
function urlBase({ appUrl, protocolo, host, ipLocal }) {
  if (appUrl) return String(appUrl).replace(/\/+$/, '');
  const h = String(host || '');
  const esLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h);
  if (esLocal && ipLocal) {
    const puerto = h.includes(':') && !h.startsWith('[') ? h.slice(h.lastIndexOf(':')) : '';
    return `${protocolo}://${ipLocal}${puerto}`;
  }
  return `${protocolo}://${h}`;
}

function urlCaptura(base, token) {
  return `${base}/captura-movil.html#t=${token}`;
}

function ipRedLocal(interfaces) {
  for (const lista of Object.values(interfaces || {})) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

// ---------- Base de datos ----------

async function asegurarSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capturas_movil (
      id UUID PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      contador_id UUID NOT NULL,
      usuario_id UUID NOT NULL,
      cliente_id UUID NOT NULL,
      lote_id UUID NOT NULL,
      expira_at TIMESTAMPTZ NOT NULL,
      revocado BOOLEAN NOT NULL DEFAULT false,
      fotos_recibidas INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_capturas_movil_usuario ON capturas_movil (usuario_id, created_at DESC);`);
}

// Crea un QR nuevo y desactiva los anteriores de este usuario para este
// cliente -- así nunca quedan varios QR vivos circulando para lo mismo.
async function crearSesion(pool, { contadorId, usuarioId, clienteId }) {
  const { token, hash } = generarToken();
  const id = crypto.randomUUID();
  const loteId = crypto.randomUUID(); // el lote se crea con la primera foto
  const expiraAt = new Date(Date.now() + DURACION_MS);
  await pool.query(
    `UPDATE capturas_movil SET revocado = true WHERE usuario_id = $1 AND cliente_id = $2 AND revocado = false`,
    [usuarioId, clienteId]
  );
  await pool.query(
    `INSERT INTO capturas_movil (id, token_hash, contador_id, usuario_id, cliente_id, lote_id, expira_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, hash, contadorId, usuarioId, clienteId, loteId, expiraAt]
  );
  return { id, token, expiraAt };
}

async function buscarPorToken(pool, token) {
  if (!tokenBienFormado(token)) return null;
  const { rows } = await pool.query(
    `SELECT cm.*, c.nombre AS cliente_nombre
       FROM capturas_movil cm LEFT JOIN clients c ON c.id = cm.cliente_id
      WHERE cm.token_hash = $1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buscarDelUsuario(pool, id, usuarioId) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows } = await pool.query(
    `SELECT id, cliente_id, expira_at, revocado, fotos_recibidas FROM capturas_movil WHERE id = $1 AND usuario_id = $2`,
    [id, usuarioId]
  );
  return rows[0] || null;
}

async function revocar(pool, id, usuarioId) {
  if (!UUID_RE.test(String(id))) return false;
  const { rowCount } = await pool.query(
    `UPDATE capturas_movil SET revocado = true WHERE id = $1 AND usuario_id = $2`,
    [id, usuarioId]
  );
  return rowCount > 0;
}

// Reserva el cupo de una foto de forma atómica (dos fotos subidas a la
// vez no pueden pasarse del máximo ni colarse en un QR ya vencido).
async function reservarFoto(pool, id) {
  const { rows } = await pool.query(
    `UPDATE capturas_movil SET fotos_recibidas = fotos_recibidas + 1
      WHERE id = $1 AND revocado = false AND expira_at > now() AND fotos_recibidas < $2
      RETURNING fotos_recibidas`,
    [id, MAX_FOTOS_POR_QR]
  );
  return rows[0] ? rows[0].fotos_recibidas : null;
}

async function liberarFoto(pool, id) {
  await pool.query(`UPDATE capturas_movil SET fotos_recibidas = GREATEST(fotos_recibidas - 1, 0) WHERE id = $1`, [id]);
}

// Lo que el QR permitía cuando se generó se vuelve a revisar en cada
// foto: si al usuario le quitaron el cliente, lo pasaron a solo
// lectura o lo sacaron de la firma, el QR deja de servir de inmediato.
async function usuarioSigueAutorizado(pool, sesion) {
  const { rows } = await pool.query('SELECT firma_id, role FROM users WHERE id = $1', [sesion.usuario_id]);
  if (rows.length === 0) return false;
  if ((rows[0].firma_id || sesion.usuario_id) !== sesion.contador_id) return false;
  if (rows[0].role === 'solo_lectura') return false;
  const asignados = await pool.query('SELECT cliente_id FROM miembro_clientes WHERE usuario_id = $1', [sesion.usuario_id]);
  if (asignados.rows.length > 0 && !asignados.rows.some((r) => r.cliente_id === sesion.cliente_id)) return false;
  const cliente = await pool.query('SELECT 1 FROM clients WHERE id = $1 AND contador_id = $2', [sesion.cliente_id, sesion.contador_id]);
  return cliente.rows.length > 0;
}

module.exports = {
  DURACION_MS,
  MAX_FOTOS_POR_QR,
  MENSAJES_ESTADO,
  generarToken,
  hashToken,
  tokenBienFormado,
  estadoSesion,
  validarArchivo,
  urlBase,
  urlCaptura,
  ipRedLocal,
  asegurarSchema,
  crearSesion,
  buscarPorToken,
  buscarDelUsuario,
  revocar,
  reservarFoto,
  liberarFoto,
  usuarioSigueAutorizado,
};
