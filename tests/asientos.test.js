// Suite mínima de tests para asientos.js -- el motor que genera el
// asiento contable de partida doble (causación) para una factura de
// EGRESO ya clasificada.
//
// Objetivo de esta suite: NO es recertificar la norma tributaria (eso ya
// lo cubre tests/retenciones.test.js, de donde este módulo importa las
// tarifas/cuentas), es evitar que un cambio futuro rompa en silencio:
// (a) alguno de los códigos de error documentados en el comentario de
// generarAsientoEgreso, (b) el agrupamiento de ítems por subcuenta de
// gasto, (c) la regla de "una sola cuenta de retención vs. genérica
// 2365" cuando una factura mezcla categorías, o (d) que el asiento
// generado deje de cuadrar (debe === haber) en algún caso real.
//
// Se corre con el test runner de Node (>=18, sin dependencias nuevas):
//   node --test tests/
// o, con el script agregado a package.json:
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  PLAN_CUENTAS_SEMILLA,
  generarAsientoEgreso,
  codigoCuentaGasto,
} = require(path.join(__dirname, '..', 'asientos.js'));

function buscarLinea(lineas, codigo) {
  return lineas.filter((l) => l.cuenta_codigo === codigo);
}

// ---------- Códigos de error documentados ----------

test('generarAsientoEgreso: no_es_egreso si la factura no es de egreso (o no trae tipo_movimiento)', () => {
  assert.equal(generarAsientoEgreso({ tipo_movimiento: 'ingreso', valor_con_iva: 100000 }, []).error, 'no_es_egreso');
  assert.equal(generarAsientoEgreso({ valor_con_iva: 100000 }, []).error, 'no_es_egreso');
  // No distingue mayúsculas/minúsculas -- 'EGRESO' también cuenta.
  assert.equal(
    generarAsientoEgreso(
      { tipo_movimiento: 'EGRESO', valor_sin_iva: 100000, valor_iva: 0, valor_con_iva: 100000, subcuenta_gasto: '519530' },
      []
    ).error,
    undefined
  );
});

test('generarAsientoEgreso: sin_valor si el total no es positivo', () => {
  assert.equal(generarAsientoEgreso({ tipo_movimiento: 'egreso', valor_con_iva: 0 }, []).error, 'sin_valor');
  assert.equal(generarAsientoEgreso({ tipo_movimiento: 'egreso', valor_con_iva: -50000 }, []).error, 'sin_valor');
});

test('generarAsientoEgreso: valores_no_cuadran si subtotal + IVA no cuadra con el total', () => {
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 19000, valor_con_iva: 200000 };
  assert.equal(generarAsientoEgreso(inv, []).error, 'valores_no_cuadran');
});

test('generarAsientoEgreso: sin_subcuenta_gasto si no hay categoría en la cabecera ni en los ítems', () => {
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 19000, valor_con_iva: 119000 };
  assert.equal(generarAsientoEgreso(inv, []).error, 'sin_subcuenta_gasto');
  // Un ítem sin subcuenta_gasto (falsy) tampoco cuenta -- cae igual al
  // mismo error que si no hubiera ítems.
  assert.equal(generarAsientoEgreso(inv, [{ subtotal: 100000 }]).error, 'sin_subcuenta_gasto');
});

test('generarAsientoEgreso: retenciones_mayores_al_total si las retenciones superan lo que se le debe al proveedor', () => {
  const inv = {
    tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 0, valor_con_iva: 100000,
    subcuenta_gasto: '519530', categoria_concepto: 'compras',
    rete_fuente: 60000, rete_ica: 50000,
  };
  assert.equal(generarAsientoEgreso(inv, []).error, 'retenciones_mayores_al_total');
});

test('generarAsientoEgreso: asiento_no_cuadra como red de seguridad si el débito del gasto no coincide con el subtotal real', () => {
  // Fuerza la inconsistencia a propósito: el ítem solo cubre 40.000 de
  // un subtotal de factura de 100.000 -- el débito del gasto (40.000)
  // queda descuadrado contra el crédito a proveedores (100.000).
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 0, valor_con_iva: 100000, categoria_concepto: 'compras' };
  const items = [{ subcuenta_gasto: '519530', subtotal: 40000, categoria_concepto: 'compras' }];
  assert.equal(generarAsientoEgreso(inv, items).error, 'asiento_no_cuadra');
});

