'use strict';

// ---------- Procesamiento de lotes en segundo plano ----------
//
// Antes, "Carga masiva" leía cada factura en el propio navegador del
// contador -- si cambiaba de página, el trabajo se perdía por completo
// (el navegador destruye la página anterior y todo lo que tenía en
// memoria). Ahora el navegador solo SUBE los archivos una vez; de ahí
// en adelante es el SERVIDOR el que va leyendo cada uno con la IA, en
// segundo plano, sin importar si el contador se fue a otra página o
// cerró la pestaña -- mientras el servidor siga corriendo, el lote
// sigue avanzando.
//
// Cada lote es de UN usuario y UN cliente (o "sin cliente fijo"): en
// Carga masiva, cada contador ve solo lo que él subió para ese cliente
// (ver bandejaPendiente), aunque otra persona de la misma firma esté
// cargando facturas de otro cliente al mismo tiempo.
//
// Se lee un archivo a la vez (para no saturar la cuota de Gemini), pero
// por TURNOS entre los lotes en curso: un archivo de cada lote, en vez
// de terminar un lote completo antes de empezar el siguiente -- así un
// lote de 100 facturas no deja esperando a los demás.

let procesandoAhora = false;

// Se inyectan desde server.js para no duplicar la conexión a la base
// de datos ni la lógica de extracción -- este módulo no sabe nada de
// Express, solo de cómo mover un lote de "en_cola" a "completado".
let pool, crypto, procesarExtraccionFactura, procesarPaqueteDocumento, detectarClienteYMovimientoServidor;

function init(deps) {
  pool = deps.pool;
  crypto = deps.crypto;
  procesarExtraccionFactura = deps.procesarExtraccionFactura;
  procesarPaqueteDocumento = deps.procesarPaqueteDocumento;
  detectarClienteYMovimientoServidor = deps.detectarClienteYMovimientoServidor;
}

async function asegurarSchemaLotes() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lotes_procesamiento (
      id UUID PRIMARY KEY,
      contador_id UUID NOT NULL,
      cliente_id UUID,
      estado TEXT NOT NULL DEFAULT 'en_cola',
      total_items INTEGER NOT NULL DEFAULT 0,
      items_procesados INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lotes_contador ON lotes_procesamiento (contador_id, estado);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lote_items (
      id UUID PRIMARY KEY,
      lote_id UUID NOT NULL REFERENCES lotes_procesamiento(id) ON DELETE CASCADE,
      orden INTEGER NOT NULL DEFAULT 0,
      nombre_archivo TEXT NOT NULL DEFAULT '',
      base64 TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      es_pdf BOOLEAN NOT NULL DEFAULT false,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      data TEXT NOT NULL DEFAULT '{}',
      error_msg TEXT NOT NULL DEFAULT '',
      cliente_id_detectado UUID,
      tipo_movimiento_detectado TEXT NOT NULL DEFAULT 'egreso',
      eliminado BOOLEAN NOT NULL DEFAULT false,
      documento_indice INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lote_items_lote ON lote_items (lote_id, orden);`);
  // Migración para bases ya existentes de antes de que se agregara este
  // campo -- marca en qué posición del ARCHIVO ORIGINAL vive cada fila,
  // cuando ese archivo trajo varios documentos concatenados (ver
  // procesarUnItem más abajo). NULL para una fila que nunca se desglosó.
  await pool.query(`ALTER TABLE lote_items ADD COLUMN IF NOT EXISTS documento_indice INTEGER;`);
  // Quién subió el lote (los de antes quedan en NULL: los ve toda la
  // firma, como antes) y cuándo le tocó turno por última vez.
  await pool.query(`ALTER TABLE lotes_procesamiento ADD COLUMN IF NOT EXISTS usuario_id UUID;`);
  await pool.query(`ALTER TABLE lotes_procesamiento ADD COLUMN IF NOT EXISTS ultimo_turno TIMESTAMPTZ;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lotes_usuario_cliente ON lotes_procesamiento (contador_id, usuario_id, cliente_id);`);
}

// Crea un lote nuevo con sus archivos (todavía "en_cola"), y dispara el
// procesamiento en segundo plano -- no espera a que termine, responde
// de inmediato con el id del lote para que el navegador pueda
// consultarlo cuando quiera.
async function crearLote(contadorId, clienteId, archivos, usuarioId) {
  const loteId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO lotes_procesamiento (id, contador_id, cliente_id, estado, total_items, usuario_id) VALUES ($1, $2, $3, 'en_cola', $4, $5)`,
    [loteId, contadorId, clienteId || null, archivos.length, usuarioId || null]
  );
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i];
    await pool.query(
      `INSERT INTO lote_items (id, lote_id, orden, nombre_archivo, base64, media_type, es_pdf, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')`,
      [crypto.randomUUID(), loteId, i, a.nombre || '', a.base64 || '', a.mediaType || '', !!a.isPdf]
    );
  }
  dispararProcesamiento(); // fire-and-forget -- no se espera aquí
  return loteId;
}

