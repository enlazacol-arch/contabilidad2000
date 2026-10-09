'use strict';

// ---------- Una factura que la IA partió en varios "documentos" ----------
//
// Escanear y Carga masiva (y las fotos del celular) le piden a la IA que
// separe un archivo en documentos distintos (PAQUETE_PROMPT): una foto
// puede traer tres tiquetes, un PDF varias facturas. A veces la IA parte
// UNA sola factura en dos: pasó con Manos Activas SI 43076 (oct. 2026),
// donde la línea "SERVICIO ASEO" ($2.909.057) y la línea "AIU" ($290.906
// + IVA $55.272) salieron como dos facturas -- la segunda quedó con un
// total de $346.178 en vez de $3.255.235.
//
// Dos "documentos" del mismo emisor (NIT) con el mismo número de factura
// son la misma factura: aquí se vuelven a unir. Para saber si hay que
// SUMAR las partes (cada una trae unas líneas) o quedarse con UNA (la IA
// repitió la factura completa), se usa el valor en letras como árbitro:
// es el total que el propio documento escribe en palabras.

const CAMPOS_VALOR = ['valor_sin_iva', 'valor_iva', 'valor_con_iva', 'rete_fuente', 'rete_iva', 'rete_ica'];

function soloDigitos(v) {
  return String(v == null ? '' : v).replace(/-\s*\d$/, '').replace(/[^0-9]/g, '');
}

// Clave de la factura: NIT del emisor + prefijo + número (sin ceros a la
// izquierda). Sin NIT o sin número no hay cómo saber que son la misma.
function claveFactura(d) {
  const nit = soloDigitos(d && d.nit_cc);
  const numero = soloDigitos(d && d.numeros_fe).replace(/^0+/, '');
  if (!nit || !numero) return '';
  const letras = String((d && d.letras_fe) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${nit}|${letras}${numero}`;
}

function num(v) {
  return Number(v) || 0;
}

function sumarObjetos(a, b) {
  const parse = (x) => {
    if (!x) return {};
    if (typeof x === 'string') { try { return JSON.parse(x) || {}; } catch (e) { return {}; } }
    return typeof x === 'object' && !Array.isArray(x) ? x : {};
  };
  const salida = { ...parse(a) };
  for (const [k, v] of Object.entries(parse(b))) salida[k] = num(salida[k]) + num(v);
  return salida;
}

function itemsDe(d) {
  if (Array.isArray(d.items)) return d.items;
  if (typeof d.items === 'string') { try { const x = JSON.parse(d.items); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  return [];
}

// Une las partes de UNA factura. `partes` son los datos ya
// pos-procesados de cada documento (mismo emisor y número).
function unirPartes(partes) {
  const letras = partes.map((p) => num(p.valor_letras_numero)).find((v) => v > 0) || 0;
  const coincideLetras = (total) => letras > 0 && Math.abs(total - letras) <= 1;
  const sumaTotal = partes.reduce((s, p) => s + num(p.valor_con_iva), 0);

  // ¿Alguna parte, sola, ya es la factura completa? (la IA la repitió)
  const completa = partes.find((p) => coincideLetras(num(p.valor_con_iva)));
  let base;
  if (completa && !coincideLetras(sumaTotal)) {
    base = { ...completa };
  } else if (!letras && partes.every((p) => num(p.valor_con_iva) === num(partes[0].valor_con_iva))) {
    // Sin letras para comparar y con el mismo total: es la misma factura repetida.
    base = { ...partes[0] };
  } else {
    base = { ...partes[0] };
    for (const campo of CAMPOS_VALOR) base[campo] = partes.reduce((s, p) => s + num(p[campo]), 0);
    base.items = partes.flatMap(itemsDe);
    base.desglose_categorias = partes.slice(1).reduce((acc, p) => sumarObjetos(acc, p.desglose_categorias), partes[0].desglose_categorias);
    // Lo que trajera impreso cada parte en Rete Fuente (ver normalizarPerfilFiscalDocumento).
    base.rete_fuente_documento = partes.reduce((s, p) => s + num(p.rete_fuente_documento), 0);
    // Confianza: la más baja de las partes, campo por campo.
    const conf = {};
    for (const p of partes) {
      for (const [k, v] of Object.entries(p.confianza_campos || {})) conf[k] = conf[k] === undefined ? v : Math.min(conf[k], v);
    }
    base.confianza_campos = conf;
  }
  base.factura_reunida = {
    partes: partes.length,
    totales: partes.map((p) => num(p.valor_con_iva)),
  };
  base.aviso_segmentacion = `La IA había separado esta factura en ${partes.length} partes (totales ${partes.map((p) => '$' + num(p.valor_con_iva).toLocaleString('es-CO')).join(' y ')}); se unieron en una sola porque tienen el mismo emisor y el mismo número. Revisa los valores contra el documento.`;
  return base;
}

// Recibe la lista de datos de los documentos leídos de UN archivo y
// devuelve la lista con las facturas partidas ya unidas, en el orden
// en que aparecía la primera parte de cada una.
function unirFacturasPartidas(datos) {
  const lista = Array.isArray(datos) ? datos : [];
  const grupos = new Map();
  const orden = [];
  lista.forEach((d, i) => {
    const clave = claveFactura(d);
    const k = clave || `__suelto_${i}`;
    if (!grupos.has(k)) { grupos.set(k, []); orden.push(k); }
    grupos.get(k).push(d);
  });
  return orden.map((k) => {
    const partes = grupos.get(k);
    return partes.length === 1 ? partes[0] : unirPartes(partes);
  });
}

module.exports = { claveFactura, unirFacturasPartidas, unirPartes };