// ---------- Caso normal: una sola categoría, con IVA y las tres retenciones ----------

test('generarAsientoEgreso: factura de una sola categoría con IVA + Rete Fuente + Rete IVA + Rete ICA cuadra y genera 6 líneas', () => {
  const inv = {
    tipo_movimiento: 'egreso',
    valor_sin_iva: 1000000,
    valor_iva: 190000,
    valor_con_iva: 1190000,
    subcuenta_gasto: '513595', // Servicios -- Otros
    categoria_concepto: 'servicios',
    rete_fuente: 40000, // 4% de 1.000.000
    rete_iva: 28500,    // 15% de 190.000
    rete_ica: 9660,
  };
  const r = generarAsientoEgreso(inv, []);
  assert.equal(r.error, undefined);
  assert.equal(r.lineas.length, 6);
  assert.equal(r.debe, 1190000);
  assert.equal(r.haber, 1190000);

  assert.deepEqual(buscarLinea(r.lineas, '513595').map((l) => l.debito), [1000000]);
  assert.deepEqual(buscarLinea(r.lineas, '2408').map((l) => l.debito), [190000]); // IVA
  assert.deepEqual(buscarLinea(r.lineas, '236525').map((l) => l.credito), [40000]); // Rete Fuente -- servicios
  assert.deepEqual(buscarLinea(r.lineas, '2367').map((l) => l.credito), [28500]); // Rete IVA
  assert.deepEqual(buscarLinea(r.lineas, '2368').map((l) => l.credito), [9660]); // Rete ICA
  assert.deepEqual(buscarLinea(r.lineas, '2205').map((l) => l.credito), [1190000 - 40000 - 28500 - 9660]); // Proveedores
});

test('generarAsientoEgreso: sin IVA no agrega la línea de IVA (2408)', () => {
  const inv = {
    tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 0, valor_con_iva: 100000,
    subcuenta_gasto: '519530', categoria_concepto: 'compras',
  };
  const r = generarAsientoEgreso(inv, []);
  assert.equal(r.error, undefined);
  assert.equal(buscarLinea(r.lineas, '2408').length, 0);
});

test('generarAsientoEgreso: si las retenciones cubren el 100% del total, no agrega línea de Proveedores (2205)', () => {
  const inv = {
    tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 0, valor_con_iva: 100000,
    subcuenta_gasto: '519530', categoria_concepto: 'compras',
    rete_fuente: 100000,
  };
  const r = generarAsientoEgreso(inv, []);
  assert.equal(r.error, undefined);
  assert.equal(buscarLinea(r.lineas, '2205').length, 0);
  assert.equal(r.debe, 100000);
  assert.equal(r.haber, 100000);
});

// ---------- Agrupamiento por ítems (multi-subcuenta) ----------

test('generarAsientoEgreso: con ítems, agrupa por subcuenta y SUMA los que comparten cuenta (ignora la cabecera)', () => {
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 999999, valor_iva: 0, valor_con_iva: 300000, categoria_concepto: 'compras' };
  // Nota: valor_sin_iva de la cabecera queda "mal" a propósito (999999)
  // para confirmar que con ítems presentes NO se usa -- solo importa que
  // valor_sin_iva + valor_iva == valor_con_iva para la validación previa,
  // así que se ajusta la cabecera para que esa cuenta sí cuadre.
  inv.valor_sin_iva = 300000;
  const items = [
    { subcuenta_gasto: '519530', subtotal: 100000, categoria_concepto: 'compras' },
    { subcuenta_gasto: '519530', subtotal: 50000, categoria_concepto: 'compras' }, // misma cuenta -- debe sumarse a la anterior
    { subcuenta_gasto: '519535', subtotal: 150000, categoria_concepto: 'compras' },
  ];
  const r = generarAsientoEgreso(inv, items);
  assert.equal(r.error, undefined);
  assert.deepEqual(buscarLinea(r.lineas, '519530').map((l) => l.debito), [150000]);
  assert.deepEqual(buscarLinea(r.lineas, '519535').map((l) => l.debito), [150000]);
  assert.equal(r.debe, 300000);
  assert.equal(r.haber, 300000);
});

