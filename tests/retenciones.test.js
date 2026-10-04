// Suite mínima de tests para public/retenciones.js -- el motor de
// cálculo compartido de Rete Fuente / Rete IVA / Rete ICA que usan
// Escanear, Carga Masiva, Facturas y el Informe de auditoría (y que
// server.js también consume vía require() para los asientos contables).
//
// Objetivo de esta suite: NO es cubrir cada rama de la norma tributaria
// (eso vive en los comentarios de retenciones.js), es evitar que un
// cambio futuro rompa en silencio uno de los cálculos que ya se
// verificaron a mano contra la norma -- declarante/no declarante, AIU,
// el acumulado anual de honorarios_natural, las exenciones de Rete IVA
// por calidad del proveedor, y el umbral de Rete ICA por municipio.
//
// Se corre con el test runner de Node (>=18, sin dependencias nuevas):
//   node --test tests/
// o, con el script agregado a package.json:
//   npm test
//
// Usa las MISMAS tarifas/UVT que ya viven en retenciones.js -- si la
// DIAN publica una UVT nueva o cambia una tarifa, actualiza esa tabla y
// estos tests (o dejan de coincidir).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  valorUvt,
  esUvtDeRespaldo,
  anioDeFechaFactura,
  umbralPesos,
  perfilFiscalEfectivo,
  calcularRetencionSugerida,
  calcularReteIvaSugerido,
  calcularReteIcaSugerido,
  autoCompletarAiuDesdeDescripcion,
  UVT_POR_ANIO,
  UVT_ANIO_MAS_RECIENTE,
  TARIFAS_RETENCION,
} = require(path.join(__dirname, '..', 'public', 'retenciones.js'));

const UVT_2026 = UVT_POR_ANIO[2026];
const clienteRetenedor = { agente_retenedor: true };
const clienteNoRetenedor = { agente_retenedor: false };
// Agente retenedor de RENTA (07) y agente retenedor de IVA son calidades
// distintas -- este fixture es el único que debe pasar las pruebas de
// calcularReteIvaSugerido(), que depende de agente_retenedor_iva.
const clienteRetenedorIva = { agente_retenedor: true, agente_retenedor_iva: true };

// ---------- UVT / fechas ----------

test('valorUvt: devuelve la UVT oficial de un año conocido', () => {
  assert.equal(valorUvt(2025), UVT_POR_ANIO[2025]);
  assert.equal(valorUvt(2026), UVT_POR_ANIO[2026]);
});

test('valorUvt: cae al valor de respaldo (año más reciente conocido) para un año sin registrar', () => {
  assert.equal(valorUvt(2027), UVT_POR_ANIO[UVT_ANIO_MAS_RECIENTE]);
  assert.equal(valorUvt(1999), UVT_POR_ANIO[UVT_ANIO_MAS_RECIENTE]);
});

test('esUvtDeRespaldo: true solo para años que no están en la tabla', () => {
  assert.equal(esUvtDeRespaldo(2026), false);
  assert.equal(esUvtDeRespaldo(2025), false);
  assert.equal(esUvtDeRespaldo(2027), true);
});

test('anioDeFechaFactura: solo entiende DD/MM/AAAA -- otros formatos caen al año más reciente', () => {
  assert.equal(anioDeFechaFactura('05/03/2027'), 2027);
  assert.equal(anioDeFechaFactura('1/1/2025'), 2025);
  assert.equal(anioDeFechaFactura('2027-03-05'), UVT_ANIO_MAS_RECIENTE); // formato ISO -- no coincide, cae al respaldo
  assert.equal(anioDeFechaFactura(''), UVT_ANIO_MAS_RECIENTE);
  assert.equal(anioDeFechaFactura(undefined), UVT_ANIO_MAS_RECIENTE);
});

test('umbralPesos: umbralUvt=0 siempre da $0 (categorías tipo honorarios, sin piso)', () => {
  assert.equal(umbralPesos(TARIFAS_RETENCION.honorarios_natural, '01/09/2026'), 0);
});

test('umbralPesos: convierte umbralUvt a pesos con la UVT del año de la factura', () => {
  const esperado = Math.round(TARIFAS_RETENCION.servicios.umbralUvt * UVT_2026);
  assert.equal(umbralPesos(TARIFAS_RETENCION.servicios, '01/09/2026'), esperado);
});

// ---------- perfilFiscalEfectivo ----------

