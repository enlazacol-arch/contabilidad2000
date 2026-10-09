// ---------- ¿Ingreso o egreso? -- una sola regla para toda la app ----------
//
// Antes esta decisión estaba copiada en 5 lugares (Escanear x3, Carga
// masiva y el procesamiento en segundo plano del servidor), y todas
// comparaban el NIT como texto exacto: un cliente guardado como
// "900.123.456-7" nunca coincidía con el "900123456" que lee la IA, y la
// factura quedaba como egreso sin cliente, sin avisar.
//
// La regla de fondo NO cambia:
//   - si tu cliente es el ADQUIRIENTE (quien compra) -> egreso de ese cliente
//   - si tu cliente es el EMISOR (quien vende)       -> ingreso de ese cliente
//   - si ninguno coincide                            -> egreso, pero
//     confiado = false, para que la pantalla le pida al contador que confirme
//
// Lo que sí cambia: los NIT se comparan normalizados (sin puntos, guiones
// ni espacios) y un NIT que trae el dígito de verificación pegado
// ("9001234567") coincide con "900123456" solo si ese último dígito ES el
// DV correcto según la fórmula de la DIAN -- así no se confunden dos NIT
// distintos que solo difieren en el último número.
//
// Isomórfico, igual que retenciones.js: en el navegador sus funciones
// quedan globales (<script src="/movimiento.js">), y en el servidor se
// usan con require('./public/movimiento').

// Quita todo lo que no sea dígito. Si viene con el DV separado por guion
// al final ("900.123.456-7"), lo quita primero -- mismo criterio que
// normalizarNit() de server.js y soloDigitos() de Escanear/Carga masiva.
function normalizarNitComparable(nit) {
  let s = String(nit == null ? '' : nit).trim();
  s = s.replace(/-\s*\d$/, '');
  return s.replace(/[^0-9]/g, '');
}

// Dígito de verificación del NIT según la DIAN (módulo 11, con los pesos
// oficiales aplicados de derecha a izquierda). Devuelve '' si el NIT no
// tiene dígitos.
const PESOS_DV_DIAN = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
function calcularDvNit(nit) {
  const digitos = normalizarNitComparable(nit);
  if (!digitos || digitos.length > PESOS_DV_DIAN.length) return '';
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    suma += Number(digitos[digitos.length - 1 - i]) * PESOS_DV_DIAN[i];
  }
  const residuo = suma % 11;
  return String(residuo >= 2 ? 11 - residuo : residuo);
}

// ¿El NIT leído en la factura corresponde al NIT del cliente?
// - iguales tras normalizar -> sí
// - el leído trae un dígito de más al final y ese dígito es el DV válido
//   del NIT del cliente -> sí ("9001234567" vs cliente "900123456")
// - cualquier otro caso -> no (nunca por parecido, nunca por prefijo)
function nitsCoinciden(nitLeido, nitCliente) {
  const leido = normalizarNitComparable(nitLeido);
  const cliente = normalizarNitComparable(nitCliente);
  if (!leido || !cliente) return false;
  if (leido === cliente) return true;
  if (leido.length === cliente.length + 1 && leido.startsWith(cliente)) {
    return leido.slice(-1) === calcularDvNit(cliente);
  }
  if (cliente.length === leido.length + 1 && cliente.startsWith(leido)) {
    return cliente.slice(-1) === calcularDvNit(leido);
  }
  return false;
}

// Limpia un NIT tal como lo leyó la IA o lo escribió el contador.
// - "900.123.456-7" -> "900123456"
// - un texto que no es un NIT ("bosques de la macarena", "Propiedad
//   Horizontal") -> "" (antes se guardaba tal cual en el campo NIT y
//   después no había cómo corregirlo)
// Un NIT/cédula colombiano tiene entre 5 y 15 dígitos.
function limpiarNitLeido(nit) {
  const texto = String(nit == null ? '' : nit).trim();
  if (!texto) return '';
  const digitos = normalizarNitComparable(texto);
  const letras = (texto.match(/[a-záéíóúñ]/gi) || []).length;
  if (letras > 3 && letras >= digitos.length) return '';
  if (digitos.length < 5 || digitos.length > 15) return '';
  return digitos;
}

// ¿El texto escrito en un campo de NIT es claramente otra cosa (un
// nombre)? Lo usa el servidor para no aceptar ese dato al guardar.
function nitTieneTexto(nit) {
  return /[a-záéíóúñ]{2,}/i.test(String(nit == null ? '' : nit));
}