test('generarAsientoEgreso: ignora ítems con subtotal <= 0', () => {
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 100000, valor_iva: 0, valor_con_iva: 100000, categoria_concepto: 'compras' };
  const items = [
    { subcuenta_gasto: '519530', subtotal: 0, categoria_concepto: 'compras' },
    { subcuenta_gasto: '519535', subtotal: 100000, categoria_concepto: 'compras' },
  ];
  const r = generarAsientoEgreso(inv, items);
  assert.equal(r.error, undefined);
  assert.equal(buscarLinea(r.lineas, '519530').length, 0);
  assert.deepEqual(buscarLinea(r.lineas, '519535').map((l) => l.debito), [100000]);
});

// ---------- Rete Fuente: una cuenta específica vs. la genérica 2365 ----------

test('generarAsientoEgreso: si todas las categorías comparten la misma cuenta de Rete Fuente, usa esa cuenta específica', () => {
  // servicios y transporte_carga comparten cuentaPUC 236525 en
  // TARIFAS_RETENCION -- no hace falta repartir nada.
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 500000, valor_iva: 0, valor_con_iva: 500000, rete_fuente: 10000 };
  const items = [
    { subcuenta_gasto: '513595', subtotal: 300000, categoria_concepto: 'servicios' },
    { subcuenta_gasto: '513550', subtotal: 200000, categoria_concepto: 'transporte_carga' },
  ];
  const r = generarAsientoEgreso(inv, items);
  assert.equal(r.error, undefined);
  assert.deepEqual(buscarLinea(r.lineas, '236525').map((l) => l.credito), [10000]);
  assert.equal(buscarLinea(r.lineas, '2365').length, 0);
});

test('generarAsientoEgreso: si las categorías mezclan cuentas de Rete Fuente distintas, cae a la genérica 2365 con nota de reparto', () => {
  // compras (236540) y servicios (236525) NO comparten cuenta -- la
  // factura solo trae el total de rete_fuente, no cuánto es de cada
  // categoría, así que no se puede repartir sin adivinar.
  const inv = { tipo_movimiento: 'egreso', valor_sin_iva: 500000, valor_iva: 0, valor_con_iva: 500000, rete_fuente: 10000 };
  const items = [
    { subcuenta_gasto: '519530', subtotal: 300000, categoria_concepto: 'compras' },
    { subcuenta_gasto: '513595', subtotal: 200000, categoria_concepto: 'servicios' },
  ];
  const r = generarAsientoEgreso(inv, items);
  assert.equal(r.error, undefined);
  assert.equal(buscarLinea(r.lineas, '236540').length, 0);
  assert.equal(buscarLinea(r.lineas, '236525').length, 0);
  const generica = buscarLinea(r.lineas, '2365');
  assert.equal(generica.length, 1);
  assert.equal(generica[0].credito, 10000);
  assert.match(generica[0].cuenta_nombre, /revisar reparto/);
});

// ---------- codigoCuentaGasto ----------

test('codigoCuentaGasto: traduce el pseudo-código "inventario" a la cuenta real 1435', () => {
  assert.equal(codigoCuentaGasto('inventario'), '1435');
});

test('codigoCuentaGasto: cualquier otro código pasa igual, sin traducir', () => {
  assert.equal(codigoCuentaGasto('519530'), '519530');
  assert.equal(codigoCuentaGasto('513595'), '513595');
});

// ---------- PLAN_CUENTAS_SEMILLA ----------

test('PLAN_CUENTAS_SEMILLA: incluye las cuentas fijas mínimas para causar una factura de compra', () => {
  const codigos = PLAN_CUENTAS_SEMILLA.map((c) => c.codigo);
  for (const codigo of ['1110', '1305', '1435', '2205', '2408', '2365', '2367', '2368']) {
    assert.ok(codigos.includes(codigo), `falta la cuenta ${codigo} en el plan semilla`);
  }
});

test('PLAN_CUENTAS_SEMILLA: no tiene códigos duplicados (el pseudo-código "inventario" no genera una 1435 repetida)', () => {
  const codigos = PLAN_CUENTAS_SEMILLA.map((c) => c.codigo);
  assert.equal(new Set(codigos).size, codigos.length);
  const entradas1435 = PLAN_CUENTAS_SEMILLA.filter((c) => c.codigo === '1435');
  assert.equal(entradas1435.length, 1);
  assert.equal(entradas1435[0].clase, 'activo');
  assert.equal(entradas1435[0].naturaleza, 'debito');
});