test('perfilFiscalEfectivo: el perfil guardado en terceros fiscales aplica aunque esta factura puntual no diga nada', () => {
  // Si CUALQUIERA de las dos fuentes (ficha de terceros o lo leído en
  // esta factura) marca regimen_simple/autorretenedor, el resultado es
  // true -- no se exige que ambas coincidan, y la ficha de terceros por
  // sí sola basta aunque la factura puntual no traiga esa marca.
  const perfilTercero = { regimen_simple: true, autorretenedor: true, declarante_renta: true };
  const inv = {}; // esta factura puntual no trae ninguna marca -- debe igual ganar por la ficha de terceros
  const efectivo = perfilFiscalEfectivo(inv, perfilTercero);
  assert.deepEqual(efectivo, { regimenSimple: true, autorretenedor: true, declaranteRenta: true, aplicaArticulo383: false });
});

test('perfilFiscalEfectivo: sin perfil de tercero, cae a lo leído de la factura puntual', () => {
  const efectivo = perfilFiscalEfectivo({ regimen_simple: 'true', autorretenedor: false }, null);
  assert.equal(efectivo.regimenSimple, true);
  assert.equal(efectivo.autorretenedor, false);
  assert.equal(efectivo.declaranteRenta, false); // nunca se asume declarante sin marcarlo explícito
});

// ---------- calcularRetencionSugerida: casos que anulan el cálculo ----------

test('calcularRetencionSugerida: null si el cliente no es agente retenedor', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 5000000, nit_cc: '900111222', fecha_factura: '01/09/2026' };
  assert.equal(calcularRetencionSugerida(inv, clienteNoRetenedor, {}, null, {}), null);
});

test('calcularRetencionSugerida: null si el proveedor es de Régimen Simple', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 5000000, nit_cc: '900111222', fecha_factura: '01/09/2026', regimen_simple: true };
  assert.equal(calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {}), null);
});

test('calcularRetencionSugerida: null si el proveedor se autorretiene', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 5000000, nit_cc: '900111222', fecha_factura: '01/09/2026' };
  const perfilTercero = { autorretenedor: true };
  assert.equal(calcularRetencionSugerida(inv, clienteRetenedor, {}, perfilTercero, {}), null);
});

test('calcularRetencionSugerida: null bajo el umbral de la categoría', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 50000, nit_cc: '900111222', fecha_factura: '01/09/2026' }; // umbral ~$104.748
  assert.equal(calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {}), null);
});

test('calcularRetencionSugerida: null en categoría "otro" (sin tarifa confirmada) -- nunca se adivina', () => {
  const inv = { categoria_concepto: 'otro', valor_sin_iva: 50000000, nit_cc: '900111222', fecha_factura: '01/09/2026' };
  assert.equal(calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {}), null);
});

// ---------- calcularRetencionSugerida: rango declarante/no declarante ----------

test('calcularRetencionSugerida (servicios): sin saber si declara renta, devuelve el rango completo', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, nit_cc: '900111222', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {});
  assert.equal(r.bajo, Math.round(1000000 * 0.04));
  assert.equal(r.alto, Math.round(1000000 * 0.06));
  assert.equal(r.mismaTarifa, false);
});

test('calcularRetencionSugerida (servicios): declarante de renta confirmado -> tarifa baja exacta', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, nit_cc: '900111222', fecha_factura: '01/09/2026' };
  const perfilTercero = { declarante_renta: true };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, perfilTercero, {});
  assert.equal(r.bajo, Math.round(1000000 * 0.04));
  assert.equal(r.alto, r.bajo);
  assert.equal(r.mismaTarifa, true);
});

test('calcularRetencionSugerida: una tarifa ya aprendida para ese NIT+categoría manda sobre declarante/rango', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, nit_cc: '900111222', fecha_factura: '01/09/2026' };
  const tarifasAprendidas = { '900111222|servicios': 0.05 }; // ni 4% ni 6% -- una tarifa distinta ya confirmada antes
  const r = calcularRetencionSugerida(inv, clienteRetenedor, tarifasAprendidas, { declarante_renta: true }, {});
  assert.equal(r.bajo, Math.round(1000000 * 0.05));
  assert.equal(r.mismaTarifa, true);
});

// ---------- calcularRetencionSugerida: honorarios_natural (acumulado_anual) ----------

