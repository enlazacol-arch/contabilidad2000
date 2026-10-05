// ---------------------------------------------------------------------
// Motor contable mínimo: plan de cuentas (PUC) y generación automática
// del asiento de partida doble a partir de una factura ya clasificada.
//
// Alcance de esta primera versión (lee esto antes de tocar el archivo):
//
// - Solo genera asiento para facturas de EGRESO (compra/gasto/honorario
//   que el contador le paga a un tercero). Las facturas de INGRESO
//   (ventas) todavía no tienen un asiento automático -- la app hoy no
//   tiene un catálogo de cuentas de ingreso ni de retenciones "sufridas"
//   (anticipos de impuestos) tan maduro como el de gastos/retenciones
//   practicadas, y prefiero no adivinar esa clasificación. Queda para
//   una siguiente iteración.
// - El asiento que se genera es SIEMPRE de causación (la factura se
//   causa, no se paga) -- no toca cuentas de bancos/caja. Vincular esto
//   con un pago real de public/lotes.js / movimientos_banco es trabajo
//   aparte (conciliación bancaria ya existe, pero conectarla con el
//   asiento contable es una tarea futura).
// - Nunca se genera un asiento si falta un dato necesario para hacerlo
//   bien (ej. el contador todavía no eligió la subcuenta del gasto) --
//   mismo principio que ya usa toda la app: el sistema no adivina algo
//   ambiguo, prefiere no proponer nada a proponer algo mal.
// - El asiento que se genera queda SIEMPRE en estado "propuesto" -- lo
//   crea el sistema pero el contador tiene que aprobarlo para que cuente
//   como confirmado (ver estado en asientos_contables, server.js).
//
// Igual que public/retenciones.js, este archivo es isomórfico: hoy solo
// lo usa server.js con require(), pero está escrito así por si en el
// futuro hace falta mostrar una vista previa del asiento en el navegador
// antes de guardar la factura.
// ---------------------------------------------------------------------

const {
  TARIFAS_RETENCION,
  CUENTAS_PUC_FIJAS,
  SUBCUENTAS_GASTO,
} = require('./public/retenciones');
const {
  nombreCuentaCliente,
  cuentaRetencionCliente,
  cuentaIvaGastoCliente,
  cuentaUsable,
} = require('./public/puc-cliente');