// El "motor" de la cola -- lee un archivo pendiente a la vez, por
// turnos entre los lotes en curso (el lote que hace más tiempo no
// recibe turno va primero; ver siguienteItemPorTurno). Si ya hay un
// procesamiento en curso en este mismo proceso de Node, no arranca dos.
async function dispararProcesamiento() {
  if (procesandoAhora) return;
  procesandoAhora = true;
  try {
    while (true) {
      const item = await siguienteItemPorTurno();
      if (!item) break; // no hay nada pendiente, se detiene hasta que llegue un lote nuevo

      await pool.query(
        `UPDATE lotes_procesamiento SET estado = 'procesando', ultimo_turno = now(), updated_at = now() WHERE id = $1`,
        [item.lote_id]
      );
      await procesarUnItem(item, item.lote_contador_id);
      await pool.query(
        `UPDATE lotes_procesamiento SET items_procesados = items_procesados + 1, updated_at = now() WHERE id = $1`,
        [item.lote_id]
      );
      await cerrarLotesSinPendientes();
    }
    await cerrarLotesSinPendientes();
  } catch (err) {
    console.error('Error en el procesamiento de lotes en segundo plano:', err);
  } finally {
    procesandoAhora = false;
  }
}

// El próximo archivo a leer: del lote en curso que hace más tiempo no
// recibe turno (uno nuevo, sin turno todavía, va primero), su archivo
// pendiente de menor orden.
async function siguienteItemPorTurno() {
  const { rows } = await pool.query(
    `SELECT li.*, lp.contador_id AS lote_contador_id
       FROM lote_items li JOIN lotes_procesamiento lp ON lp.id = li.lote_id
      WHERE lp.estado IN ('en_cola', 'procesando') AND li.estado = 'pendiente' AND li.eliminado = false
      ORDER BY lp.ultimo_turno ASC NULLS FIRST, lp.created_at ASC, li.orden ASC, li.created_at ASC
      LIMIT 1`
  );
  return rows[0] || null;
}

// Un lote sin archivos pendientes queda "completado".
async function cerrarLotesSinPendientes() {
  await pool.query(
    `UPDATE lotes_procesamiento SET estado = 'completado', updated_at = now()
      WHERE estado IN ('en_cola', 'procesando')
        AND id NOT IN (SELECT lote_id FROM lote_items WHERE estado = 'pendiente' AND eliminado = false)`
  );
}

// Reintenta UN solo ítem (el contador le dio "Reintentar" a una fila
// específica, o quiere forzar releer un duplicado) -- lo marca
// pendiente otra vez y despierta el motor de la cola. `contadorId` se
// verifica contra el lote dueño del ítem, para que nadie pueda
// reintentar/tocar un ítem de OTRO contador solo adivinando su UUID.
async function reintentarItem(itemId, contadorId, forzar) {
  const { rows } = await pool.query(
    `UPDATE lote_items SET estado = 'pendiente', error_msg = '', data = $3
     WHERE id = $1 AND lote_id IN (SELECT id FROM lotes_procesamiento WHERE contador_id = $2)
     RETURNING lote_id`,
    [itemId, contadorId, JSON.stringify({ __forzar: !!forzar })]
  );
  if (rows.length > 0) {
    // El lote (padre) puede haber quedado marcado "completado" de antes
    // -- si no se despierta también a él, dispararProcesamiento() nunca
    // vuelve a mirarlo (su consulta solo busca lotes en_cola/procesando),
    // y este ítem se quedaría en "pendiente" para siempre sin que nadie
    // lo vuelva a procesar.
    await pool.query(
      `UPDATE lotes_procesamiento SET estado = 'en_cola', updated_at = now() WHERE id = $1 AND estado = 'completado'`,
      [rows[0].lote_id]
    );
  }
  dispararProcesamiento();
}