test('honorarios_natural: sin acumulado disponible todavía, muestra el rango 10%-11%', () => {
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {});
  assert.equal(r.bajo, Math.round(5000000 * 0.10));
  assert.equal(r.alto, Math.round(5000000 * 0.11));
  assert.equal(r.mismaTarifa, false);
});

test('honorarios_natural: acumulado del año bajo el umbral (3.300 UVT) -> resuelve tarifa exacta 10%', () => {
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, { honorarios_natural: 20000000 });
  assert.equal(r.mismaTarifa, true);
  assert.equal(r.bajo, Math.round(5000000 * 0.10));
  assert.equal(r.criterioTarifa, 'acumulado_anual');
  assert.equal(r.cruzaUmbralConEstePago, false);
});

test('honorarios_natural: el pago que cruza el umbral de 3.300 UVT en el año -> resuelve tarifa exacta 11%', () => {
  // Umbral en pesos 2026: round(3300 * UVT_2026). Con 170M acumulados +
  // 5M de esta factura, el total (175M) debe superarlo.
  const umbralAcumulado = Math.round(3300 * UVT_2026);
  assert.ok(170000000 + 5000000 > umbralAcumulado, 'el fixture debe cruzar el umbral -- si esto falla, ajusta los montos del test');
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, { honorarios_natural: 170000000 });
  assert.equal(r.mismaTarifa, true);
  assert.equal(r.bajo, Math.round(5000000 * 0.11));
  assert.equal(r.cruzaUmbralConEstePago, true);
});

test('honorarios_natural: declarante_renta NO cambia nada -- este criterio ignora esa marca por norma', () => {
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, { declarante_renta: true }, {});
  assert.equal(r.mismaTarifa, false); // sigue en rango -- "declarante" no aplica a esta categoría
  assert.equal(r.bajo, Math.round(5000000 * 0.10));
  assert.equal(r.alto, Math.round(5000000 * 0.11));
});

// ---------- calcularRetencionSugerida: Art. 383 ET (rentas de trabajo) ----------
// Mutuamente excluyente con honorarios/servicios (Concepto DIAN 752 de
// 2023) -- si el contador marcó este NIT como sujeto al 383 en la ficha
// de Terceros fiscales, no se debe sugerir la tarifa fija de
// honorarios_natural (10%/11%) ni de servicios (4%/6%).

test('honorarios_natural: con aplica_articulo_383 marcado, NO sugiere 10%/11% -- avisa que aplica 383', () => {
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, { aplica_articulo_383: true }, {});
  assert.equal(r.aplicaArticulo383, true);
  assert.equal(r.bajo, 0);
  assert.equal(r.alto, 0);
});

test('servicios: con aplica_articulo_383 marcado, NO sugiere 4%/6% -- avisa que aplica 383', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, { aplica_articulo_383: true }, {});
  assert.equal(r.aplicaArticulo383, true);
});

test('compras: aplica_articulo_383 marcado NO afecta esta categoría -- el 383 solo aplica a honorarios/servicios de persona natural', () => {
  const inv = { categoria_concepto: 'compras', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, { aplica_articulo_383: true }, {});
  assert.equal(r.aplicaArticulo383, undefined);
  assert.equal(r.bajo, Math.round(5000000 * 0.025));
});

test('honorarios_natural: sin la marca aplica_articulo_383, sigue sugiriendo el rango 10%-11% de siempre', () => {
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 5000000, nit_cc: '10203040', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, { aplica_articulo_383: false }, {});
  assert.equal(r.aplicaArticulo383, undefined);
  assert.equal(r.bajo, Math.round(5000000 * 0.10));
});


// ---------- calcularRetencionSugerida: categorías con base especial AIU ----------

test('vigilancia_aseo (AIU): sin AIU informado -> requiereAiu true, nunca calcula un monto', () => {
  const inv = { categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 5000000, nit_cc: '900333444', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {});
  assert.equal(r.requiereAiu, true);
  assert.equal(r.categoriasFaltantesAiu[0].aiuMinimoPresuntivo, Math.round(5000000 * 0.10));
});

test('vigilancia_aseo (AIU): AIU declarado bajo el piso presuntivo (10%) -- se calcula sobre el piso, no sobre el AIU real', () => {
  const inv = { categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 5000000, valor_aiu: 300000, nit_cc: '900333444', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {});
  const piso = Math.round(5000000 * 0.10); // $500.000 -- el AIU real (300.000) queda por debajo, así que manda el piso
  assert.equal(r.bajo, Math.round(piso * 0.02));
  assert.equal(r.mismaTarifa, true);
  assert.equal(r.requiereAiu, false);
});