// ¿El nombre leído en la factura puede ser el de ese cliente?
// Se usa para no confiar a ciegas en un NIT: si la IA anotó el NIT del
// comprador como si fuera el del emisor (pasó con una cuenta de cobro de
// IMB / Andrés Felipe Osorio: quedó el NIT del Conjunto Bosques de la
// Macarena como emisor y la factura salió como INGRESO), el nombre del
// emisor ("IMB INGENIERIA...") no tiene nada que ver con el del cliente.
// Compara palabras significativas, sin tildes ni palabras genéricas.
// Si alguno de los dos nombres está vacío, no hay con qué comparar: true.
const PALABRAS_GENERICAS_NOMBRE = new Set(('DE LA EL LOS LAS DEL Y E EN A AL S SA SAS LTDA LIMITADA CIA COMPANIA SOCIEDAD ' +
  'EU BIC PH P H CONJUNTO RESIDENCIAL URBANIZACION EDIFICIO UNIDAD COPROPIEDAD PROPIEDAD HORIZONTAL ' +
  'COLOMBIA GRUPO SERVICIOS COMERCIALIZADORA DISTRIBUIDORA INVERSIONES SOLUCIONES EMPRESA EMPRESAS ' +
  'NACIONAL INTERNACIONAL ASOCIADOS CORPORACION FUNDACION ASOCIACION SAS.').split(/\s+/));
function palabrasNombre(nombre) {
  return String(nombre == null ? '' : nombre)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/).filter((p) => p.length >= 3 && !PALABRAS_GENERICAS_NOMBRE.has(p));
}
function nombresCompatibles(nombreLeido, nombreCliente) {
  const leido = palabrasNombre(nombreLeido);
  const cliente = palabrasNombre(nombreCliente);
  if (leido.length === 0 || cliente.length === 0) return true;
  return leido.some((p) => cliente.some((q) => palabrasParecidas(p, q)));
}

// Distancia de edición (Levenshtein) -- cuántas letras hay que cambiar,
// quitar o poner para pasar de una palabra a la otra.
function distanciaEdicion(a, b) {
  const x = String(a), y = String(b);
  let previa = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const fila = [i];
    for (let j = 1; j <= y.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previa = fila;
  }
  return previa[y.length];
}