async function eliminarItem(itemId, contadorId) {
  await pool.query(
    `UPDATE lote_items SET eliminado = true
     WHERE id = $1 AND lote_id IN (SELECT id FROM lotes_procesamiento WHERE contador_id = $2)`,
    [itemId, contadorId]
  );
}

// Igual que en el navegador: si la IA rechaza el documento a propósito
// (422 -- no es factura ni cuenta de cobro), reintentar no cambia nada,
// así que no se reintenta solo. Si el error parece técnico (sin
// conexión con Gemini, un 500/503 momentáneo), sí vale la pena
// reintentar unas pocas veces antes de darse por vencido.
async function procesarExtraccionConReintento(contadorId, base64, mediaType, esPdf, forzar) {
  const MAX_INTENTOS = 3;
  const ESPERA_MS = 1500;
  let ultimoError;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      return await procesarExtraccionFactura(contadorId, base64, mediaType, esPdf, forzar);
    } catch (err) {
      ultimoError = err;
      if (err.status === 422) throw err;
      if (intento < MAX_INTENTOS) await new Promise((r) => setTimeout(r, ESPERA_MS));
    }
  }
  throw ultimoError;
}

// Igual que procesarExtraccionConReintento, pero para el prompt de
// paquete (puede traer varios documentos) -- ver procesarPaqueteDocumento
// en server.js.
async function procesarPaqueteConReintento(contadorId, base64, mediaType, forzar) {
  const MAX_INTENTOS = 3;
  const ESPERA_MS = 1500;
  let ultimoError;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      return await procesarPaqueteDocumento(contadorId, base64, mediaType, forzar);
    } catch (err) {
      ultimoError = err;
      if (err.status === 422) throw err;
      if (intento < MAX_INTENTOS) await new Promise((r) => setTimeout(r, ESPERA_MS));
    }
  }
  throw ultimoError;
}

// Guarda en UNA fila de lote_items el resultado de UN documento ya
// procesado -- ya sea un documento que llegó solo (envuelto como
// { tipo: 'factura', data }), o uno de los que salieron de desglosar un
// paquete (ver procesarUnItem). Misma lógica de siempre: duplicado,
// listo (cliente identificado con confianza) o revisar (no se pudo
// identificar el cliente/proveedor solo).
async function guardarResultadoDocumento(itemId, contadorId, doc) {
  if (doc.tipo === 'rechazado') {
    await pool.query(
      `UPDATE lote_items SET estado = 'error', error_msg = $2 WHERE id = $1`,
      [itemId, doc.mensaje || 'Este documento no parece ser una factura ni cuenta de cobro.']
    );
    return;
  }

  const parsed = doc.data;
  if (parsed.duplicado) {
    await pool.query(
      `UPDATE lote_items SET estado = 'duplicado', data = $2 WHERE id = $1`,
      [itemId, JSON.stringify(parsed)]
    );
    return;
  }

  // Si el lote se subió desde la ficha de un cliente, la detección solo
  // decide para ese cliente (ver detectarClienteYMovimientoServidor).
  const { rows: loteRows } = await pool.query(
    `SELECT l.cliente_id FROM lote_items i JOIN lotes_procesamiento l ON l.id = i.lote_id WHERE i.id = $1`,
    [itemId]
  );
  const clienteFijoId = loteRows.length > 0 ? loteRows[0].cliente_id : null;
  const deteccion = await detectarClienteYMovimientoServidor(contadorId, parsed, clienteFijoId);
  await pool.query(
    `UPDATE lote_items SET estado = $2, data = $3, cliente_id_detectado = $4, tipo_movimiento_detectado = $5 WHERE id = $1`,
    [itemId, deteccion.confiado ? 'listo' : 'revisar', JSON.stringify(parsed), deteccion.clienteId || null, deteccion.tipoMovimiento]
  );
}