// ---------- Plan de cuentas semilla ----------
//
// Cada contador tiene su PROPIA copia de este catálogo (tabla
// plan_cuentas, con contador_id) -- se siembra la primera vez que hace
// falta (ver asegurarPlanCuentasContador en server.js) y de ahí en
// adelante es SUYA: si la edita o agrega cuentas, esos cambios no se
// pierden ni se sobreescriben. Esto es más simple que un catálogo
// global compartido y no depende de que exista la jerarquía de
// "empresas" (esa es la tarea de Multiempresa, más grande y aparte).
//
// Los códigos de gastos (clase 5) y de retención (grupo 2365/2367/2368)
// se derivan de public/retenciones.js -- MISMA fuente que ya usan
// Escanear/Carga masiva/Facturas para mostrarle esas cuentas al
// contador, para que el plan de cuentas nunca quede desincronizado de
// lo que el contador ya está viendo y eligiendo en esas pantallas.
//
// Las cuentas de activo/pasivo/IVA de abajo (Bancos, Clientes,
// Proveedores, Inventarios, IVA) son las mínimas indispensables para
// poder registrar la partida doble de una factura de compra -- se
// tomaron del Plan Único de Cuentas (Decreto 2650 de 1993), a nivel de
// cuenta (4 dígitos) donde no hace falta más detalle todavía. Si tu
// plan de cuentas real usa subcuentas más específicas (ej. IVA
// descontable y generado en cuentas separadas en vez de una sola 2408),
// edítalas después de que se siembren -- esto es un punto de partida
// razonable, no una migración legal obligatoria.
function construirPlanCuentasSemilla() {
  const cuentas = new Map(); // codigo -> {codigo, nombre, naturaleza, clase}

  const agregar = (codigo, nombre, naturaleza, clase) => {
    if (!codigo) return;
    if (!cuentas.has(codigo)) cuentas.set(codigo, { codigo, nombre, naturaleza, clase });
  };

  // Activo
  agregar('1110', 'Bancos', 'debito', 'activo');
  agregar('1305', 'Clientes', 'debito', 'activo');
  agregar('1435', 'Inventarios -- mercancías no fabricadas por la empresa', 'debito', 'activo');

  // Pasivo
  agregar('2205', 'Proveedores nacionales', 'credito', 'pasivo');
  agregar('2408', 'Impuesto sobre las ventas por pagar (IVA)', 'credito', 'pasivo');
  // Grupo genérico de retención en la fuente -- se usa solo cuando una
  // factura mezcla más de una categoría con subcuenta de retención
  // distinta y no se puede repartir el valor total entre ellas sin
  // adivinar (ver generarAsientoEgreso más abajo).
  agregar('2365', 'Retención en la fuente por pagar', 'credito', 'pasivo');
  agregar(CUENTAS_PUC_FIJAS.rete_iva.cuentaPUC, CUENTAS_PUC_FIJAS.rete_iva.nombrePUC, 'credito', 'pasivo');
  agregar(CUENTAS_PUC_FIJAS.rete_ica.cuentaPUC, CUENTAS_PUC_FIJAS.rete_ica.nombrePUC, 'credito', 'pasivo');
  // Subcuentas específicas de retención en la fuente -- una por cada
  // cuentaPUC distinta que aparezca en TARIFAS_RETENCION (varias
  // categorías comparten la misma cuenta, ej. todos los "servicios").
  Object.values(TARIFAS_RETENCION).forEach((config) => {
    agregar(config.cuentaPUC, `Retención en la fuente -- ${config.nombrePUC}`, 'credito', 'pasivo');
  });

  // Gasto (clase 5) -- una cuenta por cada subcuenta que el contador
  // puede elegir en el selector "Subcuenta (PUC)" de Escanear/Carga
  // masiva. El pseudo-código "inventario" no es una cuenta de gasto real
  // (es mercancía para reventa, un activo) -- se mapea aparte, a 1435.
  Object.values(SUBCUENTAS_GASTO).forEach((opciones) => {
    opciones.forEach(([codigo, nombre]) => {
      if (codigo === 'inventario') return; // ya se agregó como 1435 (activo) arriba
      agregar(codigo, nombre, 'debito', 'gasto');
    });
  });

  return [...cuentas.values()];
}

const PLAN_CUENTAS_SEMILLA = construirPlanCuentasSemilla();

// Traduce el pseudo-código "inventario" (usado en el selector de
// Escanear/Carga masiva) a la cuenta real que le corresponde.
function codigoCuentaGasto(subcuentaGasto) {
  if (subcuentaGasto === 'inventario') return '1435';
  return subcuentaGasto;
}

