'use strict';

// ---------- Conexión a la base de datos (Supabase) ----------
//
// Antes el pool de pg se creaba con la configuración de fábrica: sin
// keep-alive, sin tiempo máximo para conectar y sin manejo de errores.
// Cuando Supabase o la red cortaban una conexión, la siguiente consulta
// fallaba con error 500 -- se notaba con Carga masiva abierta un rato
// ("después de 20 minutos no me sale el lote", oct. 2026): la página
// consulta el lote cada pocos segundos y tarde o temprano le tocaba una
// conexión cortada.
//
// Aquí:
//  - keep-alive y tiempos razonables para conectar y para soltar las
//    conexiones inactivas;
//  - un manejador de errores del pool: si la base cierra una conexión
//    inactiva, se registra en el log en vez de tumbar el servidor;
//  - REINTENTO automático (una vez) de las consultas de LECTURA cuando el
//    error es de conexión. Las escrituras no se reintentan: si la conexión
//    se cortó justo después de ejecutarse, se duplicarían.

const { Pool } = require('pg');

// Errores de conexión (no de la consulta en sí): vale la pena reintentar.
const CODIGOS_CONEXION = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  '57P01', // admin_shutdown -- la base terminó la conexión
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', '08003', '08006', '08001', '08004', // connection_exception y familia
  'XX000', // Supavisor a veces responde así cuando corta una conexión del pool
]);
const MENSAJES_CONEXION = /connection terminated|connection error|terminating connection|server closed the connection|timeout exceeded when trying to connect|client has encountered a connection error|socket hang up|read econnreset/i;

function esErrorDeConexion(err) {
  if (!err) return false;
  if (err.code && CODIGOS_CONEXION.has(String(err.code))) {
    // XX000 es genérico: solo cuenta si el mensaje también habla de conexión.
    return err.code !== 'XX000' || MENSAJES_CONEXION.test(String(err.message || ''));
  }
  return MENSAJES_CONEXION.test(String(err.message || ''));
}

// Solo lecturas: SELECT (o WITH ... SELECT) sin nada que modifique.
function esLectura(sql) {
  const texto = String(typeof sql === 'object' && sql ? sql.text : sql || '').trim();
  if (!/^(select|with)\b/i.test(texto)) return false;
  return !/\b(insert|update|delete|alter|create|drop|truncate)\b/i.test(texto);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Envuelve pool.query: si una LECTURA falla por un error de conexión, se
// reintenta una vez (con otra conexión del pool) tras una pausa corta.
function conReintento(pool, { pausaMs = 300, log = console } = {}) {
  const queryOriginal = pool.query.bind(pool);
  pool.query = async function (...args) {
    try {
      return await queryOriginal(...args);
    } catch (err) {
      if (!esErrorDeConexion(err) || !esLectura(args[0])) throw err;
      log.warn(`[db] consulta de lectura falló por la conexión (${err.code || ''} ${err.message}); se reintenta una vez.`);
      await esperar(pausaMs);
      return queryOriginal(...args);
    }
  };
  return pool;
}

function crearPool(connectionString, { log = console } = {}) {
  const pool = new Pool({
    connectionString,
    ssl: String(connectionString || '').includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,       // suelta las conexiones inactivas antes de que las corte la base
    connectionTimeoutMillis: 10000, // no esperar para siempre una conexión nueva
    keepAlive: true,
  });
  // Sin este manejador, un error en una conexión INACTIVA (la base la cerró)
  // es una excepción no atrapada que tumba todo el servidor.
  pool.on('error', (err) => {
    log.error(`[db] la base cerró una conexión inactiva (${err.code || ''}): ${err.message}`);
  });
  return conReintento(pool, { log });
}

module.exports = { crearPool, conReintento, esErrorDeConexion, esLectura };