// Un PDF puede traer varios documentos concatenados (varias facturas
// escaneadas y unidas en un solo archivo, por ejemplo) -- esta función
// los detecta y los DESGLOSA en filas independientes del lote, una por
// cada documento, para que el contador revise y guarde cada uno por su
// lado (en vez de que Carga masiva trate el archivo completo como una
// sola factura, que era el comportamiento de antes).
async function procesarUnItem(item, contadorId) {
  await pool.query(`UPDATE lote_items SET estado = 'procesando' WHERE id = $1`, [item.id]);

  // Si este ítem viene de un reintento, `data` trae temporalmente la
  // marca de "forzar" (ver reintentarItem) -- se lee y se limpia.
  let forzar = false;
  try {
    const marcaPrevia = JSON.parse(item.data || '{}');
    forzar = !!marcaPrevia.__forzar;
  } catch (e) { /* data no era la marca de reintento, se ignora */ }

  try {
    if (!item.es_pdf) {
      // Una foto es siempre un solo documento -- mismo camino de
      // siempre, sin pasar por el prompt de segmentación de paquete.
      const parsed = await procesarExtraccionConReintento(contadorId, item.base64, item.media_type, false, forzar);
      await guardarResultadoDocumento(item.id, contadorId, { tipo: 'factura', data: parsed });
      return;
    }

    const { documentos } = await procesarPaqueteConReintento(contadorId, item.base64, 'application/pdf', forzar);

    // Este ítem YA sabe en qué posición del archivo original vive (se
    // le marcó la primera vez que se procesó, ver más abajo) -- eso
    // pasa cuando se reintenta un documento que salió de desglosar un
    // paquete: solo hay que volver a guardar SU resultado puntual, sin
    // volver a insertar (ni tocar) a sus hermanos, o cada reintento
    // duplicaría todo el paquete de nuevo.
    if (item.documento_indice !== null && item.documento_indice !== undefined) {
      const doc = documentos[item.documento_indice] || { tipo: 'rechazado', mensaje: 'No se pudo volver a ubicar este documento dentro del archivo original -- intenta subirlo de nuevo por separado.' };
      await guardarResultadoDocumento(item.id, contadorId, doc);
      return;
    }

    // Primera vez que se procesa este archivo. Si trae un solo
    // documento (el caso normal, con mucha diferencia) esta fila se
    // queda igual que siempre. Si trae varios, esta fila se queda con
    // el PRIMERO y se insertan filas nuevas para cada uno de los demás
    // -- así el resumen de Carga masiva muestra cada documento como su
    // propia fila, lista para revisar y guardar de forma individual.
    if (documentos.length > 1) {
      await pool.query(
        `UPDATE lotes_procesamiento SET total_items = total_items + $2, updated_at = now() WHERE id = $1`,
        [item.lote_id, documentos.length - 1]
      );
      await pool.query(
        `UPDATE lote_items SET documento_indice = 0, nombre_archivo = $2 WHERE id = $1`,
        [item.id, `${item.nombre_archivo} (documento 1 de ${documentos.length})`]
      );
    } else {
      await pool.query(`UPDATE lote_items SET documento_indice = 0 WHERE id = $1`, [item.id]);
    }
    await guardarResultadoDocumento(item.id, contadorId, documentos[0]);

    for (let i = 1; i < documentos.length; i++) {
      const nuevoId = crypto.randomUUID();
      const nombreConSufijo = `${item.nombre_archivo} (documento ${i + 1} de ${documentos.length})`;
      await pool.query(
        `INSERT INTO lote_items (id, lote_id, orden, nombre_archivo, base64, media_type, es_pdf, estado, documento_indice)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'procesando', $7)`,
        [nuevoId, item.lote_id, item.orden, nombreConSufijo, item.base64, item.media_type, i]
      );
      await guardarResultadoDocumento(nuevoId, contadorId, documentos[i]);
      await pool.query(
        `UPDATE lotes_procesamiento SET items_procesados = items_procesados + 1, updated_at = now() WHERE id = $1`,
        [item.lote_id]
      );
    }
  } catch (err) {
    await pool.query(
      `UPDATE lote_items SET estado = 'error', error_msg = $2 WHERE id = $1`,
      [item.id, err.publicMessage || err.message || 'No se pudo procesar este archivo.']
    );
  }
}

