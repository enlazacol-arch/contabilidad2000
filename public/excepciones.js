// ---------------------------------------------------------------------
// Definición ÚNICA de las "excepciones" (avisos) que Enlaza puede
// detectar sobre una factura YA GUARDADA -- Tarea 8 de la hoja de ruta
// ("excepciones unificadas").
//
// Antes de este archivo, cada pantalla tenía su PROPIA copia a mano de
// estos chequeos (duplicado por hash, sin NIT, letras vs. números,
// saldo vencido, anticipo detectado), con textos ligeramente distintos
// entre sí y sin ninguna forma de volver a verlos una vez la factura
// quedaba guardada -- el mismo riesgo de desincronización silenciosa que
// ya resolvió public/retenciones.js para las tarifas de retención. Ahora
// hay un solo lugar que define QUÉ cuenta como excepción y CÓMO se
// explica, y facturas.html/revision.html lo usan igual.
//
// Nota de alcance -- "duplicado por hash" NO vive aquí: ese chequeo es
// preventivo (impide guardar la factura repetida, ver buscarFacturaPorHash
// en server.js) y no aplica a una factura que ya está guardada, así que
// no tiene sentido como una excepción "detectada después". Las 5
// excepciones de este archivo son justo las que SÍ pueden convivir con
// una factura ya guardada y por eso necesitan quedar visibles después,
// no solo en el momento de digitarla.
//
// Se carga de las dos formas de siempre en esta app (ver el mismo patrón
// en public/retenciones.js): como <script> plano en el navegador
// (Escanear, Carga masiva, Facturas, Revisión -- queda como funciones
// globales) y, al final del archivo, como módulo de Node si algún día
// hace falta desde server.js o desde una prueba automatizada.
//
// listaExcepciones(inv) recibe una factura (fila de `invoices`, o el
// objeto que ya trae la IA con esos mismos nombres de campo) y devuelve
// un arreglo `[{ tipo, etiqueta, detalle }]` -- vacío si no tiene
// ninguna. `detalle` es texto plano listo para mostrarle al contador
// (hay que escaparlo con escapeHtml antes de insertarlo en el DOM, igual
// que cualquier otro texto de la factura).
'use strict';

// Copia idéntica a la que ya usan escanear.html/masivo.html para "sin
// NIT" -- quita el dígito de verificación (si viene pegado con guión) y
// se queda solo con los dígitos. Un NIT vacío después de esto es lo que
// cuenta como "sin NIT".
function soloDigitosParaExcepciones(nit) {
  let s = String(nit || '').trim();
  s = s.replace(/-\s*\d$/, '');
  return s.replace(/[^0-9]/g, '');
}

function formatCOPParaExcepciones(value) {
  const num = Number(value);
  if (isNaN(num)) return String(value || '—');
  return '$' + num.toLocaleString('es-CO');
}

// Tolerancia (en pesos) para las comparaciones de cuadratura de valores
// -- la MISMA que ya usan generarAsientoEgreso() (asientos.js) y el
// cálculo de valores_descuadrados al guardar (server.js). Antes de esta
// tarea, el aviso "no cuadra" que se mostraba ANTES de guardar en
// Escanear y Carga masiva usaba $5 de tolerancia mientras el servidor ya
// usaba $1 -- exactamente el tipo de desincronización silenciosa que
// esta tarea busca evitar: una factura podía pasar el aviso de "sí
// cuadra" en pantalla y aun así quedar marcada valores_descuadrados=true
// (y sin asiento propuesto) apenas se guardaba. Ahora las dos usan este
// mismo número.
const TOLERANCIA_DESCUADRE = 1;

// Chequeo puro de cuadratura -- para usarlo ANTES de guardar, cuando
// todavía no existe la columna valores_descuadrados (esa es la que lee
// la excepción 'descuadre' de la lista de abajo, ya persistida por el
// servidor). Misma cuenta, dos momentos distintos.
function valoresDescuadrados(inv) {
  if (!inv) return false;
  const sinIva = Number(inv.valor_sin_iva) || 0;
  const iva = Number(inv.valor_iva) || 0;
  const conIva = Number(inv.valor_con_iva) || 0;
  return sinIva > 0 && conIva > 0 && Math.abs((sinIva + iva) - conIva) > TOLERANCIA_DESCUADRE;
}