// ---------- Generación del asiento para una factura de EGRESO ----------
//
// `invoice`: la fila de la tabla invoices (o el objeto ya convertido por
// rowToInvoice en server.js -- funciona igual, se leen los mismos
// nombres de campo).
// `items`: las filas de factura_items de esa factura (arreglo, puede
// venir vacío si la factura no tiene desglose línea por línea).
// `opciones` (todo opcional):
//   pucCliente: el plan de cuentas propio del cliente (ver
//     public/puc-cliente.js). Con él, las cuentas llevan el NOMBRE del
//     plan del cliente, la retención va a su auxiliar de la tarifa
//     aplicada (ej. 23652502 "RETEFTE SERVICIOS 4%") y el IVA llevado al
//     gasto va a su cuenta "IVA ..." cuando la tiene.
//   ivaMayorValorGasto: el cliente NO es responsable de IVA -- todo el
//     IVA es mayor valor del gasto, nada va a la 2408.
//   ivaEnCuentaIva: el IVA llevado al gasto va a la cuenta "IVA ..." del
//     plan del cliente que acompaña ese gasto (ej. 513508 IVA VIGILANCIA).
//     Por defecto (false) se suma a la MISMA cuenta del gasto, que es como
//     lo registra la contadora de Bosques en su contabilidad real.
//   ivaCuentasOrden: además, el IVA llevado al gasto se controla en
//     cuentas de orden -- débito a la 8395 "IVA" y crédito a la 8695 del
//     plan del cliente (ej. 839519 / 869519), por el mismo valor.
//
// Devuelve { lineas, debe, haber } si se pudo generar, o
// { error: 'motivo' } si falta algo -- nunca lanza, y nunca devuelve un
// asiento que no cuadre (debe === haber siempre que no haya error).
// Cada línea trae `cuenta_cliente: true` si la cuenta es del plan propio
// del cliente.
function generarAsientoEgreso(invoice, items, opciones = {}) {
  if (String(invoice.tipo_movimiento || '').toLowerCase() !== 'egreso') {
    return { error: 'no_es_egreso' };
  }
  const puc = Array.isArray(opciones.pucCliente) ? opciones.pucCliente : [];
  const delCliente = (codigo) => puc.some((c) => String(c.codigo) === String(codigo));
  const nombreDe = (codigo, porDefecto) => {
    const propio = nombreCuentaCliente(puc, codigo);
    if (propio) return propio;
    const cuenta = PLAN_CUENTAS_SEMILLA.find((c) => c.codigo === codigo);
    return cuenta ? cuenta.nombre : (porDefecto || codigo);
  };

  const valorSinIva = Number(invoice.valor_sin_iva) || 0;
  const valorIva = Number(invoice.valor_iva) || 0;
  const valorConIva = Number(invoice.valor_con_iva) || 0;
  const reteFuente = Number(invoice.rete_fuente) || 0;
  const reteIva = Number(invoice.rete_iva) || 0;
  const reteIca = Number(invoice.rete_ica) || 0;

  if (valorConIva <= 0) return { error: 'sin_valor' };
  // Antes de proponer cualquier línea, se valida la misma regla de la
  // tarea "IA documental" del roadmap: subtotal + IVA debe cuadrar con
  // el total. Si no cuadra, la factura tiene un problema de datos que
  // hay que corregir ahí, no en el asiento.
  if (Math.abs(valorSinIva + valorIva - valorConIva) > 1) {
    return { error: 'valores_no_cuadran' };
  }

  const itemsConCategoria = Array.isArray(items) ? items.filter((it) => it.subcuenta_gasto) : [];

  // Débitos del gasto -- una línea por cada subcuenta distinta (agrupa
  // los ítems que la comparten). Cada cuenta lleva también el IVA que
  // es mayor valor de su gasto (`ivaGasto`), si aplica.
  const gastosPorCuenta = new Map(); // codigo -> {monto, ivaGasto}
  let ivaMayorValor = 0;
  if (itemsConCategoria.length > 0) {
    const ivaItems = itemsConCategoria.reduce((s, it) => s + (Number(it.valor_iva) || 0), 0);
    for (const item of itemsConCategoria) {
      const codigo = codigoCuentaGasto(item.subcuenta_gasto);
      const monto = Number(item.subtotal) || 0;
      if (monto <= 0) continue;
      const existente = gastosPorCuenta.get(codigo) || { monto: 0, ivaGasto: 0 };
      existente.monto += monto;
      // IVA de esta línea que va al gasto: todo, si el cliente no es
      // responsable de IVA; o el de las líneas marcadas "IVA mayor valor".
      if (opciones.ivaMayorValorGasto || item.iva_mayor_valor === true || item.iva_mayor_valor === 'true') {
        const ivaLinea = ivaItems > 0 ? (Number(item.valor_iva) || 0) : 0;
        existente.ivaGasto += ivaLinea;
        ivaMayorValor += ivaLinea;
      }
      gastosPorCuenta.set(codigo, existente);
    }
  } else if (invoice.subcuenta_gasto) {
    gastosPorCuenta.set(codigoCuentaGasto(invoice.subcuenta_gasto), { monto: valorSinIva, ivaGasto: 0 });
  }

  // Sin ninguna subcuenta de gasto elegida todavía, no hay de dónde
  // sacar el débito principal -- el contador tiene que elegirla primero.
  if (gastosPorCuenta.size === 0) return { error: 'sin_subcuenta_gasto' };

  // Redondeo de los ítems: cada línea se lee en pesos enteros, y su suma
  // puede quedar unos pesos arriba o abajo del subtotal de la factura (ej.
  // GAMOEZ 39710: 13 ítems suman $619.538 y el subtotal es $619.534). Antes
  // el asiento no cuadraba y no se proponía. Una diferencia pequeña (hasta
  // $1 por ítem, mínimo $10) se ajusta en la cuenta de gasto más grande; una
  // mayor es un error de lectura y el asiento sigue sin proponerse.
  if (itemsConCategoria.length > 0) {
    const sumaGastos = [...gastosPorCuenta.values()].reduce((s, g) => s + g.monto, 0);
    const diferencia = round2(valorSinIva - sumaGastos);
    if (diferencia !== 0 && Math.abs(diferencia) <= Math.max(10, itemsConCategoria.length)) {
      const mayor = [...gastosPorCuenta.values()].sort((a, b) => b.monto - a.monto)[0];
      mayor.monto += diferencia;
    }
  }

  // Cliente no responsable de IVA sin IVA por ítem (factura sin desglose,
  // o ítems sin IVA prorrateado): todo el IVA se reparte entre las
  // cuentas de gasto en proporción a su valor.
  if (opciones.ivaMayorValorGasto && valorIva > 0 && Math.abs(ivaMayorValor - valorIva) > 1) {
    const totalGasto = [...gastosPorCuenta.values()].reduce((s, g) => s + g.monto, 0);
    let repartido = 0;
    const cuentas = [...gastosPorCuenta.values()];
    cuentas.forEach((g, i) => {
      g.ivaGasto = i === cuentas.length - 1 ? round2(valorIva - repartido) : round2(totalGasto > 0 ? valorIva * g.monto / totalGasto : 0);
      repartido += g.ivaGasto;
    });
    ivaMayorValor = valorIva;
  }

  const lineas = [];
  let orden = 0;
  const debitos = new Map(); // codigo -> monto, para juntar gasto + IVA si van a la misma cuenta
  const sumarDebito = (codigo, monto) => debitos.set(codigo, (debitos.get(codigo) || 0) + monto);
  for (const [codigo, { monto, ivaGasto }] of gastosPorCuenta) {
    sumarDebito(codigo, monto);
    if (ivaGasto > 0) {
      // A la misma cuenta del gasto; o, si el cliente así lo lleva, a su
      // cuenta "IVA ..." que acompaña este gasto (ej. 513508 IVA
      // VIGILANCIA) cuando la tiene.
      const cuentaIva = opciones.ivaEnCuentaIva ? cuentaIvaGastoCliente(puc, codigo) : null;
      sumarDebito(cuentaIva ? String(cuentaIva.codigo) : codigo, ivaGasto);
    }
  }
  for (const [codigo, monto] of debitos) {
    lineas.push({ orden: orden++, cuenta_codigo: codigo, cuenta_nombre: nombreDe(codigo), debito: round2(monto), credito: 0, cuenta_cliente: delCliente(codigo) });
  }

  // Control del IVA llevado al gasto en cuentas de orden (8395 deudora /
  // 8695 por contra, las del plan del cliente cuyo nombre dice IVA).
  if (opciones.ivaCuentasOrden && ivaMayorValor > 0) {
    const deOrden = (grupo) => puc.filter((c) => cuentaUsable(c) && String(c.codigo).startsWith(grupo) && /\bIVA\b/i.test(String(c.concepto || '')))[0];
    const deudora = deOrden('8395');
    const porContra = deOrden('8695');
    if (deudora && porContra) {
      lineas.push({ orden: orden++, cuenta_codigo: String(deudora.codigo), cuenta_nombre: String(deudora.concepto).trim(), debito: round2(ivaMayorValor), credito: 0, cuenta_cliente: true });
      lineas.push({ orden: orden++, cuenta_codigo: String(porContra.codigo), cuenta_nombre: String(porContra.concepto).trim(), debito: 0, credito: round2(ivaMayorValor), cuenta_cliente: true });
    }
  }

  const ivaDescontable = round2(valorIva - ivaMayorValor);
  if (ivaDescontable > 0) {
    // El auxiliar de IVA descontable del cliente si lo tiene (ej.
    // 24081001 IVA DESCONTADOS); si no, la 2408.
    const propia = puc.filter((c) => cuentaUsable(c) && String(c.codigo).startsWith('2408') && /DESCONT/i.test(String(c.concepto || '')))[0];
    const codigo = propia ? String(propia.codigo) : '2408';
    lineas.push({ orden: orden++, cuenta_codigo: codigo, cuenta_nombre: nombreDe(codigo, 'Impuesto sobre las ventas por pagar (IVA)'), debito: ivaDescontable, credito: 0, cuenta_cliente: !!propia });
  }

  // Retención en la fuente -- si TODAS las categorías involucradas
  // comparten la misma subcuenta de retención (el caso normal), se usa
  // esa subcuenta, o el auxiliar del cliente de la tarifa aplicada. Si
  // hay más de una distinta, la factura solo guarda el TOTAL de
  // rete_fuente, así que no se puede repartir sin adivinar -- se usa la
  // cuenta genérica 2365 y se deja una nota para que el contador la
  // reclasifique a mano si hace falta.
  if (reteFuente > 0) {
    const categorias = itemsConCategoria.length > 0
      ? [...new Set(itemsConCategoria.map((it) => String(it.categoria_concepto || '').toLowerCase()))]
      : [String(invoice.categoria_concepto || '').toLowerCase()];
    const cuentasRetencion = new Set(categorias.map((cat) => (TARIFAS_RETENCION[cat] || {}).cuentaPUC).filter(Boolean));
    if (cuentasRetencion.size === 1) {
      const [codigo] = cuentasRetencion;
      const config = Object.values(TARIFAS_RETENCION).find((c) => c.cuentaPUC === codigo);
      const tarifa = tarifaAplicada(reteFuente, categorias, invoice, itemsConCategoria, valorSinIva);
      const propia = tarifa ? cuentaRetencionCliente(puc, codigo, tarifa) : null;
      if (propia) {
        lineas.push({ orden: orden++, cuenta_codigo: String(propia.codigo), cuenta_nombre: String(propia.concepto).trim(), debito: 0, credito: round2(reteFuente), cuenta_cliente: true });
      } else {
        lineas.push({ orden: orden++, cuenta_codigo: codigo, cuenta_nombre: nombreCuentaCliente(puc, codigo) || `Retención en la fuente -- ${config.nombrePUC}`, debito: 0, credito: round2(reteFuente), cuenta_cliente: delCliente(codigo) });
      }
    } else {
      lineas.push({
        orden: orden++,
        cuenta_codigo: '2365',
        cuenta_nombre: 'Retención en la fuente por pagar (revisar reparto entre categorías -- esta factura mezcla más de una)',
        debito: 0,
        credito: round2(reteFuente),
        cuenta_cliente: false,
      });
    }
  }

  // ReteIVA (15% del IVA) y ReteICA: el auxiliar del cliente bajo la
  // cuenta estándar si lo tiene (por tarifa, o el único que haya).
  const lineaRetencionFija = (fija, valor, tarifa) => {
    const propia = cuentaRetencionCliente(puc, fija.cuentaPUC, tarifa);
    if (propia) return { cuenta_codigo: String(propia.codigo), cuenta_nombre: String(propia.concepto).trim(), cuenta_cliente: true };
    return { cuenta_codigo: fija.cuentaPUC, cuenta_nombre: nombreCuentaCliente(puc, fija.cuentaPUC) || fija.nombrePUC, cuenta_cliente: delCliente(fija.cuentaPUC) };
  };
  if (reteIva > 0) {
    lineas.push({ orden: orden++, ...lineaRetencionFija(CUENTAS_PUC_FIJAS.rete_iva, reteIva, 0.15), debito: 0, credito: round2(reteIva) });
  }
  if (reteIca > 0) {
    const tarifaIca = valorSinIva > 0 ? Math.round((reteIca / valorSinIva) * 100000) / 100000 : 0;
    lineas.push({ orden: orden++, ...lineaRetencionFija(CUENTAS_PUC_FIJAS.rete_ica, reteIca, tarifaIca), debito: 0, credito: round2(reteIca) });
  }

  // Lo que de verdad se le debe al proveedor: el total de la factura
  // menos todas las retenciones que se le practicaron.
  const saldoProveedor = valorConIva - reteFuente - reteIva - reteIca;
  if (saldoProveedor > 0) {
    lineas.push({ orden: orden++, cuenta_codigo: '2205', cuenta_nombre: nombreDe('2205', 'Proveedores nacionales'), debito: 0, credito: round2(saldoProveedor), cuenta_cliente: delCliente('2205') });
  } else if (saldoProveedor < 0) {
    // No debería pasar con datos válidos -- mejor no proponer nada.
    return { error: 'retenciones_mayores_al_total' };
  }

  const debe = round2(lineas.reduce((s, l) => s + l.debito, 0));
  const haber = round2(lineas.reduce((s, l) => s + l.credito, 0));
  if (Math.abs(debe - haber) > 1) {
    // Red de seguridad -- un asiento que no cuadra jamás debería guardarse.
    return { error: 'asiento_no_cuadra' };
  }

  return { lineas, debe, haber };
}