test('PLAN_CUENTAS_SEMILLA: toda cuenta trae una naturaleza válida (debito o credito)', () => {
  for (const cuenta of PLAN_CUENTAS_SEMILLA) {
    assert.ok(['debito', 'credito'].includes(cuenta.naturaleza), `naturaleza inválida en ${cuenta.codigo}: ${cuenta.naturaleza}`);
  }
});

// ---------- con el plan de cuentas propio del cliente ----------

const cuentaCli = (codigo, concepto, extra = {}) => ({ codigo, concepto, categoria_concepto: '', activo: true, recibe_movimiento: true, porcentaje: null, ...extra });
const PLAN_CLIENTE = [
  cuentaCli('513507', 'VIGILANCIA'),
  cuentaCli('513508', 'IVA VIGILANCIA'),
  cuentaCli('51451006', 'MANTENIMIENTO PUERTAS'),
  cuentaCli('51451002', 'IVA MTTO'),
  cuentaCli('236525', 'RF x P SERVICIOS', { recibe_movimiento: false }),
  cuentaCli('23652501', 'RETEFTE SERVICIOS 2%', { porcentaje: 2 }),
  cuentaCli('23652502', 'RETEFTE SERVICIOS 4%', { porcentaje: 4 }),
  cuentaCli('24081001', 'IVA DESCONTADOS'),
];
const facturaServicio = {
  tipo_movimiento: 'egreso', categoria_concepto: 'servicios',
  valor_sin_iva: '1000000', valor_iva: '190000', valor_con_iva: '1190000', rete_fuente: '40000',
};
const lineaDe = (r, codigo) => r.lineas.find((l) => l.cuenta_codigo === codigo);

test('asiento con plan del cliente: nombres del cliente y retención al auxiliar de la tarifa (4%)', () => {
  const r = generarAsientoEgreso(facturaServicio, [{ categoria_concepto: 'servicios', subcuenta_gasto: '51451006', subtotal: '1000000', valor_iva: '190000' }], { pucCliente: PLAN_CLIENTE });
  assert.equal(r.error, undefined);
  assert.equal(lineaDe(r, '51451006').cuenta_nombre, 'MANTENIMIENTO PUERTAS');
  assert.equal(lineaDe(r, '51451006').cuenta_cliente, true);
  assert.equal(lineaDe(r, '23652502').credito, 40000);
  assert.equal(lineaDe(r, '24081001').debito, 190000, 'IVA descontable al auxiliar del cliente');
  assert.equal(r.debe, r.haber);
});

test('asiento: cliente no responsable de IVA con "cuenta IVA" -> el IVA va a su cuenta "IVA ..." del gasto, nada a la 2408', () => {
  const r = generarAsientoEgreso(facturaServicio, [{ categoria_concepto: 'servicios', subcuenta_gasto: '51451006', subtotal: '1000000', valor_iva: '190000' }], { pucCliente: PLAN_CLIENTE, ivaMayorValorGasto: true, ivaEnCuentaIva: true });
  assert.equal(lineaDe(r, '51451002').debito, 190000);
  assert.ok(!r.lineas.some((l) => l.cuenta_codigo.startsWith('2408')));
  assert.equal(r.debe, r.haber);
});

test('asiento: no responsable de IVA sin cuenta "IVA ..." -> el IVA se suma al gasto', () => {
  const r = generarAsientoEgreso(facturaServicio, [{ categoria_concepto: 'servicios', subcuenta_gasto: '513595', subtotal: '1000000', valor_iva: '190000' }], { ivaMayorValorGasto: true });
  assert.equal(lineaDe(r, '513595').debito, 1190000);
  assert.ok(!lineaDe(r, '2408'));
});

test('asiento: no responsable de IVA, factura sin ítems -> el IVA se reparte al gasto de la cabecera', () => {
  const r = generarAsientoEgreso({ ...facturaServicio, subcuenta_gasto: '513507', categoria_concepto: 'vigilancia_aseo', rete_fuente: '0' }, [], { pucCliente: PLAN_CLIENTE, ivaMayorValorGasto: true, ivaEnCuentaIva: true });
  assert.equal(lineaDe(r, '513507').debito, 1000000);
  assert.equal(lineaDe(r, '513508').debito, 190000);
});

