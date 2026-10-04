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

  const resultado = (tipoMovimiento, cliente, confiado, motivo, otroClienteId) => ({
    tipoMovimiento,
    clienteId: cliente ? cliente.id : '',
    cliente: cliente || null,
    confiado,
    motivo,
    otroClienteId: otroClienteId || '',
  });

  if (clienteFijo) {
    if (nitsCoinciden(datos.adquiriente_nit, clienteFijo.nit)) return resultado('egreso', clienteFijo, true, 'adquiriente');
    if (nitsCoinciden(datos.nit_cc, clienteFijo.nit)) return resultado('ingreso', clienteFijo, true, 'emisor');
    return resultado('egreso', clienteFijo, false, 'cliente_fijo_sin_coincidencia');
  }

  if (lista.length === 0) return resultado('egreso', null, false, 'sin_clientes');

  const comprador = lista.find((c) => nitsCoinciden(datos.adquiriente_nit, c.nit));
  const vendedor = lista.find((c) => nitsCoinciden(datos.nit_cc, c.nit));

  if (comprador) {
    const otro = vendedor && vendedor.id !== comprador.id ? vendedor.id : '';
    return resultado('egreso', comprador, true, 'adquiriente', otro);
  }
  if (vendedor) return resultado('ingreso', vendedor, true, 'emisor');
  return resultado('egreso', null, false, 'sin_coincidencia');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizarNitComparable,
    calcularDvNit,
    nitsCoinciden,
    clasificarMovimiento,
  };
}