// Misma palabra con un error de digitación de la factura o de la IA
// ("EDIFISIO" / "EDIFICIO", "ALEJANDRA" / "ALEJANDRIA"): 1 letra de
// diferencia en palabras cortas, 2 en las de 8 letras o más. Palabras de
// menos de 4 letras tienen que ser idénticas.
function palabrasParecidas(a, b) {
  if (a === b) return true;
  const menor = Math.min(a.length, b.length);
  if (menor < 4) return false;
  return distanciaEdicion(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
}

// ¿El nombre leído ES el del cliente, aunque venga mal escrito? Más
// estricto que nombresCompatibles(): casi todas las palabras de UNO
// tienen que estar en el OTRO, en los dos sentidos -- "EDIFICIO FARO
// ALEJANDRIA TORRE 2" no es "EDIFICIO FARO DE ALEJANDRIA" (puede ser
// otro edificio). Se usa para reconocer al cliente cuando el NIT no
// ayuda (vacío o mal leído).
// Una palabra genérica mal escrita ("EDIFISIO", "CONJUTO") sigue siendo
// genérica: no cuenta como parte distintiva del nombre.
const GENERICAS_LARGAS = [...PALABRAS_GENERICAS_NOMBRE].filter((g) => g.length >= 5);
function sinGenericasMalEscritas(palabras) {
  return palabras.filter((p) => !GENERICAS_LARGAS.some((g) => palabrasParecidas(p, g)));
}
function mismoNombre(nombreLeido, nombreCliente) {
  const leido = sinGenericasMalEscritas(palabrasNombre(nombreLeido));
  const cliente = sinGenericasMalEscritas(palabrasNombre(nombreCliente));
  if (leido.length === 0 || cliente.length === 0) return false;
  const cubiertas = (de, en) => de.filter((p) => en.some((q) => palabrasParecidas(p, q))).length / de.length;
  return cubiertas(cliente, leido) >= 0.75 && cubiertas(leido, cliente) >= 0.75;
}

// Cómo se parece el NIT leído al del cliente: 'igual', 'vacio',
// 'parecido' (un dígito cambiado, dos dígitos vecinos invertidos, o un
// dígito de más/de menos -- errores típicos de lectura o digitación) o
// 'distinto' (otro NIT: puede ser otra empresa con nombre parecido).
function comparacionNit(nitLeido, nitCliente) {
  const leido = normalizarNitComparable(nitLeido);
  const cliente = normalizarNitComparable(nitCliente);
  if (!leido) return 'vacio';
  if (!cliente) return 'distinto';
  if (nitsCoinciden(leido, cliente)) return 'igual';
  if (leido.length === cliente.length) {
    const difs = [...leido].map((d, i) => (d !== cliente[i] ? i : -1)).filter((i) => i >= 0);
    if (difs.length === 1) return 'parecido';
    if (difs.length === 2 && difs[1] === difs[0] + 1 && leido[difs[0]] === cliente[difs[1]] && leido[difs[1]] === cliente[difs[0]]) return 'parecido';
    return 'distinto';
  }
  return Math.abs(leido.length - cliente.length) === 1 && distanciaEdicion(leido, cliente) === 1 ? 'parecido' : 'distinto';
}

function nombreNormalizado(nombre) {
  return palabrasNombre(nombre).join(' ');
}

// Decide ingreso/egreso y a qué cliente pertenece una factura leída.
//
// `factura`: objeto con nit_cc (emisor/vendedor) y adquiriente_nit (comprador).
// `clientes`: lista de clientes de la firma ({ id, nit, nombre, ... }).
// `opciones.clienteFijo`: si la factura se escaneó desde la ficha de un
//   cliente, ESE cliente -- entonces no se busca entre todos, solo se
//   decide si para él es ingreso o egreso.
//
// Devuelve siempre el mismo objeto:
//   { tipoMovimiento: 'egreso'|'ingreso', clienteId, cliente, confiado, motivo, otroClienteId }
// motivo:
//   'adquiriente'                    el cliente es quien compra   -> egreso
//   'emisor'                         el cliente es quien vende    -> ingreso
//   'cliente_fijo_sin_coincidencia'  cliente fijo, pero ningún NIT le coincide
//   'sin_coincidencia'               ningún cliente coincide con ningún NIT
//   'sin_clientes'                   la firma todavía no tiene clientes
// otroClienteId: si emisor y adquiriente son AMBOS clientes distintos de
//   la firma, el id del cliente que vendió (para esa factura también es
//   un ingreso suyo). Hoy solo se informa; registrar las dos caras es
//   una mejora aparte.
function clasificarMovimiento(factura, clientes, opciones) {
  const datos = factura || {};
  const lista = Array.isArray(clientes) ? clientes : [];
  const clienteFijo = opciones && opciones.clienteFijo ? opciones.clienteFijo : null;
  const avisos = [];

  // Datos del lado del cliente que quedaron vacíos o mal leídos, para
  // completarlos con los registrados (ver aplicarCorreccionesCliente).
  const correccionesPara = (cliente, motivo) => {
    if (!cliente || (motivo !== 'adquiriente' && motivo !== 'emisor')) return [];
    const [campoNit, campoNombre] = motivo === 'adquiriente' ? ['adquiriente_nit', 'adquiriente_nombre'] : ['nit_cc', 'nombre_razon_social'];
    const nitCliente = normalizarNitComparable(cliente.nit);
    const lista = [];
    if (nitCliente && !nitsCoinciden(datos[campoNit], cliente.nit)) {
      lista.push({ campo: campoNit, leido: String(datos[campoNit] || ''), valor: nitCliente });
    }
    if (motivo === 'emisor' && nitCliente) {
      const dv = String(cliente.dv || '').trim() || calcularDvNit(nitCliente);
      if (dv && String(datos.dv || '').trim() !== dv) lista.push({ campo: 'dv', leido: String(datos.dv || ''), valor: dv });
    }
    if (cliente.nombre && nombreNormalizado(datos[campoNombre]) !== nombreNormalizado(cliente.nombre)) {
      lista.push({ campo: campoNombre, leido: String(datos[campoNombre] || ''), valor: String(cliente.nombre) });
    }
    return lista;
  };

  const resultado = (tipoMovimiento, cliente, confiado, motivo, otroClienteId, porNombre) => ({
    tipoMovimiento,
    clienteId: cliente ? cliente.id : '',
    cliente: cliente || null,
    confiado,
    motivo,
    otroClienteId: otroClienteId || '',
    aviso: avisos.join(' '),
    porNombre: !!porNombre,
    correcciones: correccionesPara(cliente, motivo),
  });

  // Sin NIT que ayude (vacío o con un error de lectura), pero con el
  // nombre del cliente de ese lado: es el cliente. Si el NIT leído es
  // claramente OTRO, no -- puede ser otra empresa con nombre parecido.
  const porNombreComprador = (c) => mismoNombre(datos.adquiriente_nombre, c.nombre) && ['vacio', 'parecido'].includes(comparacionNit(datos.adquiriente_nit, c.nit));
  const porNombreVendedor = (c) => mismoNombre(datos.nombre_razon_social, c.nombre) && ['vacio', 'parecido'].includes(comparacionNit(datos.nit_cc, c.nit));
  // Reconocido por nombre de un lado, pero el NIT del cliente aparece en
  // el OTRO lado (caso IMB: la IA puso el NIT del conjunto como el del
  // emisor). El movimiento es claro, pero ese NIT del otro lado está mal:
  // se avisa y la factura queda para revisar.
  const nitDelClienteEnOtroLado = (c, ladoCliente) => {
    const [nitOtro, etiqueta] = ladoCliente === 'adquiriente' ? [datos.nit_cc, 'emisor'] : [datos.adquiriente_nit, 'comprador'];
    if (!nitsCoinciden(nitOtro, c.nit)) return false;
    avisos.push(`El NIT del ${etiqueta} (${normalizarNitComparable(nitOtro)}) es el de tu cliente ${c.nombre}, pero el nombre de ese lado es otro: revisa ese NIT con el documento.`);
    return true;
  };

  // Emisor y comprador con el mismo NIT: uno de los dos quedó mal leído.
  const mismoNit = nitsCoinciden(datos.nit_cc, datos.adquiriente_nit);
  if (mismoNit) {
    avisos.push(`El NIT del emisor y el del comprador quedaron iguales (${normalizarNitComparable(datos.nit_cc)}): uno de los dos está mal leído.`);
  }

  // Un NIT que coincide con el cliente solo cuenta si el nombre leído de
  // ese mismo lado también puede ser el del cliente.
  const coincideComprador = (c) => nitsCoinciden(datos.adquiriente_nit, c.nit) && nombresCompatibles(datos.adquiriente_nombre, c.nombre);
  const coincideVendedor = (c) => !mismoNit && nitsCoinciden(datos.nit_cc, c.nit) && nombresCompatibles(datos.nombre_razon_social, c.nombre);
  const avisarNombre = (c, lado, nombreLeido) => {
    avisos.push(`El NIT del ${lado} coincide con tu cliente ${c.nombre}, pero el nombre leído es "${nombreLeido}". Confirma a qué cliente pertenece la factura.`);
  };

  if (clienteFijo) {
    if (coincideComprador(clienteFijo)) return resultado('egreso', clienteFijo, avisos.length === 0, 'adquiriente');
    if (coincideVendedor(clienteFijo)) return resultado('ingreso', clienteFijo, true, 'emisor');
    if (porNombreComprador(clienteFijo)) {
      const contradice = nitDelClienteEnOtroLado(clienteFijo, 'adquiriente');
      return resultado('egreso', clienteFijo, !contradice && avisos.length === 0, 'adquiriente', '', true);
    }
    if (porNombreVendedor(clienteFijo)) {
      const contradice = nitDelClienteEnOtroLado(clienteFijo, 'emisor');
      return resultado('ingreso', clienteFijo, !contradice, 'emisor', '', true);
    }
    // Cliente fijo (la factura se subió desde SU ficha) y el comprador no
    // trae NIT (o trae uno con un error de lectura), con un nombre que
    // puede ser el suyo aunque venga recortado ("CONJUNTO RESIDENCIAL
    // URBANIZACION BOSQUE" por "...BOSQUES DE LA MACARENA P.H", caso
    // Comcel oct. 2026): como ya se sabe de quién es, basta con que el
    // nombre sea compatible -- siempre que el emisor no sea el mismo cliente.
    if (String(datos.adquiriente_nombre || '').trim() && nombresCompatibles(datos.adquiriente_nombre, clienteFijo.nombre) &&
        ['vacio', 'parecido'].includes(comparacionNit(datos.adquiriente_nit, clienteFijo.nit)) &&
        !(String(datos.nombre_razon_social || '').trim() && nombresCompatibles(datos.nombre_razon_social, clienteFijo.nombre))) {
      const contradice = nitDelClienteEnOtroLado(clienteFijo, 'adquiriente');
      return resultado('egreso', clienteFijo, !contradice && avisos.length === 0, 'adquiriente', '', true);
    }
    if (nitsCoinciden(datos.nit_cc, clienteFijo.nit) && !mismoNit) avisarNombre(clienteFijo, 'emisor', datos.nombre_razon_social);
    if (nitsCoinciden(datos.adquiriente_nit, clienteFijo.nit)) avisarNombre(clienteFijo, 'comprador', datos.adquiriente_nombre);
    return resultado('egreso', clienteFijo, false, avisos.length ? 'nombre_no_coincide' : 'cliente_fijo_sin_coincidencia');
  }

  if (lista.length === 0) return resultado('egreso', null, false, 'sin_clientes');

  const comprador = lista.find(coincideComprador);
  const vendedor = lista.find(coincideVendedor);

  if (comprador) {
    const otro = vendedor && vendedor.id !== comprador.id ? vendedor.id : '';
    return resultado('egreso', comprador, avisos.length === 0, 'adquiriente', otro);
  }
  if (vendedor) return resultado('ingreso', vendedor, true, 'emisor');

  // Ningún NIT coincide: ¿el nombre de algún lado es el de un cliente?
  // Solo si hay UN único cliente con ese nombre -- con dos, no se adivina.
  const compradoresPorNombre = lista.filter(porNombreComprador);
  if (compradoresPorNombre.length === 1) {
    const contradice = nitDelClienteEnOtroLado(compradoresPorNombre[0], 'adquiriente');
    return resultado('egreso', compradoresPorNombre[0], !contradice && avisos.length === 0, 'adquiriente', '', true);
  }
  const vendedoresPorNombre = lista.filter(porNombreVendedor);
  if (vendedoresPorNombre.length === 1) {
    const contradice = nitDelClienteEnOtroLado(vendedoresPorNombre[0], 'emisor');
    return resultado('ingreso', vendedoresPorNombre[0], !contradice, 'emisor', '', true);
  }

  // El NIT coincidía con un cliente, pero el nombre no: no se adivina.
  const porNitVendedor = !mismoNit && lista.find((c) => nitsCoinciden(datos.nit_cc, c.nit));
  const porNitComprador = lista.find((c) => nitsCoinciden(datos.adquiriente_nit, c.nit));
  if (porNitVendedor) avisarNombre(porNitVendedor, 'emisor', datos.nombre_razon_social);
  if (porNitComprador) avisarNombre(porNitComprador, 'comprador', datos.adquiriente_nombre);
  return resultado('egreso', null, false, avisos.length ? 'nombre_no_coincide' : 'sin_coincidencia');
}

// Completa/corrige en la factura los datos del lado del cliente (NIT,
// DV, nombre) con los que tiene registrados, según lo que propuso
// clasificarMovimiento(). Lo leído queda en `correcciones_cliente` y en
// el aviso "NIT por verificar" (aviso_nit), para que el contador lo
// compare con el documento. Devuelve el texto del aviso ('' si no cambió nada).
const ETIQUETAS_CAMPO_CLIENTE = {
  adquiriente_nit: 'el NIT del comprador', adquiriente_nombre: 'el nombre del comprador',
  nit_cc: 'el NIT del emisor', dv: 'el dígito de verificación', nombre_razon_social: 'el nombre del emisor',
};
function aplicarCorreccionesCliente(factura, clasif) {
  if (!factura || !clasif || !clasif.cliente || !Array.isArray(clasif.correcciones) || clasif.correcciones.length === 0) return '';
  const partes = clasif.correcciones.map((c) => {
    factura[c.campo] = c.valor;
    const etiqueta = ETIQUETAS_CAMPO_CLIENTE[c.campo] || c.campo;
    return c.leido ? `${etiqueta} (se leyó "${c.leido}")` : `${etiqueta} (no se leyó)`;
  });
  factura.correcciones_cliente = clasif.correcciones;
  const como = clasif.porNombre ? 'Se reconoció por el nombre a tu cliente' : 'La factura es de tu cliente';
  const aviso = `${como} ${clasif.cliente.nombre}: se tomó de su ficha ${partes.join(', ')}.`;
  // Solo un nombre mal escrito, con el NIT bien: se corrige sin alarma.
  const tocaNit = clasif.correcciones.some((c) => ['adquiriente_nit', 'nit_cc', 'dv'].includes(c.campo));
  if (tocaNit) factura.aviso_nit = factura.aviso_nit ? `${factura.aviso_nit} ${aviso}` : aviso;
  return aviso;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizarNitComparable,
    calcularDvNit,
    nitsCoinciden,
    limpiarNitLeido,
    nitTieneTexto,
    nombresCompatibles,
    palabrasParecidas,
    mismoNombre,
    comparacionNit,
    clasificarMovimiento,
    aplicarCorreccionesCliente,
  };
}