test('asiento: ítem marcado "IVA mayor valor" en un cliente responsable -> solo ese IVA al gasto', () => {
  const r = generarAsientoEgreso(facturaServicio, [
    { categoria_concepto: 'servicios', subcuenta_gasto: '513595', subtotal: '600000', valor_iva: '114000', iva_mayor_valor: true },
    { categoria_concepto: 'servicios', subcuenta_gasto: '514510', subtotal: '400000', valor_iva: '76000', iva_mayor_valor: false },
  ]);
  assert.equal(lineaDe(r, '513595').debito, 714000);
  assert.equal(lineaDe(r, '2408').debito, 76000);
  assert.equal(r.debe, r.haber);
});

test('asiento sin plan del cliente: igual que antes (2408 y 236525)', () => {
  const r = generarAsientoEgreso(facturaServicio, [{ categoria_concepto: 'servicios', subcuenta_gasto: '514510', subtotal: '1000000', valor_iva: '190000' }]);
  assert.equal(lineaDe(r, '2408').debito, 190000);
  assert.equal(lineaDe(r, '236525').credito, 40000);
  assert.equal(lineaDe(r, '236525').cuenta_cliente, false);
});

test('asiento: los ítems suman unos pesos distinto al subtotal (redondeo) -> se ajusta y cuadra', () => {
  // GAMOEZ 39710 (factura real de Bosques): 13 ítems suman $619.538, subtotal $619.534.
  const r = generarAsientoEgreso(
    { tipo_movimiento: 'egreso', categoria_concepto: 'compras', valor_sin_iva: '619534', valor_iva: '117712', valor_con_iva: '737246', rete_fuente: '0' },
    [{ categoria_concepto: 'compras', subcuenta_gasto: '519525', subtotal: '400000' }, { categoria_concepto: 'compras', subcuenta_gasto: '519530', subtotal: '219538' }]
  );
  assert.equal(r.error, undefined);
  assert.equal(lineaDe(r, '519525').debito, 399996);
  assert.equal(r.debe, r.haber);
});

test('asiento: una diferencia grande entre ítems y subtotal sigue sin proponerse', () => {
  const r = generarAsientoEgreso(
    { tipo_movimiento: 'egreso', categoria_concepto: 'compras', valor_sin_iva: '619534', valor_iva: '117712', valor_con_iva: '737246', rete_fuente: '0' },
    [{ categoria_concepto: 'compras', subcuenta_gasto: '519525', subtotal: '500000' }]
  );
  assert.equal(r.error, 'asiento_no_cuadra');
});

test('asiento: no responsable de IVA (por defecto) -> el IVA se suma a la MISMA cuenta del gasto, como lo lleva Mafe', () => {
  // Coraza julio en la contabilidad de Bosques: 513507 VIGILANCIA por el total con IVA.
  const r = generarAsientoEgreso(
    { tipo_movimiento: 'egreso', categoria_concepto: 'vigilancia_aseo', valor_sin_iva: '23981409', valor_iva: '455647', valor_con_iva: '24437056', rete_fuente: '0' },
    [{ categoria_concepto: 'vigilancia_aseo', subcuenta_gasto: '513507', subtotal: '23981409', valor_iva: '455647' }],
    { pucCliente: PLAN_CLIENTE, ivaMayorValorGasto: true });
  assert.equal(lineaDe(r, '513507').debito, 24437056);
  assert.equal(lineaDe(r, '513508'), undefined);
  assert.equal(r.debe, r.haber);
});

test('asiento: IVA al gasto controlado en cuentas de orden 839519 / 869519', () => {
  const plan = [...PLAN_CLIENTE, cuentaCli('839519', 'IVA'), cuentaCli('869519', 'IVA 19')];
  const r = generarAsientoEgreso(
    { tipo_movimiento: 'egreso', categoria_concepto: 'servicios', valor_sin_iva: '709770', valor_iva: '134856', valor_con_iva: '844626', rete_fuente: '28391' },
    [{ categoria_concepto: 'servicios', subcuenta_gasto: '51451006', subtotal: '709770', valor_iva: '134856' }],
    { pucCliente: plan, ivaMayorValorGasto: true, ivaCuentasOrden: true });
  assert.equal(lineaDe(r, '51451006').debito, 844626);
  assert.equal(lineaDe(r, '839519').debito, 134856);
  assert.equal(lineaDe(r, '869519').credito, 134856);
  assert.equal(lineaDe(r, '23652502').credito, 28391);
  assert.equal(r.debe, r.haber);
});