// Valores con los que el número escrito en letras puede coincidir: el
// total, o el neto a pagar (total menos retenciones y/o abonos).
function valoresQueCuadranConLetras(inv) {
  const n = (v) => Number(v) || 0;
  const total = n(inv.valor_con_iva);
  const retenciones = n(inv.rete_fuente) + n(inv.rete_iva) + n(inv.rete_ica);
  const abonado = n(inv.valor_abonado);
  return [total, total - retenciones, total - abonado, total - retenciones - abonado];
}

// Cada definición: `tipo` (id estable, útil para CSS/filtros), `etiqueta`
// (texto corto para la insignia), `detecta(inv)` (boolean) y
// `detalle(inv)` (la explicación completa, para el panel/tooltip).
// Fórmula del dígito de verificación de la DIAN: vive en movimiento.js
// (en el navegador como función global, en el servidor con require).
function dvNoCoincide(inv) {
  const calcular = (typeof calcularDvNit === 'function') ? calcularDvNit
    : (typeof require === 'function' ? require('./movimiento').calcularDvNit : null);
  if (!calcular) return false;
  const nit = soloDigitosParaExcepciones(inv.nit_cc);
  const dv = String(inv.dv == null ? '' : inv.dv).trim();
  if (!nit || !/^\d$/.test(dv)) return false;
  const esperado = calcular(nit);
  return !!esperado && esperado !== dv;
}