test('vigilancia_aseo (AIU): AIU declarado por encima del piso -- se calcula sobre el AIU real', () => {
  const inv = { categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 5000000, valor_aiu: 800000, nit_cc: '900333444', fecha_factura: '01/09/2026' };
  const r = calcularRetencionSugerida(inv, clienteRetenedor, {}, null, {});
  assert.equal(r.bajo, Math.round(800000 * 0.02));
  assert.equal(r.requiereAiu, false);
});

// ---------- calcularReteIvaSugerido ----------

test('calcularReteIvaSugerido: null sin IVA en la factura', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, valor_iva: 0, fecha_factura: '01/09/2026' };
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedorIva, null), null);
});

test('calcularReteIvaSugerido: null si el cliente no es agente retenedor (ni de renta ni de IVA)', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, valor_iva: 190000, fecha_factura: '01/09/2026' };
  assert.equal(calcularReteIvaSugerido(inv, clienteNoRetenedor, null), null);
});

test('calcularReteIvaSugerido: null si el cliente es agente retenedor de RENTA pero NO está marcado como agente retenedor de IVA', () => {
  // Ser agente retenedor (código 07 del RUT, retención de renta) no
  // implica ser agente de retención de IVA -- son calidades distintas,
  // y esta es la regresión que cubre justo ese caso.
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, valor_iva: 190000, fecha_factura: '01/09/2026' };
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedor, null), null);
});

test('calcularReteIvaSugerido: exento cuando el proveedor ya es Gran Contribuyente o agente de retención de IVA', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, valor_iva: 190000, fecha_factura: '01/09/2026' };
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedorIva, { gran_contribuyente: true }), null);
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedorIva, { agente_retencion_iva: true }), null);
});

test('calcularReteIvaSugerido: Régimen Simple y Autorretenedor NO eximen de Rete IVA (solo eximen Fuente/ICA)', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, valor_iva: 190000, fecha_factura: '01/09/2026' };
  const esperado = Math.round(190000 * 0.15);
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedorIva, { regimen_simple: true }), esperado);
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedorIva, { autorretenedor: true }), esperado);
});

test('calcularReteIvaSugerido: 15% del IVA cuando todo aplica', () => {
  const inv = { categoria_concepto: 'servicios', valor_sin_iva: 1000000, valor_iva: 190000, fecha_factura: '01/09/2026' };
  assert.equal(calcularReteIvaSugerido(inv, clienteRetenedorIva, null), Math.round(190000 * 0.15));
});

// ---------- calcularReteIcaSugerido ----------

test('calcularReteIcaSugerido: null sin tarifa ICA configurada', () => {
  const inv = { valor_sin_iva: 5000000, fecha_factura: '01/09/2026' };
  assert.equal(calcularReteIcaSugerido(inv, null), null);
});

test('calcularReteIcaSugerido: null bajo la base mínima (en UVT) configurada para el municipio', () => {
  const inv = { valor_sin_iva: 100000, fecha_factura: '01/09/2026' };
  const tarifa = { tarifa_por_mil: 9.66, base_uvt: 10, municipio: 'Bogotá' }; // base ~$523.740
  assert.equal(calcularReteIcaSugerido(inv, tarifa), null);
});

test('calcularReteIcaSugerido: calcula el monto sobre el subtotal cuando supera la base', () => {
  const inv = { valor_sin_iva: 5000000, fecha_factura: '01/09/2026' };
  const tarifa = { tarifa_por_mil: 9.66, base_uvt: 0, municipio: 'Bogotá' };
  const r = calcularReteIcaSugerido(inv, tarifa);
  assert.equal(r.monto, Math.round(5000000 * (9.66 / 1000)));
});

// ---------- autoCompletarAiuDesdeDescripcion ----------
// Caso real que motivó esta función: una factura de vigilancia que
// desglosa su propio AIU como una línea aparte (ej. "AIU 10 Art 46 Ley
// 1607 de 2026") en vez de reportarlo en la columna AIU de la línea de
// servicio -- el dato ya estaba en la factura, solo en el campo
// equivocado, y el aviso de "falta el AIU" seguía saliendo.

