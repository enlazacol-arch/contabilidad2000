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
  return leido.some((p) => cliente.includes(p));
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

  const resultado = (tipoMovimiento, cliente, confiado, motivo, otroClienteId) => ({
    tipoMovimiento,
    clienteId: cliente ? cliente.id : '',
    cliente: cliente || null,
    confiado,
    motivo,
    otroClienteId: otroClienteId || '',
    aviso: avisos.join(' '),
  });

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

  // El NIT coincidía con un cliente, pero el nombre no: no se adivina.
  const porNitVendedor = !mismoNit && lista.find((c) => nitsCoinciden(datos.nit_cc, c.nit));
  const porNitComprador = lista.find((c) => nitsCoinciden(datos.adquiriente_nit, c.nit));
  if (porNitVendedor) avisarNombre(porNitVendedor, 'emisor', datos.nombre_razon_social);
  if (porNitComprador) avisarNombre(porNitComprador, 'comprador', datos.adquiriente_nombre);
  return resultado('egreso', null, false, avisos.length ? 'nombre_no_coincide' : 'sin_coincidencia');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizarNitComparable,
    calcularDvNit,
    nitsCoinciden,
    limpiarNitLeido,
    nitTieneTexto,
    nombresCompatibles,
    clasificarMovimiento,
  };
}