// ---------- Lectura dudosa ----------
// La IA a veces lee mal un número (foto girada, borrosa, con sombra) y
// arma el resto alrededor de ese error para que "cuadre" -- pasó con una
// factura de EPM: la energía (2.803 kWh) salió en $25.828 en vez de
// ~$2,5 millones, y el total quedó en $444.387 cuando el documento dice
// en grande $3.001.188. Aquí se juntan las pruebas de que la lectura no
// es confiable, con lo que el propio documento dice:
//   - el TOTAL A PAGAR impreso (total_a_pagar_impreso, copiado tal cual)
//     no coincide con el total leído (ni con el total menos retenciones
//     o abonos);
//   - las líneas leídas no suman el subtotal;
//   - la IA misma dijo que no leyó bien algo (lectura_dudosa);
//   - la IA tiene poca confianza en un valor clave.
// Se calcula EN VIVO: si el contador corrige el valor mal leído y todo
// vuelve a cuadrar con el total impreso, el aviso de los dos primeros
// motivos desaparece solo.
const CONFIANZA_MINIMA_LECTURA = 0.6;
const ETIQUETAS_CONFIANZA = { valor_sin_iva: 'el valor sin IVA', valor_iva: 'el IVA', valor_con_iva: 'el total', nit_cc: 'el NIT del emisor' };
function itemsParaExcepciones(inv) {
  if (Array.isArray(inv.items)) return inv.items;
  if (typeof inv.items === 'string') { try { const x = JSON.parse(inv.items); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  return [];
}
function motivosLecturaDudosa(inv) {
  if (!inv) return [];
  const motivos = [];
  const n = (v) => Number(v) || 0;
  const total = n(inv.valor_con_iva);
  const impreso = n(inv.total_a_pagar_impreso);
  if (impreso > 0 && total > 0) {
    const retenciones = n(inv.rete_fuente) + n(inv.rete_iva) + n(inv.rete_ica);
    const abonado = n(inv.valor_abonado);
    const candidatos = [total, total - retenciones, total - abonado, total - retenciones - abonado];
    if (!candidatos.some((c) => Math.abs(c - impreso) <= 1)) {
      const saldo = inv.saldo_vencido_detectado === true || inv.saldo_vencido_detectado === 'true';
      motivos.push(`El total a pagar impreso en el documento (${formatCOPParaExcepciones(impreso)}) no coincide con el total leído (${formatCOPParaExcepciones(total)})${saldo ? ' -- puede incluir saldo de periodos anteriores' : ''}.`);
    }
  }
  const items = itemsParaExcepciones(inv);
  if (items.length > 0) {
    const suma = items.reduce((t, it) => t + n(it && it.subtotal), 0);
    if (Math.abs(suma - n(inv.valor_sin_iva)) > 1) {
      motivos.push(`Las líneas leídas suman ${formatCOPParaExcepciones(suma)}, pero el subtotal es ${formatCOPParaExcepciones(inv.valor_sin_iva)}.`);
    }
  }
  if (inv.lectura_dudosa === true || inv.lectura_dudosa === 'true') {
    motivos.push(`La IA indicó que no leyó bien parte del documento${inv.motivo_lectura_dudosa ? ': ' + inv.motivo_lectura_dudosa : '.'}`);
  }
  const conf = inv.confianza_campos && typeof inv.confianza_campos === 'object' ? inv.confianza_campos : {};
  const dudosos = Object.keys(ETIQUETAS_CONFIANZA).filter((k) => conf[k] !== undefined && Number(conf[k]) < CONFIANZA_MINIMA_LECTURA);
  if (dudosos.length > 0) {
    motivos.push(`La IA no está segura de ${dudosos.map((k) => ETIQUETAS_CONFIANZA[k]).join(', ')}.`);
  }
  return motivos;
}

const DEFINICIONES_EXCEPCIONES = [
  {
    tipo: 'lectura_dudosa',
    etiqueta: 'Lectura dudosa',
    detecta: (inv) => motivosLecturaDudosa(inv).length > 0,
    detalle: (inv) => `Revisa los valores contra el documento antes de guardar: ${motivosLecturaDudosa(inv).join(' ')}`,
  },
  {
    // La misma factura no se causa dos veces (ver duplicados.js): aviso
    // desde que se lee, con la factura ya guardada con la que coincide.
    tipo: 'posible_duplicado',
    etiqueta: 'Posible duplicado',
    detecta: (inv) => !!(inv.posible_duplicado && inv.posible_duplicado.mensaje),
    detalle: (inv) => `${inv.posible_duplicado.mensaje} Revisa antes de guardarla para no causarla dos veces.`,
  },
  {
    tipo: 'sin_nit',
    etiqueta: 'Sin NIT',
    detecta: (inv) => !soloDigitosParaExcepciones(inv.nit_cc),
    detalle: () => 'El emisor quedó sin un NIT/cédula numérico -- verifica que el documento realmente no lo traiga antes de reportarlo así.',
  },
  {
    tipo: 'nit_por_verificar',
    etiqueta: 'NIT por verificar',
    detecta: (inv) => !!inv.aviso_nit || dvNoCoincide(inv),
    detalle: (inv) => inv.aviso_nit
      ? `${inv.aviso_nit} Compáralo con el documento antes de guardar.`
      : `El dígito de verificación (${inv.dv}) no corresponde al NIT ${soloDigitosParaExcepciones(inv.nit_cc)} -- uno de los dos quedó mal leído o digitado.`,
  },
  {
    tipo: 'letras_no_coincide',
    etiqueta: 'Letras ≠ números',
    // Muchas facturas escriben en letras el NETO a pagar (total menos
    // retenciones y abonos), no el total -- eso no es un error. Y si el
    // contador ya lo revisó (letras_revisado), no se vuelve a avisar.
    detecta: (inv) => {
      if (!inv.valor_letras_texto) return false;
      if (inv.letras_revisado === true || inv.letras_revisado === 'true') return false;
      const numero = Number(inv.valor_letras_numero) || 0;
      return numero > 0 && !valoresQueCuadranConLetras(inv).some((v) => Math.abs(numero - v) <= 1);
    },
    detalle: (inv) => {
      const numero = Number(inv.valor_letras_numero) || 0;
      const total = Number(inv.valor_con_iva) || 0;
      const n = (v) => Number(v) || 0;
      const retenciones = n(inv.rete_fuente) + n(inv.rete_iva) + n(inv.rete_ica);
      const base = `El valor escrito en letras ("${inv.valor_letras_texto}", ≈ ${formatCOPParaExcepciones(numero)}) no coincide con el total (${formatCOPParaExcepciones(total)}) ni con el valor a pagar (${formatCOPParaExcepciones(total - retenciones - n(inv.valor_abonado))}).`;
      const diferencia = total - numero;
      if (diferencia > 0 && retenciones > 0) {
        return `${base} Las letras equivalen al total menos ${formatCOPParaExcepciones(diferencia)}: parece el valor a pagar con una retención de ${formatCOPParaExcepciones(diferencia)}, pero la registrada es ${formatCOPParaExcepciones(retenciones)} -- revisa cuál es la correcta en el documento.`;
      }
      if (diferencia > 0) {
        return `${base} Las letras equivalen al total menos ${formatCOPParaExcepciones(diferencia)}: si el documento descuenta una retención o un abono de ese valor, regístralo.`;
      }
      return `${base} Puede ser un error de digitación o de imprenta del documento original.`;
    },
  },
  {
    tipo: 'saldo_vencido',
    etiqueta: 'Saldo vencido',
    detecta: (inv) => inv.saldo_vencido_detectado === true || inv.saldo_vencido_detectado === 'true',
    detalle: () => 'El documento muestra explícitamente un saldo vencido de un periodo anterior -- confirma que ese saldo no se esté registrando dos veces.',
  },
  {
    tipo: 'anticipo',
    etiqueta: 'Anticipo',
    detecta: (inv) => inv.anticipo_detectado === true || inv.anticipo_detectado === 'true',
    detalle: (inv) => (Number(inv.valor_abonado) || 0) > 0
      ? `El documento indica un anticipo ya abonado de ${formatCOPParaExcepciones(inv.valor_abonado)} -- confirma que el registro contable no lo esté cobrando de nuevo.`
      : 'El documento menciona un anticipo o avance ya entregado, sin dar un valor exacto -- revisa si el total ya lo descuenta.',
  },
  {
    tipo: 'descuadre',
    etiqueta: 'Valores no cuadran',
    // En vivo con los valores actuales (antes usaba la marca guardada al
    // crear la factura, y el aviso seguía aunque ya se hubiera corregido).
    detecta: (inv) => valoresDescuadrados(inv),
    detalle: (inv) => {
      const sinIva = Number(inv.valor_sin_iva) || 0;
      const iva = Number(inv.valor_iva) || 0;
      return `Subtotal + IVA (${formatCOPParaExcepciones(sinIva + iva)}) no coincide con el Total (${formatCOPParaExcepciones(inv.valor_con_iva)}) -- por eso, si es egreso, probablemente tampoco tenga un asiento contable propuesto.`;
    },
  },
];

function listaExcepciones(inv) {
  if (!inv) return [];
  const encontradas = [];
  for (const def of DEFINICIONES_EXCEPCIONES) {
    let aplica = false;
    try { aplica = !!def.detecta(inv); } catch (e) { aplica = false; }
    if (aplica) encontradas.push({ tipo: def.tipo, etiqueta: def.etiqueta, detalle: def.detalle(inv) });
  }
  return encontradas;
}

// Chequeo puntual de UNA sola excepción por su `tipo` -- para las
// pantallas de captura (Escanear, Carga masiva), que necesitan preguntar
// "¿esta condición puntual aplica?" en un punto concreto del flujo (por
// ejemplo, para decidir si mostrar el botón "guardar de todas formas"),
// en vez de recalcular las 5 con listaExcepciones() cada vez.
function tieneExcepcion(inv, tipo) {
  if (!inv) return false;
  const def = DEFINICIONES_EXCEPCIONES.find((d) => d.tipo === tipo);
  if (!def) return false;
  try { return !!def.detecta(inv); } catch (e) { return false; }
}

// ---------- Export para Node (mismo patrón que public/retenciones.js) ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFINICIONES_EXCEPCIONES,
    listaExcepciones,
    tieneExcepcion,
    soloDigitosParaExcepciones,
    valoresDescuadrados,
    TOLERANCIA_DESCUADRE,
    motivosLecturaDudosa,
  };
}