// Lo pendiente de revisar en Carga masiva para UN usuario y UN cliente
// (clienteId null = lotes subidos sin cliente fijo): todos los archivos
// de sus lotes que todavía no se guardaron ni se quitaron, de los
// últimos DIAS_BANDEJA días -- no solo los del último lote, para que
// subir un lote nuevo no esconda lo que quedó sin revisar del anterior.
// Los lotes de antes de este cambio (sin usuario) los ve toda la firma.
// Devuelve la misma forma que antes tenía "el lote activo" (id, estado,
// total_items, items_procesados, items), sumando los lotes en curso.
const DIAS_BANDEJA = 30;
async function bandejaPendiente(contadorId, usuarioId, clienteId) {
  const { rows: lotes } = await pool.query(
    `SELECT * FROM lotes_procesamiento
      WHERE contador_id = $1 AND (usuario_id = $2 OR usuario_id IS NULL)
        AND (cliente_id = $3 OR ($3::uuid IS NULL AND cliente_id IS NULL))
        AND created_at > $4
      ORDER BY created_at ASC`,
    [contadorId, usuarioId || null, clienteId || null, new Date(Date.now() - DIAS_BANDEJA * 86400000)]
  );
  if (lotes.length === 0) return null;
  const { rows: items } = await pool.query(
    `SELECT li.id, li.orden, li.nombre_archivo, li.media_type, li.es_pdf, li.estado, li.data, li.error_msg,
            li.cliente_id_detectado, li.tipo_movimiento_detectado, li.lote_id
       FROM lote_items li JOIN lotes_procesamiento lp ON lp.id = li.lote_id
      WHERE li.lote_id = ANY($1::uuid[]) AND li.eliminado = false
      ORDER BY lp.created_at ASC, li.orden ASC, li.created_at ASC`,
    [lotes.map((l) => l.id)]
  );
  const enCurso = lotes.filter((l) => l.estado === 'en_cola' || l.estado === 'procesando');
  const conItems = new Set(items.map((it) => it.lote_id));
  // Sin nada pendiente ni en curso, no hay bandeja que mostrar.
  if (enCurso.length === 0 && conItems.size === 0) return null;
  const ultimo = lotes[lotes.length - 1];
  return {
    id: ultimo.id,
    cliente_id: clienteId || null,
    estado: enCurso.length > 0 ? 'procesando' : 'completado',
    total_items: enCurso.reduce((s, l) => s + Number(l.total_items || 0), 0),
    items_procesados: enCurso.reduce((s, l) => s + Number(l.items_procesados || 0), 0),
    items,
  };
}

// Los lotes de un usuario en curso, y los terminados en las últimas 24
// horas, con el nombre del cliente -- para el aviso flotante que sale en
// todas las páginas.
async function lotesDelUsuario(contadorId, usuarioId) {
  const { rows } = await pool.query(
    `SELECT lp.id, lp.cliente_id, c.nombre AS cliente_nombre, lp.estado, lp.total_items, lp.items_procesados, lp.updated_at
       FROM lotes_procesamiento lp LEFT JOIN clients c ON c.id = lp.cliente_id
      WHERE lp.contador_id = $1 AND lp.usuario_id = $2
        AND (lp.estado IN ('en_cola', 'procesando') OR lp.updated_at > $3)
      ORDER BY lp.created_at DESC
      LIMIT 20`,
    [contadorId, usuarioId, new Date(Date.now() - 86400000)]
  );
  return rows;
}

// El archivo original (base64) de UN ítem puntual -- aparte, para no
// cargar el peso de todos los archivos en cada consulta del lote
// activo (eso se pide seguido, para el avisito). Esto solo se pide
// cuando el contador de verdad hace clic en "Ver".
async function obtenerArchivoItem(itemId, contadorId) {
  const { rows } = await pool.query(
    `SELECT base64, media_type, es_pdf, nombre_archivo FROM lote_items
     WHERE id = $1 AND lote_id IN (SELECT id FROM lotes_procesamiento WHERE contador_id = $2)`,
    [itemId, contadorId]
  );
  return rows[0] || null;
}

module.exports = {
  init,
  asegurarSchemaLotes,
  crearLote,
  dispararProcesamiento,
  reintentarItem,
  eliminarItem,
  bandejaPendiente,
  lotesDelUsuario,
  obtenerArchivoItem,
};