test('autoCompletarAiuDesdeDescripcion: copia el subtotal al AIU cuando la descripción dice "AIU" y el campo está vacío', () => {
  const items = [
    { descripcion: 'Servicio de vigilancia privada', subtotal: '15015414', categoria_concepto: 'vigilancia_aseo', aiu: '' },
    { descripcion: 'AIU 10 Art 46 Ley 1607 de 2026', subtotal: '2333094', categoria_concepto: 'vigilancia_aseo', aiu: '' },
  ];
  autoCompletarAiuDesdeDescripcion(items);
  assert.equal(items[0].aiu, ''); // esta línea no dice "AIU" en su descripción -- no se toca
  assert.equal(items[1].aiu, '2333094'); // esta sí, y copia su propio subtotal
});

test('autoCompletarAiuDesdeDescripcion: nunca pisa un AIU que el contador ya escribió a mano', () => {
  const items = [
    { descripcion: 'AIU del contrato de vigilancia', subtotal: '2333094', categoria_concepto: 'vigilancia_aseo', aiu: '1000000' },
  ];
  autoCompletarAiuDesdeDescripcion(items);
  assert.equal(items[0].aiu, '1000000');
});

test('autoCompletarAiuDesdeDescripcion: no hace nada fuera de las categorías con base especial de AIU', () => {
  const items = [
    { descripcion: 'AIU de administración', subtotal: '500000', categoria_concepto: 'servicios', aiu: '' },
  ];
  autoCompletarAiuDesdeDescripcion(items);
  assert.equal(items[0].aiu, '');
});

test('autoCompletarAiuDesdeDescripcion: no hace nada si la descripción no menciona "AIU" como palabra', () => {
  const items = [
    { descripcion: 'Servicio de vigilancia privada mensual', subtotal: '15015414', categoria_concepto: 'servicios_temporales', aiu: '' },
  ];
  autoCompletarAiuDesdeDescripcion(items);
  assert.equal(items[0].aiu, '');
});


// ---------- Art. 383 detectado en el documento ----------
// Reporte de la revisora (oct. 2026): una cuenta de cobro que dice
// "practicar la retención con la tabla del artículo 383" no debe recibir
// la tarifa fija de 4%/6%/10%/11%, aunque el NIT no esté marcado en
// Terceros fiscales.
test('perfilFiscalEfectivo: el Art. 383 puede venir del documento leído', () => {
  const r = require('../public/retenciones');
  assert.equal(r.perfilFiscalEfectivo({ solicita_articulo_383: true }, null).aplicaArticulo383, true);
  assert.equal(r.perfilFiscalEfectivo({ solicita_articulo_383: 'true' }, null).aplicaArticulo383, true);
  assert.equal(r.perfilFiscalEfectivo({}, null).aplicaArticulo383, false);
  assert.equal(r.perfilFiscalEfectivo({}, { aplica_articulo_383: true }).aplicaArticulo383, true);
});

test('calcularRetencionSugerida: honorarios con Art. 383 en el documento no sugiere tarifa fija', () => {
  const r = require('../public/retenciones');
  const inv = { categoria_concepto: 'honorarios_natural', valor_sin_iva: 3650000, valor_iva: 0, nit_cc: '71261773', fecha_factura: '17/07/2026', solicita_articulo_383: true };
  const sugerido = r.calcularRetencionSugerida(inv, { agente_retenedor: true }, {}, null);
  assert.ok(!sugerido || sugerido.aplicaArticulo383 === true);
  assert.ok(!sugerido || !(sugerido.bajo > 0));
});

// ---------- AIU con facturas reales (Coraza Seguridad, oct. 2026) ----------
// La retención de vigilancia es el 2% sobre el AIU, no sobre el total.
const RA = require('../public/retenciones');
const PH = { agente_retenedor: true };
const sugerirConItems = (data) => {
  data.items = RA.normalizarItemsDesdeIA(data);
  data.desglose_categorias = RA.desgloseDesdeItems(data.items);
  data.desglose_aiu = RA.desgloseAiuDesdeItems(data.items);
  return RA.calcularRetencionSugerida(data, PH, {}, null);
};