// Tarifa de retención que se aplicó en la factura, deducida del valor
// retenido: entre las tarifas legales de sus categorías, la que sobre
// alguna base posible (subtotal, ítems de la categoría o AIU) da el
// valor retenido; si ninguna calza, el cociente retención / subtotal.
// Sirve para escoger el auxiliar del cliente (ej. servicios 4% vs 6%).
function tarifaAplicada(reteFuente, categorias, invoice, items, valorSinIva) {
  const tarifas = new Set();
  categorias.forEach((cat) => {
    const config = TARIFAS_RETENCION[cat];
    if (config) { tarifas.add(config.tarifaBaja); tarifas.add(config.tarifaAlta); }
  });
  const bases = new Set([valorSinIva]);
  const subtotalItems = (items || []).reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
  if (subtotalItems > 0) bases.add(subtotalItems);
  let aiu = invoice.desglose_aiu;
  if (typeof aiu === 'string') { try { aiu = JSON.parse(aiu); } catch (e) { aiu = null; } }
  if (aiu && typeof aiu === 'object') {
    const totalAiu = Object.values(aiu).reduce((s, v) => s + (Number(v) || 0), 0);
    if (totalAiu > 0) bases.add(totalAiu);
  }
  for (const tarifa of tarifas) {
    for (const base of bases) {
      if (base > 0 && Math.abs(base * tarifa - reteFuente) <= Math.max(2, reteFuente * 0.01)) return tarifa;
    }
  }
  return valorSinIva > 0 ? Math.round((reteFuente / valorSinIva) * 1000) / 1000 : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = {
  PLAN_CUENTAS_SEMILLA,
  generarAsientoEgreso,
  codigoCuentaGasto,
};