test('AIU: línea "AIU 10%" ya incluida en los servicios no se suma dos veces (Coraza VP18187)', () => {
  const data = {
    categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 23981410, valor_iva: 455646, fecha_factura: '14/07/2026', nit_cc: '900434727',
    items: [
      { descripcion: 'SERVICIO DE VIGILANCIA PRIVADA 24 HORAS', subtotal: 17148939, categoria_concepto: 'vigilancia_aseo' },
      { descripcion: 'SERVICIO DE VIGILANCIA PRIVADA 08 HORAS NOCTURNAS', subtotal: 6832470, categoria_concepto: 'vigilancia_aseo' },
      { descripcion: 'AIU 10 Art 46 Ley 1607 de 2012', subtotal: 2398141, categoria_concepto: 'vigilancia_aseo' },
    ],
  };
  const s = sugerirConItems(data);
  assert.equal(data.items.length, 2);
  assert.equal(s.bajo, 47963); // 2% x 2.398.141 (antes: 52.759)
});

test('AIU: valor imposible leído por la IA se descarta y se deduce del IVA (Coraza VP17983)', () => {
  const data = {
    categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 23330941, valor_iva: 443288, fecha_factura: '16/06/2026', nit_cc: '900434727',
    items: [
      { descripcion: '24 HORAS EN PORTERIA PERMANENTES', subtotal: 16683793, categoria_concepto: 'vigilancia_aseo', aiu: 15015414 },
      { descripcion: '08 HORAS NOCTURNAS EN RONDA', subtotal: 6647147, categoria_concepto: 'vigilancia_aseo', aiu: 5982432 },
    ],
  };
  const s = sugerirConItems(data);
  assert.equal(data.items[0].aiu_origen, 'iva');
  assert.equal(s.bajo, 46662); // 2% x (443.288 / 19%) (antes: 419.957)
});

test('AIU: una línea de AIU que sí suma al subtotal se conserva (Limpieza y Soluciones)', () => {
  const data = {
    categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 11915111, valor_iva: 205806, fecha_factura: '10/07/2026', nit_cc: '900937794',
    items: [
      { descripcion: 'SERVICIO INTEGRAL DE ASEO Y CAFETERIA', subtotal: 10831919, categoria_concepto: 'vigilancia_aseo' },
      { descripcion: 'AIU (Servicio Aseo)', subtotal: 1083192, categoria_concepto: 'vigilancia_aseo' },
    ],
  };
  RA.normalizarItemsDesdeIA(data);
  const items = RA.normalizarItemsDesdeIA(data);
  assert.equal(items.length, 2);
  assert.equal(items[1].aiu, '1083192');
});

test('AIU: no se deduce del IVA si el IVA es sobre todo el valor', () => {
  const data = {
    categoria_concepto: 'vigilancia_aseo', valor_sin_iva: 1000000, valor_iva: 190000, fecha_factura: '10/07/2026',
    items: [{ descripcion: 'Servicio de aseo', subtotal: 1000000, categoria_concepto: 'vigilancia_aseo' }],
  };
  const items = RA.normalizarItemsDesdeIA(data);
  assert.equal(items[0].aiu, '');
});

// ---------- Subcuenta aprendida por proveedor ----------
test('subcuenta aprendida: la próxima factura del proveedor la trae preseleccionada', () => {
  RA.registrarSubcuentasAprendidas({ '71261773|servicios': '514515' });
  const items = RA.normalizarItemsDesdeIA({ nit_cc: '71.261.773-2', categoria_concepto: 'servicios', concepto: 'Mantenimiento bomba', valor_sin_iva: 280000 });
  assert.equal(items[0].subcuenta_gasto, '514515');
  // otro proveedor, o la misma persona en otra categoría: lista general
  assert.equal(RA.normalizarItemsDesdeIA({ nit_cc: '900123456', categoria_concepto: 'servicios', valor_sin_iva: 1 })[0].subcuenta_gasto, '513595');
  assert.equal(RA.normalizarItemsDesdeIA({ nit_cc: '71261773', categoria_concepto: 'compras', valor_sin_iva: 1 })[0].subcuenta_gasto, '519595');
  RA.registrarSubcuentasAprendidas({});
});

test('PUC: compras ya no preselecciona Inventarios y no quedan códigos inexistentes', () => {
  assert.equal(RA.SUBCUENTAS_GASTO.compras[0][0], '519595');
  const todos = Object.values(RA.SUBCUENTAS_GASTO).flat().map(([c]) => c);
  for (const inexistente of ['513528', '513560', '513565', '513570', '513545']) assert.equal(todos.includes(inexistente), false);
});
