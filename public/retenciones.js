// ---------- Retención en la fuente sugerida (fuente única para toda la app) ----------
// Antes esta tabla y este cálculo vivían duplicados en más de un
// archivo (Escanear tenía su propia versión resumida, Facturas tenía la
// versión completa que alimenta el Excel) -- eso es peligroso: si la
// norma cambia y solo se actualiza un archivo, la app queda dando
// respuestas distintas según la pantalla. Ahora este es el ÚNICO lugar
// que hay que tocar cuando cambie una tarifa o un umbral; todas las
// páginas (Escanear, Carga masiva, Facturas) cargan este mismo archivo.
//
// Tabla de retención en la fuente vigente (2026), solo para las
// categorías donde se confirmó la tarifa con fuentes actuales
// (Gerencie.com, cruzado con Siigo y Ámbito Jurídico). Para "otro" no
// se calcula -- no encaja en ninguna categoría confiable.
// La tarifa exacta depende de si el proveedor es declarante de renta o
// no (dato que casi nunca se sabe desde la factura) -- por eso se
// devuelve como RANGO (tarifa declarante -- tarifa no declarante) en
// las categorías donde de verdad cambia; el resto tiene una sola
// tarifa fija, sin importar si declara o no.
// Umbrales vigentes desde el 1 jul 2026 -- el Consejo de Estado revocó
// la suspensión del Decreto 572/2025 (exp. 30229), así que volvieron a
// aplicar las bases originales del decreto. Verificado contra tabla de
// retención en la fuente 2026 (Gerencie.com, cruzado con Siigo/Alegra)
// el 3 de sept de 2026.
//
// IMPORTANTE -- esto NO es asesoría tributaria: es una tabla que se
// mantiene a mano según la norma vigente al momento de escribir esto.
// La base de retención en la fuente ha cambiado varias veces solo en
// 2026 por decisiones judiciales -- revisa la norma actual antes de
// confiar ciegamente en estos valores, y actualiza este archivo (es el
// único que hace falta tocar) en cuanto cambie algo.
// `cuentaPUC` -- la subcuenta del Plan Único de Cuentas (grupo 2365,
// "Retención en la fuente") donde contablemente se registra cada
// categoría, según puc.com.co. El PUC no tiene subcuenta propia para
// transporte, software, vigilancia ni hoteles dentro de Retención en
// la fuente -- contablemente se registran como "Servicios" (236525),
// aunque la DIAN les aplique una tarifa de retención distinta. La
// tarifa depende de la norma; la cuenta depende del PUC -- son cosas
// separadas. Rete IVA (cuenta 2367) y Rete ICA (cuenta 2368) están
// aparte, en CUENTAS_PUC_FIJAS, porque no dependen de la categoría.
//
// `umbralUvt` -- la base mínima está fijada EN UVT por la norma, no en
// pesos. Antes esta tabla tenía el peso ya calculado a mano (524000,
// 105000...) y había que acordarse de recalcular TODOS esos números
// cada vez que cambiaba la UVT (pasa cada enero, y a veces más --
// 2026 tuvo cambios judiciales a mitad de año). Ahora el peso se
// calcula solo, cruzando `umbralUvt` con el valor de UVT del AÑO DE LA
// FACTURA (ver UVT_POR_ANIO más abajo) -- así una factura de 2025 usa
// la UVT de 2025 y una de 2026 usa la de 2026, automáticamente.
//
// `baseEspecial: 'aiu'` -- SOLO en vigilancia_aseo y servicios_temporales.
// Marca las dos categorías donde la DIAN aplica una regla de dos pasos
// distinta al resto (Concepto DIAN 100202208-1587, ago 2026): el umbral
// de arriba se prueba contra el valor BRUTO de la factura (igual que
// cualquier otra categoría), pero la TARIFA se aplica solo sobre el
// componente de AIU (Administración + Imprevistos + Utilidad), nunca
// sobre el bruto -- ver calcularRetencionCategoriaLinea() más abajo,
// que es donde vive toda la lógica especial.
const TARIFAS_RETENCION = {
  compras:                 { umbralUvt: 10, tarifaBaja: 0.025, tarifaAlta: 0.035, cuentaPUC: '236540', nombrePUC: 'Compras' },
  compras_tarjeta:         { umbralUvt: 0,  tarifaBaja: 0.015, tarifaAlta: 0.015, cuentaPUC: '236540', nombrePUC: 'Compras' },
  servicios:                { umbralUvt: 2,  tarifaBaja: 0.04,  tarifaAlta: 0.06,  cuentaPUC: '236525', nombrePUC: 'Servicios' },
  honorarios_juridica:      { umbralUvt: 0,  tarifaBaja: 0.11,  tarifaAlta: 0.11,  cuentaPUC: '236515', nombrePUC: 'Honorarios' },
  // OJO -- a diferencia de compras/servicios de arriba, el 10%/11% de
  // honorarios a PERSONA NATURAL NO depende de si el proveedor declara
  // renta o no. El art. 1.2.4.3.1 del Decreto 1625 de 2016 (texto citado
  // por Gerencie.com) es explícito en que la norma "no habla de
  // declarantes y no declarantes, sino del monto de los pagos anuales":
  // 10% mientras lo pagado a ESE proveedor en el año gravable sea <=
  // 3.300 UVT, y 11% desde el pago que hace que el acumulado del año
  // supere ese monto en adelante (verificado cruzando Gerencie.com y
  // Alegra el 14 de sept de 2026, fuente: tabla de Siigo que compartió
  // el usuario). `criterioTarifa`/`umbralAcumuladoUvt` son lo que le
  // dice a calcularRetencionCategoriaLinea() que NO use el atajo de
  // "declarante" de perfilFiscalEfectivo() para esta categoría, y que
  // en cambio resuelva la tarifa sola cuando se le pase el acumulado
  // del año (ver acumuladoAnualPrevio más abajo) -- mismo principio que
  // baseEspecial:'aiu', pero con un criterio distinto.
  honorarios_natural:       { umbralUvt: 0,  tarifaBaja: 0.10,  tarifaAlta: 0.11,  cuentaPUC: '236515', nombrePUC: 'Honorarios', criterioTarifa: 'acumulado_anual', umbralAcumuladoUvt: 3300 },
  arrendamiento_muebles:    { umbralUvt: 0,  tarifaBaja: 0.04,  tarifaAlta: 0.04,  cuentaPUC: '236530', nombrePUC: 'Arrendamientos' },
  arrendamiento_inmuebles:  { umbralUvt: 10, tarifaBaja: 0.035, tarifaAlta: 0.035, cuentaPUC: '236530', nombrePUC: 'Arrendamientos' },
  transporte_carga:         { umbralUvt: 2,  tarifaBaja: 0.01,  tarifaAlta: 0.01,  cuentaPUC: '236525', nombrePUC: 'Servicios' },
  transporte_pasajeros:     { umbralUvt: 10, tarifaBaja: 0.035, tarifaAlta: 0.035, cuentaPUC: '236525', nombrePUC: 'Servicios' },
  licenciamiento_software:  { umbralUvt: 0,  tarifaBaja: 0.035, tarifaAlta: 0.035, cuentaPUC: '236525', nombrePUC: 'Servicios' },
  vigilancia_aseo:          { umbralUvt: 2,  tarifaBaja: 0.02,  tarifaAlta: 0.02,  cuentaPUC: '236525', nombrePUC: 'Servicios', baseEspecial: 'aiu' },
  servicios_temporales:     { umbralUvt: 2,  tarifaBaja: 0.01,  tarifaAlta: 0.01,  cuentaPUC: '236525', nombrePUC: 'Servicios', baseEspecial: 'aiu' },
  hoteles_restaurantes:     { umbralUvt: 2,  tarifaBaja: 0.035, tarifaAlta: 0.035, cuentaPUC: '236525', nombrePUC: 'Servicios' },
};

// El piso presuntivo de AIU que fija la norma para estos dos conceptos
// (aseo/vigilancia y temporales): si el contrato no desglosa AIU, o lo
// desglosa por debajo de este mínimo, la tarifa se aplica sobre este
// piso -- nunca sobre un AIU menor, así el proveedor no pueda reducir
// la base reportando un AIU artificialmente bajo.
const AIU_PISO_PORCENTAJE = 0.10;

function esCategoriaBaseAiu(categoria) {
  const config = TARIFAS_RETENCION[String(categoria || '').toLowerCase()];
  return !!(config && config.baseEspecial === 'aiu');
}

// Si una línea YA DICE en su descripción que ella misma es el AIU (ej.
// "AIU 10 Art 46 Ley 1607 de 2026"), su propio subtotal completo ES el
// componente de AIU -- no hace falta que el contador lo vuelva a
// escribir en la columna AIU aparte. Motivado por un caso real: un
// proveedor de vigilancia que desglosa el AIU como una línea propia
// (en ese caso, exactamente el piso presuntivo del 10% del Art. 46 Ley
// 1607) en vez de reportarlo dentro del subtotal de la línea de
// servicio -- la factura ya tenía el dato, solo en el campo equivocado.
//
// Esto NO es adivinar una categoría fiscal ambigua (lo que este
// proyecto evita a propósito) -- es leer un texto que el proveedor ya
// escribió explícitamente. Por eso solo actúa cuando TODO esto se
// cumple:
//   - la categoría de la línea tiene base especial de AIU
//     (vigilancia_aseo/servicios_temporales) -- en cualquier otra
//     categoría el campo AIU no se usa, y llenarlo no tendría efecto.
//   - la descripción contiene la palabra "aiu" como palabra completa
//     (case-insensitive) -- no alcanza con que la categoría sea la
//     correcta, tiene que estar dicho en el texto.
//   - el ítem TODAVÍA no tiene un AIU declarado -- nunca pisa un valor
//     que el contador (o una llamada anterior a esta misma función) ya
//     haya puesto ahí.
// Muta los ítems en el lugar (y también los devuelve, por conveniencia)
// -- se puede llamar las veces que haga falta sin riesgo: en cuanto un
// ítem queda completado, `item.aiu` deja de estar vacío y la siguiente
// llamada ya no le hace nada.
function autoCompletarAiuDesdeDescripcion(items) {
  (items || []).forEach((item) => {
    if (!esCategoriaBaseAiu(item.categoria_concepto)) return;
    if (item.aiu !== undefined && item.aiu !== null && item.aiu !== '') return;
    if (!/\baiu\b/i.test(String(item.descripcion || ''))) return;
    const subtotalNum = Number(item.subtotal);
    if (!subtotalNum) return; // sin subtotal todavía no hay nada que copiar
    item.aiu = String(subtotalNum);
  });
  return items;
}

// Categorías donde la tarifa baja/alta se resuelve por el ACUMULADO de
// pagos a ese proveedor en el año, no por declarante/no declarante --
// hoy solo honorarios_natural. Ver el comentario junto a esa entrada en
// TARIFAS_RETENCION de arriba para la norma exacta.
function esCategoriaCriterioAcumulado(categoria) {
  const config = TARIFAS_RETENCION[String(categoria || '').toLowerCase()];
  return !!(config && config.criterioTarifa === 'acumulado_anual');
}

// Umbral en pesos del acumulado anual para una categoría de criterio
// 'acumulado_anual' (ej. honorarios_natural), según la fecha de la
// factura -- mismo mecanismo de umbralPesos() de abajo, pero usando
// `umbralAcumuladoUvt` en vez de `umbralUvt` (son cosas distintas: una
// es el piso para que aplique retención en UNA factura, la otra es el
// techo de acumulado del AÑO que decide si la tarifa sube a la alta).
function umbralAcumuladoPesos(configBase, fechaFactura) {
  const anio = anioDeFechaFactura(fechaFactura);
  return Math.round((configBase.umbralAcumuladoUvt || 0) * valorUvt(anio));
}

// ---------- UVT (Unidad de Valor Tributario) por año ----------
//
// Valores oficiales publicados por la DIAN. Se agrega una fila nueva
// cada enero cuando la DIAN publica el valor del año -- es el ÚNICO
// número que hay que actualizar; todos los umbrales de arriba se
// recalculan solos a partir de esto.
//   2025: Resolución DIAN, $49.799 (confirmado, aumento 5.81% vs 2024)
//   2026: Resolución DIAN, $52.374 (confirmado)
const UVT_POR_ANIO = {
  2025: 49799,
  2026: 52374,
};
// Año más reciente conocido -- se usa como respaldo para facturas de
// años aún no agregados a la tabla (ej. si ya estamos en un año nuevo
// y todavía no se agrega la fila). Mejor una UVT un poco desactualizada
// que un umbral de $0 que fuerce a calcular retención sobre cualquier
// centavo.
const UVT_ANIO_MAS_RECIENTE = 2026;

function valorUvt(anio) {
  if (UVT_POR_ANIO[anio] != null) return UVT_POR_ANIO[anio];
  return UVT_POR_ANIO[UVT_ANIO_MAS_RECIENTE];
}

// true cuando valorUvt(anio) tuvo que caer al valor de respaldo porque
// todavía no se agregó la fila de ese año en UVT_POR_ANIO -- ej. ya
// estamos en un año nuevo y la DIAN publicó la UVT pero nadie actualizó
// esta tabla. Antes esto pasaba en silencio (el cálculo seguía andando
// con un número "casi correcto" sin que el contador se enterara); ahora
// las pantallas que muestran retenciones sugeridas pueden usar esto para
// avisar explícitamente que el umbral usado es un estimado, no el UVT
// oficial de la factura.
function esUvtDeRespaldo(anio) {
  return UVT_POR_ANIO[Number(anio)] == null;
}

// La fecha de factura en esta app siempre viene como texto DD/MM/AAAA.
function anioDeFechaFactura(fechaFactura) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(fechaFactura || '').trim());
  if (m) return Number(m[3]);
  return UVT_ANIO_MAS_RECIENTE;
}

// Umbral en pesos para una categoría, según la fecha de la factura.
// ---------- Bases mínimas según la fecha (Decreto 0572 de 2025) ----------
// TARIFAS_RETENCION trae las bases del Decreto 0572 de 2025 (compras 10
// UVT, servicios 2 UVT). Pero ese decreto NO rigió todo el tiempo:
//   - hasta el 31/05/2025: tabla anterior (aún no regía el 572);
//   - 01/06/2025 a 07/05/2026: Decreto 572;
//   - 08/05/2026 a 30/06/2026: tabla anterior otra vez -- el Consejo de
//     Estado suspendió provisionalmente los arts. 2 a 8 del 572 (auto del
//     07/05/2026; DIAN, Boletín Especial 070 del 08/05/2026);
//   - desde 01/07/2026: Decreto 572 otra vez -- la suspensión se revocó
//     el 02/06/2026 (Auto 30229), con efecto desde el primer día del mes
//     siguiente a su ejecutoria.
// Fuentes (consultadas el 04/10/2026): actualicese.com, itscontable.com,
// siemprealdia.co, rioconsultores.com (Boletines 043 y 049).
// El 572 cambió BASES, no tarifas. Aquí solo se revierten las bases que
// las fuentes confirman: compras 27 UVT y servicios 4 UVT (servicios
// generales y los servicios con tarifa propia que comparten esa base).
const BASES_TABLA_ANTERIOR_572_UVT = {
  compras: 27,
  servicios: 4,
  transporte_carga: 4,
  vigilancia_aseo: 4,
  servicios_temporales: 4,
  hoteles_restaurantes: 4,
};
function rigeTablaAnteriorAl572(fechaFactura) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(fechaFactura || '').trim());
  if (!m) return false; // sin fecha clara: tabla vigente hoy (572)
  const fecha = Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
  return fecha < 20250601 || (fecha >= 20260508 && fecha <= 20260630);
}

function umbralPesos(configBase, fechaFactura) {
  const anio = anioDeFechaFactura(fechaFactura);
  let uvt = configBase.umbralUvt || 0;
  if (rigeTablaAnteriorAl572(fechaFactura)) {
    const categoria = Object.keys(TARIFAS_RETENCION).find((k) => TARIFAS_RETENCION[k] === configBase);
    if (categoria && BASES_TABLA_ANTERIOR_572_UVT[categoria] !== undefined) uvt = BASES_TABLA_ANTERIOR_572_UVT[categoria];
  }
  return Math.round(uvt * valorUvt(anio));
}

// Cuentas PUC fijas para Rete IVA y Rete ICA -- no dependen de la
// categoría del concepto de la factura, así que viven aparte.
const CUENTAS_PUC_FIJAS = {
  rete_iva: { cuentaPUC: '2367', nombrePUC: 'Impuesto a las ventas retenido' },
  rete_ica: { cuentaPUC: '2368', nombrePUC: 'Impuesto de industria y comercio retenido' },
};

// ---------- Subcuentas del gasto (no de la retención) ----------
//
// Esto es distinto a `cuentaPUC`/`nombrePUC` de arriba -- aquella es
// la cuenta donde se registra LA RETENCIÓN (una deuda con la DIAN,
// grupo 2365). Esto de aquí es la cuenta donde se registra EL GASTO
// EN SÍ (la compra o el servicio), que vive en la clase 5 del PUC.
//
// El contador elige la subcuenta exacta (nunca se adivina sola) --
// mismo principio que ya usamos para la categoría de retención: el
// sistema no decide algo ambiguo por su cuenta, el contador confirma
// y el sistema aplica el resto solo a partir de ahí.
//
// La primera opción de cada lista es la que se preselecciona por
// defecto (la más común), pero el contador puede cambiarla siempre.
const SUBCUENTAS_GASTO = {
  // Códigos verificados contra el PUC (Decreto 2650 de 1993, puc.com.co,
  // oct. 2026). Antes la primera opción de "compras" era Inventarios
  // (mercancía para revender): para clientes que no revenden (ej. una
  // propiedad horizontal) cada compra de aseo o repuestos quedaba como
  // activo. Ahora va primero el gasto, e Inventarios queda al final.
  compras: [
    ['519595', 'Otros (Diversos)'],
    ['519525', 'Elementos de aseo y cafetería'],
    ['519530', 'Útiles, papelería y fotocopias'],
    ['519535', 'Combustibles y lubricantes'],
    ['519540', 'Envases y empaques'],
    ['514510', 'Mantenimiento y reparaciones -- construcciones y edificaciones'],
    ['514515', 'Mantenimiento y reparaciones -- maquinaria y equipo'],
    ['inventario', 'Inventarios -- solo mercancía para reventa'],
  ],
  compras_tarjeta: [
    ['519595', 'Otros (Diversos)'],
    ['519525', 'Elementos de aseo y cafetería'],
    ['519530', 'Útiles, papelería y fotocopias'],
    ['519535', 'Combustibles y lubricantes'],
  ],
  // Grupo 5135 tal como está en el PUC. Antes había códigos que no
  // existen (513560, 513565, 513570) y 513545 aparecía como "Publicidad"
  // cuando en el PUC es "Fax y télex". El mantenimiento y las
  // reparaciones tienen su propio grupo, 5145.
  servicios: [
    ['513595', 'Servicios -- Otros'],
    ['514510', 'Mantenimiento y reparaciones -- construcciones y edificaciones'],
    ['514515', 'Mantenimiento y reparaciones -- maquinaria y equipo'],
    ['514520', 'Mantenimiento y reparaciones -- equipo de oficina'],
    ['514525', 'Mantenimiento y reparaciones -- equipo de computación y comunicación'],
    ['513505', 'Aseo y vigilancia'],
    ['513510', 'Temporales'],
    ['513515', 'Asistencia técnica'],
    ['513520', 'Procesamiento electrónico de datos'],
    ['513525', 'Acueducto y alcantarillado'],
    ['513530', 'Energía eléctrica'],
    ['513535', 'Teléfono'],
    ['513540', 'Correo, portes y telegramas'],
    ['513550', 'Transporte, fletes y acarreos'],
    ['513555', 'Gas'],
  ],
  honorarios_juridica: [
    ['511095', 'Honorarios -- Otros'],
    ['511010', 'Revisoría fiscal'],
    ['511015', 'Auditoría externa'],
    ['511025', 'Asesoría jurídica'],
    ['511030', 'Asesoría financiera'],
    ['511035', 'Asesoría técnica'],
  ],
  honorarios_natural: [
    ['511095', 'Honorarios -- Otros'],
    ['511025', 'Asesoría jurídica'],
    ['511030', 'Asesoría financiera'],
    ['511035', 'Asesoría técnica'],
  ],
  arrendamiento_muebles: [
    ['512015', 'Maquinaria y equipo'],
    ['512020', 'Equipo de oficina'],
    ['512025', 'Equipo de computación y comunicación'],
    ['512040', 'Flota y equipo de transporte'],
    ['512095', 'Otros'],
  ],
  arrendamiento_inmuebles: [
    ['512010', 'Construcciones y edificaciones'],
  ],
  transporte_carga: [
    ['513550', 'Transporte, fletes y acarreos'],
  ],
  transporte_pasajeros: [
    ['519545', 'Taxis y buses'],
    ['515520', 'Pasajes terrestres (gastos de viaje)'],
  ],
  licenciamiento_software: [
    ['513520', 'Procesamiento electrónico de datos'],
    ['513595', 'Servicios -- Otros'],
  ],
  vigilancia_aseo: [
    ['513505', 'Aseo y vigilancia'],
  ],
  servicios_temporales: [
    ['513510', 'Temporales'],
  ],
  hoteles_restaurantes: [
    ['519560', 'Casino y restaurante'],
    ['515505', 'Alojamiento y manutención (gastos de viaje)'],
  ],
  // "Otro" por definición no tiene una cuenta típica -- antes esto traía
  // un único valor fijo (519595 "Diversos") que quedaba preseleccionado
  // sin que el contador lo mirara dos veces. Ahora la lista queda vacía
  // a propósito: Escanear/Revisión detectan que no hay opciones y piden
  // escribir la cuenta a mano en vez de ofrecer un selector con un solo
  // default disfrazado de elección (ver poblarSubcuentas() en
  // escanear.html y campoSubcuentaHtml() en revision.html).
  otro: [],
  // 513528 "Servicios públicos" no existe en el PUC -- cada servicio
  // tiene su propia subcuenta dentro de 5135.
  servicios_publicos: [
    ['513530', 'Energía eléctrica'],
    ['513525', 'Acueducto y alcantarillado'],
    ['513535', 'Teléfono'],
    ['513555', 'Gas'],
    ['513505', 'Aseo y vigilancia'],
  ],
};

// Un texto corto y legible por cada categoría fiscal -- para selectores
// y listas donde hace falta mostrarle la categoría al contador (ej. el
// formulario de PUC personalizado por cliente, en cliente.html), sin
// repetir las mismas 15 claves con una etiqueta distinta cada vez que
// hace falta un selector nuevo.
const CATEGORIA_CONCEPTO_LABELS = {
  compras: 'Compras (bienes/mercancía)',
  compras_tarjeta: 'Compras con tarjeta',
  servicios: 'Servicios generales',
  honorarios_juridica: 'Honorarios (persona jurídica)',
  honorarios_natural: 'Honorarios (persona natural)',
  arrendamiento_muebles: 'Arrendamiento de muebles/equipos',
  arrendamiento_inmuebles: 'Arrendamiento de inmuebles',
  transporte_carga: 'Transporte de carga',
  transporte_pasajeros: 'Transporte de pasajeros',
  licenciamiento_software: 'Licenciamiento de software',
  vigilancia_aseo: 'Vigilancia y aseo',
  servicios_temporales: 'Servicios temporales (EST)',
  hoteles_restaurantes: 'Hoteles y restaurantes',
  servicios_publicos: 'Servicios públicos',
  otro: 'Otro',
};


// ---------- Perfil fiscal del tercero (persistido, por NIT) ----------
//
// Antes lo ÚNICO que decidía si un proveedor era Régimen Simple era lo
// que la IA leyera de ESE documento puntual (`inv.regimen_simple`) --
// si la IA se equivocaba en la lectura, o el proveedor no lo declaraba
// visible en esa factura, la retención se calculaba mal sin que nadie
// se diera cuenta. Ahora, si el contador ya marcó el perfil fiscal de
// ese NIT una vez (ficha de terceros), ESO manda -- sin importar lo
// que la lectura automática sugiera en la factura de turno.
//
// `perfilTercero` es lo que devuelve GET /api/terceros-fiscales para
// ese NIT: { gran_contribuyente, autorretenedor, regimen_simple,
// agente_retencion_iva } -- o null/undefined si el contador nunca
// marcó nada para ese NIT (en ese caso, se cae de vuelta a lo que la
// IA leyó en el documento, como antes).
// NITs que en el año ya pidieron el Art. 383 en algún documento guardado
// (ver /api/articulo-383-por-nit). Si una cuenta de cobro de ese
// proveedor lo pidió, las demás del mismo año también lo aplican, aunque
// la IA no lo detecte en cada documento (pasó con 1 de 7 de IMB).
let NITS_ARTICULO_383 = new Set();
function registrarNitsArticulo383(lista) {
  NITS_ARTICULO_383 = new Set((Array.isArray(lista) ? lista : []).map((n) => String(n).replace(/[^0-9]/g, '')));
}

function esNitPersonaJuridica(nit) {
  const digitos = String(nit == null ? '' : nit).replace(/-\s*\d$/, '').replace(/[^0-9]/g, '');
  return /^[89]\d{8}$/.test(digitos);
}

function perfilFiscalEfectivo(inv, perfilTercero) {
  const regimenSimple = !!(perfilTercero && perfilTercero.regimen_simple) ||
    inv.regimen_simple === true || inv.regimen_simple === 'true';
  // Igual que regimen_simple: si el contador ya marcó el NIT como
  // autorretenedor en la ficha de terceros, ESO manda; si no, se cae de
  // vuelta a lo que la IA leyó en el documento puntual (inv.autorretenedor
  // -- muy común verlo impreso en facturas de servicios públicos).
  const autorretenedor = !!(perfilTercero && perfilTercero.autorretenedor) ||
    inv.autorretenedor === true || inv.autorretenedor === 'true';
  // `declaranteRenta` -- a diferencia de los tres de arriba, esto NO
  // fuerza la retención a $0: solo permite usar la tarifa BAJA exacta
  // (la de declarante) en vez del rango bajo-alto, en las categorías
  // donde la tarifa depende de si el proveedor declara renta o no. Si
  // nadie lo marcó todavía, se sigue mostrando el rango como antes --
  // "no se sabe" nunca se trata como "no declara".
  // Una persona jurídica siempre declara renta: si el NIT tiene la forma
  // de una persona jurídica (9 dígitos que empiezan por 8 o 9), se usa la
  // tarifa de declarante aunque nadie lo haya marcado en la ficha. Las
  // cédulas de personas naturales no tienen esa forma (hasta 8 dígitos,
  // o 10 que empiezan por 1), así que para ellas sigue el rango.
  const declaranteRenta = !!(perfilTercero && perfilTercero.declarante_renta) || esNitPersonaJuridica(inv.nit_cc);
  // "A este proveedor no se le retiene": aprendido de la contabilidad
  // anterior del cliente o marcado por la contadora (ver
  // public/historial-contable.js). Como autorretenedor: sin retención.
  const noRetener = !!(perfilTercero && perfilTercero.no_retener);
  // Art. 383: lo marca el contador en la ficha de Terceros fiscales (a
  // partir de la certificación del contratista), o lo detecta la IA
  // cuando el propio documento lo dice -- muchas cuentas de cobro de
  // independientes traen escrito "practicar la retención con la tabla
  // del artículo 383" o la certificación de no haber contratado 2 o más
  // trabajadores (inv.solicita_articulo_383). Ver el comentario junto a
  // esta bandera en calcularRetencionCategoriaLinea() más abajo.
  const aplicaArticulo383 = !!(perfilTercero && perfilTercero.aplica_articulo_383) ||
    inv.solicita_articulo_383 === true || inv.solicita_articulo_383 === 'true' ||
    NITS_ARTICULO_383.has(String(inv.nit_cc || '').replace(/-\s*\d$/, '').replace(/[^0-9]/g, ''));
  return { regimenSimple, autorretenedor, declaranteRenta, aplicaArticulo383, noRetener };
}

// Calcula la retención en la fuente SUGERIDA (estimada -- no oficial, no
// leída del documento) para una factura, cruzando la categoría del
// concepto, si el cliente es agente retenedor, y el perfil fiscal del
// proveedor (Régimen Simple / Autorretenedor). Si la factura mezcla
// categorías (ej. productos + mano de obra en una misma factura), usa
// el desglose guardado y calcula cada parte por separado contra su
// propio umbral y tarifa, en vez de tratar todo el subtotal como una
// sola categoría.
//
// `cliente` necesita al menos `{ agente_retenedor }`.
// `tarifasAprendidas` es un objeto { "NIT|categoria": tarifaExacta } --
// si ya se confirmó la tarifa real de un proveedor antes, se usa esa en
// vez de un rango. Pasa {} (o nada) si no la tienes disponible.
// `perfilTercero` -- ver perfilFiscalEfectivo() arriba. Opcional, pasa
// null/undefined si no se cargó (se comporta como antes: solo mira
// inv.regimen_simple).
//
// Devuelve null cuando no se puede/debe calcular nada, o
// { bajo, alto, mismaTarifa } en pesos colombianos (COP).
// Pieza compartida: calcula la retención en la fuente de UNA porción con
// su propia categoría y subtotal -- una parte de un desglose agregado, o
// un ítem real de la Fase 4. Antes esta lógica vivía pegada dentro del
// bucle del desglose de calcularRetencionSugerida(); se extrajo aparte
// para que el cálculo línea por línea (calcularRetencionSugeridaPorItems,
// más abajo) use EXACTAMENTE la misma tarifa/umbral/cuenta, en vez de una
// segunda copia que se puede desincronizar.
//
// Devuelve null si la categoría no tiene tarifa confirmada en la tabla, o
// si el subtotal no supera su umbral -- en ese caso no aplica, punto.
//
// Para vigilancia_aseo y servicios_temporales (baseEspecial: 'aiu') hay un
// tercer resultado posible: si el umbral SÍ se supera (probado contra el
// bruto) pero no se recibió un valor de AIU, esta categoría SÍ requiere
// retención pero no se puede calcular el monto sin ese dato -- se
// devuelve { requiereAiu: true, subtotalBruto, aiuMinimoPresuntivo,
// cuentaPUC, nombrePUC } en vez de silenciarlo como si no aplicara (eso
// entendería el contador como "no hay que retener nada", que sería
// justo el error que este ajuste vino a corregir).
//
// Si sí hay un monto calculado: { bajo, alto, mismaTarifa, cuentaPUC,
// nombrePUC, baseUsada, aiuUsado, aiuAjustadoAlPiso } en pesos.
// `aiuUsado`/`baseUsada` solo vienen en las categorías con baseEspecial
// -- en las demás, la base ES el subtotal (mismo comportamiento de
// siempre, no hace falta reportarla aparte).
//
// `acumuladoAnualPrevio` -- SOLO tiene efecto en categorías con
// criterioTarifa:'acumulado_anual' (hoy, honorarios_natural). Es lo
// pagado a ESE proveedor en lo que va del año gravable de la factura,
// SIN incluir el subtotal de esta línea -- esta función le suma el
// subtotal actual y compara contra `umbralAcumuladoUvt` para resolver
// sola si aplica la tarifa baja o la alta, en vez de dejar el rango.
// Si no se pasa (undefined), se devuelve el rango bajo-alto tal cual,
// para que el contador decida a mano (comportamiento de respaldo si
// quien llama a esta función todavía no calculó el acumulado).
// `aiuEnLineaPropia`: la parte del AIU que la factura cobra en su PROPIA
// línea (ej. "AIU ... $290.906" debajo de "Servicio aseo ... $2.909.057").
// Esa línea ya está sumada dentro de `subtotal`, así que el piso del 10%
// se calcula sobre el resto (el servicio) -- si no, el AIU se usaría para
// subir su propio piso (10% de 3.199.963 en vez de 10% de 2.909.057) y la
// retención quedaba por encima de la que el mismo proveedor liquida.
function calcularRetencionCategoriaLinea(categoria, subtotal, nitProveedor, fechaFactura, tarifasAprendidas, aiu, declaranteRenta, acumuladoAnualPrevio, aplicaArticulo383, aiuEnLineaPropia) {
  tarifasAprendidas = tarifasAprendidas || {};
  const categoriaKey = String(categoria || '').toLowerCase();
  const configBase = TARIFAS_RETENCION[categoriaKey];
  if (!configBase) return null; // "otro" -- tarifa no confirmada, no adivinamos

  // Art. 383 ET (rentas de trabajo) y honorarios/servicios (las tarifas
  // fijas de esta tabla para 'honorarios_natural'/'servicios', art. 392)
  // son dos regímenes EXCLUYENTES -- se aplica uno u otro, nunca los dos
  // (Concepto DIAN 752 de 2023). Si el contador marcó este NIT como
  // sujeto al 383 (ficha de Terceros fiscales -- normalmente porque el
  // independiente certificó que no contrató 2+ personas para la
  // actividad por 90+ días en el año), no se sugiere la tarifa fija de
  // 4%/6%/10%/11% -- se avisa que aplica el 383 en su lugar, SIN
  // calcular su tabla progresiva (eso es una tarifa por tramos de UVT
  // bien distinta, fuera de alcance de este primer paso).
  if (aplicaArticulo383 && (categoriaKey === 'honorarios_natural' || categoriaKey === 'servicios')) {
    return { aplicaArticulo383: true, cuentaPUC: configBase.cuentaPUC, nombrePUC: configBase.nombrePUC };
  }

  const subtotalNum = Number(subtotal) || 0;
  // El umbral SIEMPRE se prueba contra el valor bruto (subtotal de la
  // línea/categoría), incluso en las categorías de base especial -- eso
  // no cambia, es solo la TARIFA la que se aplica distinto para esas dos.
  if (subtotalNum < umbralPesos(configBase, fechaFactura)) return null; // bajo el umbral, no aplica

  const aprendida = tarifasAprendidas[`${nitProveedor || ''}|${categoriaKey}`];
  const esAcumulado = configBase.criterioTarifa === 'acumulado_anual';

  let config;
  let infoAcumulado = null;
  if (aprendida !== undefined) {
    // Si ya se confirmó una tarifa exacta antes (aprendida), esa manda --
    // es más específica que cualquier otro criterio, incluido el acumulado.
    config = { tarifaBaja: aprendida, tarifaAlta: aprendida };
  } else if (esAcumulado) {
    // El atajo de "declarante" (perfilFiscalEfectivo) NO aplica aquí --
    // ver el comentario junto a honorarios_natural en TARIFAS_RETENCION.
    const acumNum = (acumuladoAnualPrevio === undefined || acumuladoAnualPrevio === null || acumuladoAnualPrevio === '')
      ? null : Number(acumuladoAnualPrevio);
    if (acumNum !== null && !isNaN(acumNum)) {
      const umbralAcum = umbralAcumuladoPesos(configBase, fechaFactura);
      const acumuladoConEstePago = acumNum + subtotalNum;
      const tarifaResuelta = acumuladoConEstePago > umbralAcum ? configBase.tarifaAlta : configBase.tarifaBaja;
      config = { tarifaBaja: tarifaResuelta, tarifaAlta: tarifaResuelta };
      infoAcumulado = {
        criterioTarifa: 'acumulado_anual',
        acumuladoAnualPrevio: acumNum,
        acumuladoConEstePago,
        umbralAcumuladoPesos: umbralAcum,
        cruzaUmbralConEstePago: acumNum <= umbralAcum && acumuladoConEstePago > umbralAcum,
      };
    } else {
      config = configBase; // no tenemos el acumulado todavía -- rango, decide el contador
    }
  } else {
    // Si no hay tarifa aprendida pero el contador SÍ marcó a este
    // proveedor como declarante de renta (ficha de terceros), se usa
    // la tarifa BAJA exacta en vez del rango bajo-alto -- ver
    // perfilFiscalEfectivo(). No aplica en categorías de acumulado.
    config = declaranteRenta ? { tarifaBaja: configBase.tarifaBaja, tarifaAlta: configBase.tarifaBaja } : configBase;
  }

  if (configBase.baseEspecial === 'aiu') {
    const aiuNum = (aiu === undefined || aiu === null || aiu === '') ? null : Number(aiu);
    const aiuLinea = Math.min(Math.max(Number(aiuEnLineaPropia) || 0, 0), subtotalNum);
    const pisoAiu = Math.round((subtotalNum - aiuLinea) * AIU_PISO_PORCENTAJE);
    if (aiuNum === null || isNaN(aiuNum)) {
      return {
        requiereAiu: true,
        subtotalBruto: subtotalNum,
        aiuMinimoPresuntivo: pisoAiu,
        cuentaPUC: configBase.cuentaPUC,
        nombrePUC: configBase.nombrePUC,
      };
    }
    const baseTarifa = Math.max(aiuNum, pisoAiu);
    return {
      bajo: Math.round(baseTarifa * config.tarifaBaja),
      alto: Math.round(baseTarifa * config.tarifaAlta),
      mismaTarifa: config.tarifaBaja === config.tarifaAlta,
      // `tarifaAplicada` -- solo tiene un valor inequívoco cuando
      // mismaTarifa es true (tarifaBaja===tarifaAlta ya resueltas a UNA
      // sola, sea por aprendida, por declarante, o por acumulado). Con
      // rango (mismaTarifa:false) esto queda en la tarifa baja, que es
      // la que ya se preseleccionaba por defecto -- no cambia nada ahí.
      tarifaAplicada: config.tarifaBaja,
      cuentaPUC: configBase.cuentaPUC,
      nombrePUC: configBase.nombrePUC,
      baseUsada: baseTarifa,
      aiuUsado: aiuNum,
      aiuAjustadoAlPiso: baseTarifa > aiuNum,
    };
  }

  return {
    bajo: Math.round(subtotalNum * config.tarifaBaja),
    alto: Math.round(subtotalNum * config.tarifaAlta),
    mismaTarifa: config.tarifaBaja === config.tarifaAlta,
    tarifaAplicada: config.tarifaBaja,
    cuentaPUC: configBase.cuentaPUC,
    nombrePUC: configBase.nombrePUC,
    ...(infoAcumulado || {}),
  };
}

// Cuánto de una categoría dada hay en UNA factura ya guardada -- mira
// primero el desglose (facturas que mezclan categorías, Fase 4) y si no
// hay desglose, cae al par categoria_concepto/valor_sin_iva de la
// cabecera. Es la MISMA precedencia que ya usa calcularRetencionSugerida()
// más abajo -- se extrajo aparte para que el acumulado anual (ver
// /api/acumulado-categoria en server.js) sume exactamente lo mismo que
// ya se le muestra al contador como retención de esa factura, en vez de
// una segunda lectura que se pueda desincronizar.
function montoCategoriaEnFactura(inv, categoria) {
  const categoriaKey = String(categoria || '').toLowerCase();
  let desglose = null;
  try {
    const raw = inv.desglose_categorias;
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
      desglose = parsed;
    }
  } catch (e) { desglose = null; }
  if (desglose) return Number(desglose[categoriaKey]) || 0;
  if (String(inv.categoria_concepto || '').toLowerCase() === categoriaKey) return Number(inv.valor_sin_iva) || 0;
  return 0;
}

// `acumulados` es opcional -- un objeto { categoria: montoAcumuladoAnualPrevio }
// con lo pagado a este proveedor en categorías de criterioTarifa:'acumulado_anual'
// ANTES de esta factura (ver /api/acumulado-categoria en server.js). Pasa
// {} o nada si no lo tienes cargado -- esas categorías simplemente
// devuelven el rango bajo-alto en vez de resolver la tarifa sola.
function calcularRetencionSugerida(inv, cliente, tarifasAprendidas, perfilTercero, acumulados){
  tarifasAprendidas = tarifasAprendidas || {};
  acumulados = acumulados || {};
  if (!cliente || !cliente.agente_retenedor) return null; // nunca le corresponde retener

  const perfil = perfilFiscalEfectivo(inv, perfilTercero);
  if (perfil.regimenSimple) return null; // Régimen Simple -- Rete Fuente no aplica
  if (perfil.autorretenedor) return null; // el proveedor se autorretiene -- el comprador no debe practicar retención ordinaria
  if (perfil.noRetener) return null; // a este proveedor no se le retiene (contabilidad anterior o decisión de la contadora)

  let desglose = null;
  try {
    const raw = inv.desglose_categorias;
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
      desglose = parsed;
    }
  } catch (e) { desglose = null; }

  // Desglose paralelo de AIU por categoría (solo relevante para
  // vigilancia_aseo/servicios_temporales) -- mismo formato que
  // `desglose`: { categoria: montoAiu }. Puede venir vacío/ausente si la
  // factura no desglosó AIU en ninguna de sus líneas.
  let desgloseAiu = {};
  try {
    const rawAiu = inv.desglose_aiu;
    const parsedAiu = typeof rawAiu === 'string' ? JSON.parse(rawAiu || '{}') : (rawAiu || {});
    if (parsedAiu && typeof parsedAiu === 'object' && !Array.isArray(parsedAiu)) desgloseAiu = parsedAiu;
  } catch (e) { desgloseAiu = {}; }

  if (desglose) {
    let bajoTotal = 0, altoTotal = 0, huboAlguno = false, mismaTarifaEnTodas = true;
    let faltaAiuEnAlguna = false;
    const categoriasFaltantesAiu = [];
    const cuentasInvolucradas = new Map(); // cuentaPUC -> nombrePUC, sin duplicados
    // Un desglose de UNA sola categoría (ej. una factura de Fase 4 con
    // todos sus ítems en la misma categoría) es el caso más común -- ahí
    // escanear.html/masivo.html sí necesitan tarifaAplicada/criterioTarifa
    // (para el selector de honorarios_natural), igual que en el camino
    // "sin desglose" de más abajo. Con MÁS de una categoría involucrada
    // no tendría sentido reportar una sola tarifa "aplicada" para el
    // conjunto, así que solo se guarda cuando hay una única `r` con
    // estos datos (nunca se sobrescribe si ya hay más de una).
    let categoriasConResultado = 0;
    let metaTarifaUnica = null;
    let huboArticulo383 = false;
    const categoriasArticulo383 = [];
    for (const [categoriaParte, montoParte] of Object.entries(desglose)) {
      const aiuLineaPropia = (desgloseAiu[CLAVE_AIU_LINEA_PROPIA] || {})[categoriaParte];
      const r = calcularRetencionCategoriaLinea(categoriaParte, montoParte, inv.nit_cc || '', inv.fecha_factura, tarifasAprendidas, desgloseAiu[categoriaParte], perfil.declaranteRenta, acumulados[categoriaParte], perfil.aplicaArticulo383, aiuLineaPropia);
      if (!r) continue; // esta parte no aplica (categoría sin tarifa, o bajo su umbral), se omite
      if (r.aplicaArticulo383) {
        huboArticulo383 = true;
        categoriasArticulo383.push(categoriaParte);
        cuentasInvolucradas.set(r.cuentaPUC, r.nombrePUC);
        continue; // no entra a bajo/alto -- el 383 no se calcula acá
      }
      categoriasConResultado++;
      if (categoriasConResultado === 1 && r.tarifaAplicada !== undefined) {
        metaTarifaUnica = {
          tarifaAplicada: r.tarifaAplicada,
          ...(r.criterioTarifa === 'acumulado_anual' ? {
            criterioTarifa: r.criterioTarifa,
            acumuladoAnualPrevio: r.acumuladoAnualPrevio,
            acumuladoConEstePago: r.acumuladoConEstePago,
            umbralAcumuladoPesos: r.umbralAcumuladoPesos,
            cruzaUmbralConEstePago: r.cruzaUmbralConEstePago,
          } : {}),
        };
      } else if (categoriasConResultado > 1) {
        metaTarifaUnica = null; // más de una categoría con monto -- no hay una sola tarifa que reportar
      }
      if (r.requiereAiu) {
        faltaAiuEnAlguna = true;
        categoriasFaltantesAiu.push({ categoria: categoriaParte, subtotalBruto: r.subtotalBruto, aiuMinimoPresuntivo: r.aiuMinimoPresuntivo });
        cuentasInvolucradas.set(r.cuentaPUC, r.nombrePUC);
        continue;
      }
      bajoTotal += r.bajo;
      altoTotal += r.alto;
      huboAlguno = true;
      if (!r.mismaTarifa) mismaTarifaEnTodas = false;
      cuentasInvolucradas.set(r.cuentaPUC, r.nombrePUC);
    }
    if (!huboAlguno && !faltaAiuEnAlguna && !huboArticulo383) return null; // ninguna de las partes superó su umbral
    return {
      bajo: bajoTotal, alto: altoTotal, mismaTarifa: mismaTarifaEnTodas,
      aplicaArticulo383: huboArticulo383,
      categoriasArticulo383,
      cuentasPUC: [...cuentasInvolucradas.entries()].map(([cuenta, nombre]) => ({ cuenta, nombre })),
      // Si esto es true, `bajo`/`alto` son un total PARCIAL -- falta el
      // AIU de las categorías en `categoriasFaltantesAiu` para completar
      // el cálculo. Nunca se debe mostrar bajo/alto como el total final
      // sin revisar este flag primero.
      requiereAiu: faltaAiuEnAlguna,
      categoriasFaltantesAiu,
      ...(metaTarifaUnica || {}),
    };
  }

  // Sin desglose -- factura de una sola categoría, comportamiento normal.
  const categoriaHeader = String(inv.categoria_concepto || '').toLowerCase();
  const r = calcularRetencionCategoriaLinea(inv.categoria_concepto, inv.valor_sin_iva, inv.nit_cc || '', inv.fecha_factura, tarifasAprendidas, inv.valor_aiu, perfil.declaranteRenta, acumulados[categoriaHeader], perfil.aplicaArticulo383);
  if (!r) return null;
  if (r.aplicaArticulo383) {
    return {
      bajo: 0, alto: 0, mismaTarifa: true,
      aplicaArticulo383: true,
      categoriasArticulo383: [inv.categoria_concepto],
      cuentasPUC: [{ cuenta: r.cuentaPUC, nombre: r.nombrePUC }],
      requiereAiu: false, categoriasFaltantesAiu: [],
    };
  }
  if (r.requiereAiu) {
    return {
      bajo: 0, alto: 0, mismaTarifa: true,
      cuentasPUC: [{ cuenta: r.cuentaPUC, nombre: r.nombrePUC }],
      requiereAiu: true,
      categoriasFaltantesAiu: [{ categoria: inv.categoria_concepto, subtotalBruto: r.subtotalBruto, aiuMinimoPresuntivo: r.aiuMinimoPresuntivo }],
    };
  }
  return {
    bajo: r.bajo, alto: r.alto, mismaTarifa: r.mismaTarifa,
    tarifaAplicada: r.tarifaAplicada,
    cuentasPUC: [{ cuenta: r.cuentaPUC, nombre: r.nombrePUC }],
    requiereAiu: false, categoriasFaltantesAiu: [],
    ...(r.criterioTarifa === 'acumulado_anual' ? {
      criterioTarifa: r.criterioTarifa,
      acumuladoAnualPrevio: r.acumuladoAnualPrevio,
      acumuladoConEstePago: r.acumuladoConEstePago,
      umbralAcumuladoPesos: r.umbralAcumuladoPesos,
      cruzaUmbralConEstePago: r.cruzaUmbralConEstePago,
    } : {}),
  };
}

// ---------- Retención sugerida LÍNEA POR LÍNEA (Fase 4) ----------
//
// A diferencia de `desglose_categorias` (un resumen agregado: "compras:
// 442000, servicios: 140000"), aquí `items` es el arreglo REAL de líneas
// de la factura (factura_items) -- cada una con su propia descripción y
// categoría. Se usa la misma pieza compartida (calcularRetencionCategoriaLinea)
// que el cálculo agregado, así que el total nunca puede quedar
// desincronizado entre ambas vistas.
//
// Devuelve null si el cliente no es agente retenedor, si no hay ítems, o
// si el proveedor está exento por su perfil fiscal (Régimen Simple /
// Autorretenedor) -- en ese último caso NO se calcula nada por línea
// (todas quedan en null), porque la exención aplica a la factura completa,
// no a una parte de ella.
//
// Si aplica, devuelve:
//   { porItem: [ {bajo,alto,mismaTarifa,cuentaPUC,nombrePUC} | {requiereAiu:true,...} | null, ... ],
//     bajo, alto, mismaTarifa, cuentasPUC, requiereAiu, itemsFaltantesAiu }
// `porItem` tiene el mismo largo y orden que `items` -- porItem[i] es el
// resultado (o null) para items[i], para poder mostrar el estimado al
// lado de cada línea en la interfaz. Un ítem de vigilancia_aseo o
// servicios_temporales sin `item.aiu` cae en `{requiereAiu:true,...}` en
// vez de en un monto -- `bajo`/`alto` del total son igual que en
// calcularRetencionSugerida: un total PARCIAL cuando `requiereAiu` es
// true, nunca el total final sin revisar ese flag primero.
// `acumulados` -- ver el mismo parámetro en calcularRetencionSugerida()
// arriba: { categoria: montoAcumuladoAnualPrevio }, lo pagado a este
// proveedor ANTES de esta factura. Si dos ítems de esta MISMA factura
// caen en una categoría de criterioTarifa:'acumulado_anual' (ej. dos
// líneas de honorarios_natural), el segundo ítem ve el acumulado previo
// MÁS el subtotal del primero -- se van sumando en el orden de `items`,
// no se les pasa a ambos el mismo acumulado previo a la factura.
function calcularRetencionSugeridaPorItems(items, inv, cliente, tarifasAprendidas, perfilTercero, acumulados) {
  if (!cliente || !cliente.agente_retenedor) return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  acumulados = acumulados || {};

  const perfil = perfilFiscalEfectivo(inv, perfilTercero);
  if (perfil.regimenSimple || perfil.autorretenedor || perfil.noRetener) {
    return { porItem: items.map(() => null), bajo: 0, alto: 0, mismaTarifa: true, cuentasPUC: [], requiereAiu: false, itemsFaltantesAiu: [] };
  }

  let bajoTotal = 0, altoTotal = 0, mismaTarifaEnTodas = true;
  const cuentasInvolucradas = new Map();
  const itemsFaltantesAiu = [];
  const itemsArticulo383 = [];
  const acumuladoCorrido = { ...acumulados }; // copia -- se va actualizando ítem a ítem, sin tocar el objeto original
  const porItem = items.map((item, idx) => {
    const categoriaKey = String(item.categoria_concepto || '').toLowerCase();
    const r = calcularRetencionCategoriaLinea(item.categoria_concepto, item.subtotal, inv.nit_cc || '', inv.fecha_factura, tarifasAprendidas, item.aiu, perfil.declaranteRenta, acumuladoCorrido[categoriaKey], perfil.aplicaArticulo383);
    if (esCategoriaCriterioAcumulado(categoriaKey)) {
      // Se suma el subtotal de ESTE ítem para el siguiente de la misma
      // categoría en esta factura, sin importar si con el dato de hoy
      // ya se pudo resolver la tarifa de este ítem o no (r.criterioTarifa
      // solo viene cuando SÍ se resolvió -- pero el acumulado corrido
      // tiene que seguir sumando de todas formas).
      acumuladoCorrido[categoriaKey] = (acumuladoCorrido[categoriaKey] || 0) + (Number(item.subtotal) || 0);
    }
    if (!r) return null;
    if (r.aplicaArticulo383) {
      itemsArticulo383.push({ idx, descripcion: item.descripcion || '' });
      cuentasInvolucradas.set(r.cuentaPUC, r.nombrePUC);
      return r;
    }
    if (r.requiereAiu) {
      itemsFaltantesAiu.push({ idx, descripcion: item.descripcion || '', subtotalBruto: r.subtotalBruto, aiuMinimoPresuntivo: r.aiuMinimoPresuntivo });
      cuentasInvolucradas.set(r.cuentaPUC, r.nombrePUC);
      return r;
    }
    bajoTotal += r.bajo;
    altoTotal += r.alto;
    if (!r.mismaTarifa) mismaTarifaEnTodas = false;
    cuentasInvolucradas.set(r.cuentaPUC, r.nombrePUC);
    return r;
  });

  return {
    porItem, bajo: bajoTotal, alto: altoTotal, mismaTarifa: mismaTarifaEnTodas,
    cuentasPUC: [...cuentasInvolucradas.entries()].map(([cuenta, nombre]) => ({ cuenta, nombre })),
    requiereAiu: itemsFaltantesAiu.length > 0, itemsFaltantesAiu,
    aplicaArticulo383: itemsArticulo383.length > 0, itemsArticulo383,
  };
}

// ---------- Subcuenta de un servicio público según el documento ----------
// Una factura de servicios públicos dice explícitamente qué servicio es
// (energía, acueducto, teléfono/celular/internet, gas, aseo). Antes todas
// caían en una sola cuenta ("513528", que no existe en el PUC); ahora se
// toma la subcuenta real del texto del documento. Sin coincidencia, se
// usa la primera de la lista y el contador la confirma.
const SUBCUENTA_POR_SERVICIO = [
  [/tel[eé]fono|telefon[ií]a|celular|m[oó]vil|internet|datos|comcel|claro|movistar|tigo|wom\b|\bune\b|etb/i, '513535'],
  [/energ[ií]a|el[eé]ctric|\bluz\b|kwh|enel|codensa|celsia|electrohuila|essa\b|chec\b/i, '513530'],
  [/acueducto|alcantarillado|\bagua\b|m3|m³/i, '513525'],
  [/\bgas\b|vanti|gases de/i, '513555'],
  [/\baseo\b|recolecci[oó]n|basuras|residuos/i, '513505'],
];
function subcuentaServicioPublico(texto) {
  const t = String(texto || '');
  const encontrada = SUBCUENTA_POR_SERVICIO.find(([patron]) => patron.test(t));
  return encontrada ? encontrada[1] : '';
}

// ---------- Subcuenta sugerida por el texto del ítem ----------
// Sin historial con un proveedor, la subcuenta preseleccionada era
// siempre la primera de la lista (casi siempre "Otros"). Estas palabras,
// tomadas de la descripción del ítem, proponen la subcuenta precisa
// (probado con las facturas reales del Conjunto Bosques de la Macarena:
// reparaciones, mantenimiento de bombas, productos de aseo...). Es solo
// la preselección: el contador la confirma o la cambia, y desde ese
// momento manda lo aprendido para ese proveedor.
const SUBCUENTA_POR_TEXTO = {
  servicios: [
    [/procesamiento|software|licencia|facturaci[oó]n electr[oó]nica|hosting|nube|plataforma/i, '513520'],
    [/transporte|flete|acarreo|mensajer[ií]a/i, '513550'],
    [/(mantenimiento|reparaci[oó]n|arreglo|revisi[oó]n|precarga|instalaci[oó]n).*(bomba|motobomba|hidroflo|motor|equipo|planta|ascensor|m[aá]quina|tablero)|(bomba|motobomba|hidroflo|motor|ascensor|planta el[eé]ctrica)/i, '514515'],
    [/reparaci[oó]n|arreglo|mantenimiento|pintura|plomer[ií]a|impermeabiliz|pasamanos|puerta|reja|fachada|techo|ducto|shut|resane|enchape|soldadura/i, '514510'],
    [/asesor[ií]a|consultor[ií]a|asistencia t[eé]cnica/i, '513515'],
  ],
  compras: [
    [/aseo|detergente|jab[oó]n|limpia|desinfect|cloro|escoba|trapero|bolsa|ambientador|papel higi[eé]nico|toalla|guante|esponja|alguicida|piscina|cafeter[ií]a|caf[eé]\b|az[uú]car|vaso/i, '519525'],
    [/papeler[ií]a|resma|fotocopia|t[oó]ner|cartucho|lapicer|carpeta|sobre\b|cuaderno|impresi[oó]n/i, '519530'],
    [/gasolina|combustible|acpm|di[eé]sel|lubricante|aceite de motor/i, '519535'],
    [/bombillo|l[aá]mpara|led\b|cable|tubo|tuber[ií]a|ferreter|tornillo|pintura|cemento|repuesto|llave\b|niple|codo|grifer|chapa|cerradura|bisagra|teflon|pvc|soldadura/i, '514510'],
  ],
};
function subcuentaPorTexto(categoria, texto) {
  const reglas = SUBCUENTA_POR_TEXTO[String(categoria || '').toLowerCase()];
  if (!reglas) return '';
  const t = String(texto || '');
  const encontrada = reglas.find(([patron]) => patron.test(t));
  return encontrada ? encontrada[1] : '';
}

// Subcuenta preseleccionada para un ítem o una factura, en orden:
// lo aprendido con ese proveedor, el servicio público que dice el
// documento, las palabras del texto, y si nada aplica, '' (la pantalla
// usa la primera opción de la lista).
function subcuentaSugerida(nit, categoria, texto, clienteId) {
  return subcuentaAprendida(nit, categoria, clienteId, texto)
    || (categoria === 'servicios_publicos' ? subcuentaServicioPublico(texto) : '')
    || subcuentaPorTexto(categoria, texto);
}

// ---------- Subcuenta aprendida por proveedor ----------
// La última subcuenta de gasto que el contador usó con un proveedor en
// una categoría (facturas de egreso aprobadas). Se usa como subcuenta
// preseleccionada para sus próximas facturas, antes que la primera
// opción de la lista general. Las pantallas la cargan desde
// /api/subcuentas-aprendidas y la registran aquí.
let SUBCUENTAS_APRENDIDAS = {};
function registrarSubcuentasAprendidas(mapa) {
  SUBCUENTAS_APRENDIDAS = mapa && typeof mapa === 'object' ? mapa : {};
}
// Historial por proveedor y concepto (GET /api/subcuentas-historial): las
// subcuentas que se usaron con cada proveedor, con las descripciones de lo
// que se causó en cada una. Clave "clienteId|NIT|categoria" y "NIT|categoria".
let HISTORIAL_SUBCUENTAS = {};
// Palabras que no dicen qué se compró (preposiciones, colores, tamaños).
const RAICES_COMUNES_HISTORIAL = new Set(['PARA', 'CON', 'POR', 'LOS', 'LAS', 'DEL', 'UNID', 'COLO', 'TAMA', 'GRAN', 'PEQU',
  'BLAN', 'NEGR', 'ROJA', 'ROJO', 'VERD', 'AZUL', 'AMAR', 'GRIS', 'MEDI', 'NUEV', 'SERV', 'PAGO', 'MENS']);
function raicesHistorial(texto) {
  return new Set(String(texto || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((p) => p.length >= 4).map((p) => p.slice(0, 5))
    .filter((p) => !RAICES_COMUNES_HISTORIAL.has(p.slice(0, 4))));
}
function registrarHistorialSubcuentas(filas) {
  HISTORIAL_SUBCUENTAS = {};
  (Array.isArray(filas) ? filas : []).forEach((f) => {
    const clave = `${String(f.nit || '').replace(/[^0-9]/g, '')}|${String(f.categoria || '').toLowerCase()}`;
    const entrada = { subcuenta: String(f.subcuenta || ''), raices: raicesHistorial(f.textos), veces: Number(f.veces) || 0, ultima: f.ultima ? new Date(f.ultima).getTime() : 0 };
    if (!entrada.subcuenta) return;
    // También por concepto en TODO el cliente, sin importar el proveedor
    // ("${cliente}|*|categoria"): en Bosques los bombillos van a 51451011
    // y los parqueaderos a 519565, venga de quien venga la factura.
    const claveCliente = f.cliente_id ? `${f.cliente_id}|*|${String(f.categoria || '').toLowerCase()}` : null;
    for (const k of [f.cliente_id ? `${f.cliente_id}|${clave}` : null, clave, claveCliente]) {
      if (!k) continue;
      const lista = HISTORIAL_SUBCUENTAS[k] = HISTORIAL_SUBCUENTAS[k] || [];
      const existente = lista.find((e) => e.subcuenta === entrada.subcuenta);
      if (existente) {
        entrada.raices.forEach((r) => existente.raices.add(r));
        existente.veces += entrada.veces;
        existente.ultima = Math.max(existente.ultima, entrada.ultima);
      } else {
        lista.push({ ...entrada, raices: new Set(entrada.raices) });
      }
    }
  });
}

// Entre varias cuentas usadas con el mismo proveedor, la que más se
// parece al texto del ítem (palabras en común con lo que se causó antes
// en cada cuenta; las palabras que aparecen en TODAS no distinguen nada).
// '' si no hay varias cuentas o ninguna se parece.
function subcuentaPorHistorial(lista, texto, minimoCuentas = 2, minimoPalabras = 1) {
  if (!Array.isArray(lista) || lista.length < minimoCuentas || !texto) return '';
  const delTexto = raicesHistorial(texto);
  const enTodas = new Set([...lista[0].raices].filter((r) => lista.every((e) => e.raices.has(r))));
  let mejor = null, mejorPuntaje = 0;
  for (const e of lista) {
    let puntaje = 0;
    delTexto.forEach((r) => { if (!enTodas.has(r) && e.raices.has(r)) puntaje++; });
    if (puntaje > mejorPuntaje || (puntaje === mejorPuntaje && puntaje > 0 && mejor && (e.veces > mejor.veces || (e.veces === mejor.veces && e.ultima > mejor.ultima)))) {
      mejor = e; mejorPuntaje = puntaje;
    }
  }
  return mejorPuntaje >= minimoPalabras ? mejor.subcuenta : '';
}

// Con `clienteId`, primero lo aprendido con ESE cliente (clave
// "clienteId|NIT|categoria"): con planes de cuentas propios, el auxiliar
// que se usó para otro cliente puede no existir en el de este. Con
// `texto` (descripción del ítem), si con ese proveedor se usaron varias
// cuentas, se escoge por concepto (ver subcuentaPorHistorial); si no, la
// última usada.
// Junta las listas del historial de varias claves (la de la categoría y
// la '*' de la contabilidad importada), sumando las entradas de la misma
// subcuenta.
function unirHistorial(...listas) {
  const porCuenta = new Map();
  listas.filter(Array.isArray).forEach((lista) => lista.forEach((e) => {
    const previa = porCuenta.get(e.subcuenta);
    if (!previa) porCuenta.set(e.subcuenta, { ...e, raices: new Set(e.raices) });
    else { e.raices.forEach((r) => previa.raices.add(r)); previa.veces += e.veces; previa.ultima = Math.max(previa.ultima, e.ultima); }
  }));
  return [...porCuenta.values()];
}

function subcuentaAprendida(nit, categoria, clienteId, texto) {
  const nitLimpio = String(nit == null ? '' : nit).replace(/-\s*\d$/, '').replace(/[^0-9]/g, '');
  if (!nitLimpio || !categoria) return '';
  const cat = String(categoria).toLowerCase();
  const clave = `${nitLimpio}|${cat}`;
  // Cuentas usadas con este proveedor: en facturas de Enlaza (por
  // categoría) y en la contabilidad anterior importada ('*').
  const delProveedorLista = clienteId
    ? unirHistorial(HISTORIAL_SUBCUENTAS[`${clienteId}|${clave}`], HISTORIAL_SUBCUENTAS[`${clienteId}|${nitLimpio}|*`])
    : unirHistorial(HISTORIAL_SUBCUENTAS[clave]);
  const porConcepto = subcuentaPorHistorial(delProveedorLista, texto);
  if (porConcepto) return porConcepto;
  const delProveedor = (clienteId && SUBCUENTAS_APRENDIDAS[`${clienteId}|${clave}`]) || SUBCUENTAS_APRENDIDAS[clave] || '';
  if (delProveedor) return delProveedor;
  // Con este proveedor siempre se usó la misma cuenta (contabilidad
  // importada): esa, si hay historia suficiente (3+ veces) o el concepto se
  // parece. Con poca historia y otro concepto (a la administradora solo se
  // le había pagado un transporte; su cobro de administración no va ahí),
  // mejor que decida el copiloto de cuentas.
  if (delProveedorLista.length === 1) {
    const unica = delProveedorLista[0];
    const delTexto = raicesHistorial(texto);
    if (unica.veces >= 3 || !texto || [...delTexto].some((r) => unica.raices.has(r))) return unica.subcuenta;
  }
  // Proveedor nuevo para este cliente: lo que el cliente ya causó con un
  // concepto parecido, de cualquier proveedor -- con al menos 2 palabras
  // en común (con una sola, "silla BLANCA" caía en "copia BLANCO y negro");
  // si no alcanza, decide el copiloto de cuentas (/copiloto-cuentas.js).
  return clienteId
    ? subcuentaPorHistorial(unirHistorial(HISTORIAL_SUBCUENTAS[`${clienteId}|*|${cat}`], HISTORIAL_SUBCUENTAS[`${clienteId}|*|*`]), texto, 1, 2)
    : '';
}

// ---------- AIU consolidado (vigilancia, aseo, temporales) ----------
//
// La retención de estos servicios es el 2%/1% sobre el AIU, no sobre el
// total. Probado con facturas reales de Coraza Seguridad (oct. 2026), la
// lectura fallaba de tres formas, y esta función corrige las tres:
//
// 1. AIU imposible: la IA a veces llena el AIU de una línea con casi
//    todo su valor. Un AIU real es una fracción pequeña (piso legal 10%);
//    si supera el 50% de la línea, se descarta.
// 2. Línea "AIU" informativa: algunas facturas listan el AIU como una
//    línea aparte aunque YA está incluido en los servicios. Si la suma de
//    ítems sin esa línea da el subtotal de la factura, la línea se quita
//    de los ítems (si no, se contaría dos veces) y su valor queda como el
//    AIU de esa categoría. Si la línea SÍ es parte del subtotal, se deja
//    (autoCompletarAiuDesdeDescripcion ya la marca como AIU).
// 3. AIU deducible del IVA: en estos servicios el IVA se cobra solo sobre
//    el AIU (Art. 462-1 ET). Si nadie trajo el AIU, la factura es de una
//    sola categoría con base AIU y el IVA es claramente menor al 19% del
//    subtotal, el AIU = IVA / 19%. Queda marcado con aiu_origen = 'iva'
//    para que la pantalla lo pueda explicar.
//
// Muta y devuelve el arreglo de ítems. Nunca pisa un AIU que el contador
// ya escribió (se llama solo al normalizar lo que leyó la IA).
const ES_LINEA_AIU = /\baiu\b|administraci[oó]n[\s,]+imprevistos|imprevistos[\s,y]+utilidad/i;
const IVA_GENERAL = 0.19;

function consolidarAiuEnItems(items, data) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const datos = data || {};

  // 0) La línea que ES el AIU pertenece al servicio de vigilancia/aseo de
  //    la misma factura, aunque la IA la haya clasificado como
  //    "servicios" (pasó con Coraza: se le cobraba 4% de servicios).
  //    Y si hay una línea explícita de AIU, ella es el AIU completo: los
  //    AIU que la IA puso dentro de las otras líneas se descartan para no
  //    contarlo dos veces.
  const categoriaAiu = (items.find((it) => esCategoriaBaseAiu(it.categoria_concepto) && !ES_LINEA_AIU.test(String(it.descripcion || ''))) || {}).categoria_concepto
    || (esCategoriaBaseAiu(datos.categoria_concepto) ? String(datos.categoria_concepto).toLowerCase() : '');
  if (categoriaAiu) {
    const hermano = items.find((it) => it.categoria_concepto === categoriaAiu && !ES_LINEA_AIU.test(String(it.descripcion || '')));
    let hayLineaAiu = false;
    items.forEach((it) => {
      if (!ES_LINEA_AIU.test(String(it.descripcion || ''))) return;
      hayLineaAiu = true;
      if (it.categoria_concepto !== categoriaAiu) {
        it.categoria_concepto = categoriaAiu;
        if (hermano && hermano.subcuenta_gasto) it.subcuenta_gasto = hermano.subcuenta_gasto;
        const config = TARIFAS_RETENCION[categoriaAiu];
        if (config) it.tarifa_retencion = config.tarifaBaja;
        it.aiu = '';
      }
    });
    if (hayLineaAiu) {
      items.forEach((it) => {
        if (it.categoria_concepto === categoriaAiu && !ES_LINEA_AIU.test(String(it.descripcion || ''))) it.aiu = '';
      });
      autoCompletarAiuDesdeDescripcion(items);
    }
  }

  // 1) AIU imposible
  items.forEach((it) => {
    if (!esCategoriaBaseAiu(it.categoria_concepto) || ES_LINEA_AIU.test(String(it.descripcion || ''))) return;
    const aiu = Number(it.aiu);
    const subtotal = Number(it.subtotal) || 0;
    if (it.aiu !== '' && it.aiu !== undefined && aiu > subtotal * 0.5) it.aiu = '';
  });

  // 2) Línea "AIU" informativa (ya incluida en los servicios)
  const subtotalFactura = Number(datos.valor_sin_iva) || 0;
  if (subtotalFactura > 0) {
    const sumaItems = items.reduce((t, it) => t + (Number(it.subtotal) || 0), 0);
    const tolerancia = Math.max(2, subtotalFactura * 0.005);
    for (let i = items.length - 1; i >= 0; i--) {
      const linea = items[i];
      if (!esCategoriaBaseAiu(linea.categoria_concepto) || !ES_LINEA_AIU.test(String(linea.descripcion || ''))) continue;
      const valorLinea = Number(linea.subtotal) || 0;
      if (valorLinea <= 0 || Math.abs(sumaItems - valorLinea - subtotalFactura) > tolerancia) continue;
      const destino = items.find((it, j) => j !== i && it.categoria_concepto === linea.categoria_concepto);
      if (!destino) continue;
      items.splice(i, 1);
      if (destino.aiu === '' || destino.aiu === undefined || destino.aiu === null) {
        destino.aiu = String(valorLinea);
        destino.aiu_origen = 'linea_aiu';
      }
    }
  }

  // 3) AIU deducido del IVA
  const ivaFactura = Number(datos.valor_iva) || 0;
  const categorias = [...new Set(items.map((it) => String(it.categoria_concepto || '')))];
  const sinAiu = items.every((it) => it.aiu === '' || it.aiu === undefined || it.aiu === null);
  if (categorias.length === 1 && esCategoriaBaseAiu(categorias[0]) && sinAiu && ivaFactura > 0 && subtotalFactura > 0 &&
      ivaFactura < subtotalFactura * IVA_GENERAL * 0.5) {
    items[0].aiu = String(Math.round(ivaFactura / IVA_GENERAL));
    items[0].aiu_origen = 'iva';
  }
  return items;
}

// ---------- Normalización de ítems leídos por la IA (Fase 4) ----------
//
// La IA devuelve `items` como un arreglo crudo (a veces como texto JSON
// en vez de un arreglo real) -- esta función lo deja siempre en la misma
// forma interna que usa la interfaz de edición línea por línea, tanto en
// Escanear como en Carga masiva, con un default sensato de subcuenta PUC
// por categoría (misma tabla SUBCUENTAS_GASTO de arriba). Es la ÚNICA
// función que arma esta forma -- así ambas pantallas leen y editan
// ítems con exactamente la misma estructura.
//
// Si el documento no trae una tabla de ítems detallada (ej. una cuenta
// de cobro con un solo concepto global), arma UN ítem único con el total
// de la factura, usando lo mismo que ya se extrajo a nivel de factura.
//
// `categoriasValidas` es opcional -- un arreglo de claves válidas (ej.
// las mismas del <select> de categoría de esa pantalla). Si se pasa y la
// categoría que trajo la IA no está en la lista, el ítem cae a 'otro' en
// vez de quedar con un valor que ningún <select> podría mostrar.
function normalizarItemsDesdeIA(data, categoriasValidas) {
  let raw = data.items;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw || '[]'); } catch (e) { raw = []; }
  }
  const subcuentaPorDefecto = (categoria, textoItem) => {
    // Servicios públicos con un ítem por servicio (acueducto, energía...):
    // manda el servicio de ESTA línea, antes que lo aprendido con el
    // proveedor (que es una sola cuenta para toda la factura).
    if (categoria === 'servicios_publicos' && textoItem) {
      const porServicio = subcuentaServicioPublico(textoItem);
      if (porServicio) return porServicio;
    }
    // Con este proveedor ya se usaron varias cuentas: la que corresponde
    // al concepto de ESTA línea (sin el nombre del proveedor, que no dice
    // nada de qué se compró).
    const porConcepto = textoItem ? subcuentaAprendida(data.nit_cc, categoria, null, textoItem) : '';
    if (porConcepto) return porConcepto;
    const sugerida = subcuentaSugerida(data.nit_cc, categoria, `${data.nombre_razon_social || ''} ${textoItem || data.concepto || ''}`);
    if (sugerida) return sugerida;
    const opciones = SUBCUENTAS_GASTO[categoria] || SUBCUENTAS_GASTO['otro'];
    // 'otro' (y cualquier categoría sin subcuentas típicas) ya no tiene
    // un default que adivinar -- queda en blanco y el selector de la
    // pantalla (Escanear/Carga masiva/Revisión) pide escribirla a mano.
    return (opciones && opciones.length > 0) ? opciones[0][0] : '';
  };
  // Tarifa de retención recomendada por defecto para esta categoría --
  // la tarifa baja (declarante), o 0 ("Ninguno") si la categoría no
  // tiene tarifa confirmada. Es solo el punto de partida que se muestra
  // en el selector de la tabla de ítems -- el contador la puede cambiar
  // línea por línea (ver renderSelectorTarifaFuente / tarifaFuenteOpciones).
  const tarifaPorDefecto = (categoria) => {
    const config = TARIFAS_RETENCION[categoria];
    return config ? config.tarifaBaja : 0;
  };
  const validarCategoria = (categoria) => {
    const cat = categoria || 'otro';
    if (!categoriasValidas) return cat;
    return categoriasValidas.includes(cat) ? cat : 'otro';
  };

  if (!Array.isArray(raw) || raw.length === 0) {
    const categoria = validarCategoria((data.categoria_concepto || 'otro').toLowerCase());
    return consolidarAiuEnItems(autoCompletarAiuDesdeDescripcion([{
      descripcion: data.concepto || '',
      cantidad: '', valor_unitario: '',
      subtotal: String(data.valor_sin_iva ?? '0'),
      categoria_concepto: categoria,
      subcuenta_gasto: subcuentaPorDefecto(categoria, data.concepto),
      tarifa_retencion: tarifaPorDefecto(categoria),
      iva_mayor_valor: false,
      // AIU (Administración+Imprevistos+Utilidad) -- solo tiene sentido
      // para vigilancia_aseo/servicios_temporales (ver esCategoriaBaseAiu
      // en la tabla de arriba); en cualquier otra categoría este campo
      // simplemente no se usa. Vacío = "no se sabe todavía", nunca 0 a
      // propósito (0 sí sería un valor real, aunque poco común).
      aiu: data.valor_aiu !== undefined && data.valor_aiu !== null && data.valor_aiu !== '' ? String(data.valor_aiu) : '',
    }]), data);
  }
  return consolidarAiuEnItems(autoCompletarAiuDesdeDescripcion(raw.map((it) => {
    const categoria = validarCategoria(String(it.categoria_concepto || 'otro').toLowerCase());
    return {
      descripcion: it.descripcion || '',
      cantidad: it.cantidad !== undefined && it.cantidad !== null ? String(it.cantidad) : '',
      valor_unitario: it.valor_unitario !== undefined && it.valor_unitario !== null ? String(it.valor_unitario) : '',
      subtotal: it.subtotal !== undefined && it.subtotal !== null ? String(it.subtotal) : '0',
      categoria_concepto: categoria,
      subcuenta_gasto: subcuentaPorDefecto(categoria, it.descripcion),
      tarifa_retencion: tarifaPorDefecto(categoria),
      iva_mayor_valor: false,
      aiu: it.aiu !== undefined && it.aiu !== null && it.aiu !== '' ? String(it.aiu) : '',
    };
  })), data);
}

// Opciones de tarifa (%) seleccionables para UNA categoría, para el
// selector por ítem -- siempre incluye "Ninguno" primero. A diferencia
// de renderSelectorTarifaFuente() (que arma el selector completo a
// nivel de toda la factura, con el peso ya calculado y el flag
// "tocado"), esto es solo la lista de opciones -- lo usa la tabla de
// ítems para que cada línea pueda tener su propia tarifa marcada,
// aparte de la que se usa para toda la factura.
function tarifaFuenteOpciones(categoria){
  const config = TARIFAS_RETENCION[String(categoria || '').toLowerCase()];
  const opciones = [{ valor: 0, label: 'Ninguno' }];
  if (!config) return opciones;
  const esAcumulado = config.criterioTarifa === 'acumulado_anual';
  // El paréntesis depende del criterio real de la categoría -- ver el
  // mismo comentario en renderSelectorTarifaFuente() más abajo:
  // honorarios_natural se decide por el acumulado de pagos del año
  // (Decreto 1625/2016 art. 1.2.4.3.1), no por declarante/no declarante.
  // Esta función es la que arma el selector por ÍTEM (tabla de la Fase
  // 4, Escanear y Carga masiva) -- no conoce el acumulado real de ese
  // proveedor (eso requiere una consulta al servidor), así que aquí solo
  // se corrige el texto para no inducir al contador a elegir con el
  // criterio equivocado; el selector de la ficha completa (que si tiene
  // acceso al acumulado real) es el que puede resolver la tarifa sola.
  opciones.push({
    valor: config.tarifaBaja,
    label: formatearPorcentajeTarifa(config.tarifaBaja) + (config.tarifaBaja !== config.tarifaAlta
      ? (esAcumulado ? ' (pagos del año a este proveedor ≤ 3.300 UVT)' : ' (declarante)')
      : ''),
  });
  if (config.tarifaAlta !== config.tarifaBaja) {
    opciones.push({
      valor: config.tarifaAlta,
      label: formatearPorcentajeTarifa(config.tarifaAlta) + (esAcumulado ? ' (pagos del año a este proveedor > 3.300 UVT)' : ' (no declarante)'),
    });
  }
  return opciones;
}

// Ítems ya editados -> listos para mandar en el POST /api/invoices, con
// el IVA de cada línea prorrateado a partir del IVA total de la factura
// según la participación de cada ítem en el subtotal. Mismo cálculo en
// Escanear y en Carga masiva -- de ahí que viva aquí y no en cada página.
function itemsParaGuardar(items, ivaTotalFactura) {
  const lista = items || [];
  const totalSubtotalItems = lista.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
  const ivaHeader = Number(ivaTotalFactura) || 0;
  let acumulado = 0;
  return lista.map((it, idx) => {
    const esUltimo = idx === lista.length - 1;
    const subtotal = Number(it.subtotal) || 0;
    let ivaProrrateado;
    if (totalSubtotalItems <= 0) {
      ivaProrrateado = 0;
    } else if (esUltimo) {
      // El último ítem se lleva lo que falte para cuadrar EXACTO contra
      // el IVA de cabecera, en vez de dejar 1-2 pesos de diferencia por
      // redondear cada línea aparte.
      ivaProrrateado = ivaHeader - acumulado;
    } else {
      ivaProrrateado = Math.round(ivaHeader * subtotal / totalSubtotalItems);
      acumulado += ivaProrrateado;
    }
    return { ...it, valor_iva: String(ivaProrrateado) };
  });
}

// Agrupa un arreglo de ítems (Fase 4) en el mismo formato de
// `desglose_categorias` que ya usa el resto de la app -- { categoria:
// sumaDeSubtotales }. Así, apenas el contador edita los ítems línea por
// línea, el desglose agregado (y por lo tanto calcularRetencionSugerida,
// el Excel de Facturas, etc.) queda SIEMPRE derivado de los ítems reales,
// nunca de una copia separada que se pueda desactualizar.
function desgloseDesdeItems(items) {
  const desglose = {};
  (items || []).forEach((item) => {
    const categoria = String(item.categoria_concepto || '').toLowerCase();
    const subtotal = Number(item.subtotal) || 0;
    if (!categoria || subtotal === 0) return;
    desglose[categoria] = (desglose[categoria] || 0) + subtotal;
  });
  return desglose;
}

// Mismo agrupamiento que desgloseDesdeItems(), pero sumando `item.aiu` en
// vez de `item.subtotal` -- alimenta `inv.desglose_aiu` que usa
// calcularRetencionSugerida() para las categorías de base especial
// (vigilancia_aseo/servicios_temporales). Solo suma categorías que SÍ
// declararon un AIU en al menos un ítem -- una categoría ausente aquí no
// significa AIU=0, significa "no se sabe", y calcularRetencionCategoriaLinea
// ya distingue eso (devuelve requiereAiu:true en vez de asumir $0).
// Dentro del mismo objeto se marca, aparte, qué parte del AIU de cada
// categoría vino en su PROPIA línea (descripción "AIU..." y todo su
// subtotal es AIU) -- ver `aiuEnLineaPropia` en
// calcularRetencionCategoriaLinea(). Va en una clave propia para no
// cambiar la forma { categoria: monto } que ya leen las pantallas y la
// base de datos.
const CLAVE_AIU_LINEA_PROPIA = '_aiu_en_linea_propia';
function desgloseAiuDesdeItems(items) {
  const desglose = {};
  const lineaPropia = {};
  (items || []).forEach((item) => {
    const categoria = String(item.categoria_concepto || '').toLowerCase();
    if (!categoria || item.aiu === undefined || item.aiu === null || item.aiu === '') return;
    const aiu = Number(item.aiu) || 0;
    desglose[categoria] = (desglose[categoria] || 0) + aiu;
    if (aiu > 0 && aiu === (Number(item.subtotal) || 0) && ES_LINEA_AIU.test(String(item.descripcion || ''))) {
      lineaPropia[categoria] = (lineaPropia[categoria] || 0) + aiu;
    }
  });
  if (Object.keys(lineaPropia).length > 0) desglose[CLAVE_AIU_LINEA_PROPIA] = lineaPropia;
  return desglose;
}

// ---------- Retención de IVA (ReteIVA) ----------
//
// Es un cálculo aparte de la retención en la fuente de arriba -- no
// depende de la categoría del concepto, se aplica sobre el valor del
// IVA de la factura (no sobre el subtotal). Tarifa general vigente:
// 15% del IVA (Art. 437-1 del Estatuto Tributario) -- el Gobierno
// puede fijarla hasta 50%, y hay casos especiales al 100% (servicios
// de no residentes, chatarra) que esta función no cubre, por ser
// casos poco comunes para un contador independiente.
//
// Usa el mismo umbral de la categoría (2 UVT servicios, 10 UVT
// compras, etc.) aplicado sobre el SUBTOTAL -- es la misma cuantía
// mínima que la retención en la fuente normal, según la tabla DIAN.
const RETEIVA_TARIFA_GENERAL = 0.15;

// Calcula el ReteIVA sugerido para una factura -- devuelve el monto
// en pesos, o null si no aplica (cliente no es agente retenedor, no
// hay IVA, el subtotal no supera el umbral de su categoría, o el
// proveedor está exento por su propia calidad tributaria -- ver abajo).
//
// OJO -- a propósito NO se exime aquí por Régimen Simple ni por
// Autorretenedor: esos dos solo eximen de Rete Fuente (renta) y de
// ICA -- un proveedor de Régimen Simple responsable de IVA SÍ puede
// tener ReteIVA practicado sobre sus ventas (verificado: la exención
// del RST aplica a renta e ICA, no a IVA). Mezclar esa regla aquí
// sería inventar una exención que la norma no da -- por eso
// `calcularRetencionSugerida()` sí revisa el perfil fiscal y esta
// función no.
//
// Exención que SÍ aplica aquí -- "entre agentes de retención de IVA no
// se practica retención" (doctrina DIAN, resumida en Gerencie.com y
// Actualícese sobre Art. 437-2 E.T.): si el proveedor mismo ya es un
// agente de retención de IVA designado, o es Gran Contribuyente, tu
// cliente no debe retenerle -- sin importar si tu cliente también es
// Gran Contribuyente o no, en NINGUNA combinación de las que reporta la
// norma le corresponde retención cuando el VENDEDOR tiene esa calidad.
// (El único caso donde SÍ se retiene es el normal: comprador agente
// retenedor comprándole a un proveedor de régimen común corriente, que
// es exactamente lo que ya cubre el resto de esta función.)
// `perfilTercero` es lo mismo que recibe `calcularRetencionSugerida()`
// -- opcional, pasa null/undefined si no se cargó (se comporta como
// antes: no exime por esto, solo por lo que ya cubría).
//
// IMPORTANTE: esto NO usa `cliente.agente_retenedor` (que es el código
// 07 del RUT -- agente retenedor de RENTA). Ser agente de retención de
// IVA es una calidad distinta (art. 437-2 ET: grandes contribuyentes,
// entidades estatales, y otros designados puntualmente por la DIAN) que
// no se deriva de ninguna responsabilidad del RUT que ya se lea sola --
// por eso usa `cliente.agente_retenedor_iva`, marcado a mano en la
// ficha del cliente, igual que `agente_retenedor_ica`.
function calcularReteIvaSugerido(inv, cliente, perfilTercero){
  if (!cliente || !cliente.agente_retenedor_iva) return null;

  if (perfilTercero && (perfilTercero.agente_retencion_iva || perfilTercero.gran_contribuyente)) return null;

  const ivaValor = Number(inv.valor_iva) || 0;
  if (ivaValor <= 0) return null; // sin IVA, no hay nada que retener

  const categoria = (inv.categoria_concepto || '').toLowerCase();
  const config = TARIFAS_RETENCION[categoria];
  // Sin una categoría con umbral confiable, no adivinamos -- mismo
  // criterio que calcularRetencionSugerida().
  if (!config) return null;

  const subtotal = Number(inv.valor_sin_iva) || 0;
  if (subtotal < umbralPesos(config, inv.fecha_factura)) return null;

  return Math.round(ivaValor * RETEIVA_TARIFA_GENERAL);
}

// ---------- Retención de ICA (ReteICA) por municipio ----------
//
// A diferencia de Rete Fuente y Rete IVA (que son nacionales, con una
// tabla y una tarifa que valen para todo el país), el ICA es municipal
// -- cada municipio fija su propia tarifa (y hay más de 1.100
// municipios en Colombia), y encima la tarifa cambia según la
// actividad económica (industrial/comercial/servicios, o hasta más
// fino por CIIU). No existe una tabla nacional confiable que esta app
// pueda traer ya puesta sin arriesgarse a inventar un número -- por
// eso el contador arma SU PROPIA tabla de tarifas de ICA (municipio +
// actividad + tarifa + base mínima + cuenta PUC auxiliar), una vez por
// cliente/municipio que de verdad maneje, y la reusa cada vez.
//
// `tarifaIca` es UNA fila de esa tabla que el contador ya eligió para
// esta factura: { municipio, actividad, tarifa_por_mil, base_uvt,
// cuenta_puc }. Si no ha elegido ninguna (porque no la ha configurado
// todavía), esta función no calcula nada -- nunca asume un municipio
// ni una tarifa por su cuenta.
function calcularReteIcaSugerido(inv, tarifaIca, cliente){
  if (!tarifaIca) return null; // el contador no ha elegido/configurado una tarifa de ICA para este municipio todavía
  // Defensa adicional: si quien llama SÍ pasó el cliente, esta función no
  // confía ciegamente en que ya lo haya validado afuera -- si el cliente
  // no está marcado como agente retenedor de ICA, no sugiere nada. Si no
  // se pasa cliente (compatibilidad con el único caller actual, que ya
  // valida esto antes de llamar), el comportamiento no cambia.
  if (cliente && !cliente.agente_retenedor_ica) return null;

  const tarifaPorMil = Number(tarifaIca.tarifa_por_mil);
  if (!tarifaPorMil || tarifaPorMil <= 0) return null;

  const subtotal = Number(inv.valor_sin_iva) || 0;
  const baseUvt = Number(tarifaIca.base_uvt) || 0;
  const umbral = Math.round(baseUvt * valorUvt(anioDeFechaFactura(inv.fecha_factura)));
  if (subtotal < umbral) return null; // bajo la base mínima que el contador configuró para este municipio

  return {
    monto: Math.round(subtotal * (tarifaPorMil / 1000)),
    cuentaPUC: tarifaIca.cuenta_puc || CUENTAS_PUC_FIJAS.rete_ica.cuentaPUC,
    nombrePUC: tarifaIca.cuenta_puc ? `ICA retenido -- ${tarifaIca.municipio}` : CUENTAS_PUC_FIJAS.rete_ica.nombrePUC,
  };
}

// ---------- Selector de tarifa de Rete Fuente por categoría ----------
//
// Antes, cuando una factura tenía una sola categoría, lo único que se
// ofrecía era un texto "≈ rango bajo–alto" con un botón "Usar $bajo" --
// el contador nunca veía la TARIFA real (%), solo el peso ya calculado.
// Esta función arma, en su lugar, un <select> con las tarifas legales
// de esa categoría (TARIFAS_RETENCION de arriba -- las mismas que ya
// alimentan el cálculo, nunca una tabla aparte), preseleccionando la
// recomendada, para que el contador confirme o cambie la tarifa con un
// clic -- viendo el % y el PUC, no solo el peso resultante.
//
// Vive aquí (no en cada página) porque Escanear y Carga masiva deben
// mostrar exactamente el mismo criterio de recomendación -- igual
// principio que el resto de este archivo.
//
// `sugerido` es el resultado de calcularRetencionSugerida() para una
// factura de una sola categoría (no un desglose de varias). `fuenteInput`
// es el <input> real de Rete Fuente donde se aplica el valor elegido.
// `tocado` es el mismo flag "reteFuenteTocado" que ya usa cada página --
// si el contador ya vació el campo a propósito, no se le vuelve a
// rellenar solo, se preselecciona "Ninguno" en su lugar.
function formatearPorcentajeTarifa(frac){
  const pct = frac * 100;
  const texto = Number.isInteger(pct) ? String(pct) : pct.toFixed(1).replace(/\.0$/, '');
  return texto + '%';
}

function renderSelectorTarifaFuente(contenedorEl, categoria, sugerido, fuenteInput, tocado){
  if (!sugerido) return;
  const configCategoria = TARIFAS_RETENCION[String(categoria || '').toLowerCase()] || null;
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s) => String(s);
  const parseVal = (typeof parseMoneyValue === 'function') ? parseMoneyValue : (v) => Number(String(v).replace(/[^\d-]/g, '')) || 0;

  // El texto entre paréntesis depende del CRITERIO real de esa
  // categoría -- la mayoría (compras, servicios...) sí es
  // declarante/no declarante, pero honorarios_natural (criterioTarifa
  // 'acumulado_anual') se decide por el monto pagado en el año, no por
  // eso (Decreto 1625/2016 art. 1.2.4.3.1) -- mostrarle "declarante" ahí
  // sería inducir al contador a elegir con el criterio equivocado.
  const esAcumulado = configCategoria && configCategoria.criterioTarifa === 'acumulado_anual';
  const opciones = [{ valor: 0, label: 'Ninguno -- no aplica retención en este caso' }];
  if (sugerido.mismaTarifa) {
    const pctResuelto = (typeof sugerido.tarifaAplicada === 'number') ? sugerido.tarifaAplicada : (configCategoria ? configCategoria.tarifaBaja : null);
    const pct = pctResuelto !== null ? formatearPorcentajeTarifa(pctResuelto) + ' — ' : '';
    let sufijo = '';
    if (esAcumulado && sugerido.criterioTarifa === 'acumulado_anual') {
      sufijo = ` (acumulado ${sugerido.acumuladoConEstePago.toLocaleString('es-CO')} de ${sugerido.umbralAcumuladoPesos.toLocaleString('es-CO')} en el año)`;
    }
    opciones.push({ valor: sugerido.bajo, label: `${pct}$${sugerido.bajo.toLocaleString('es-CO')}${sufijo}` });
  } else if (esAcumulado) {
    // Todavía no se conoce el acumulado del año para este proveedor
    // (se está cargando en segundo plano) -- se muestra el rango con el
    // criterio correcto en vez de "declarante/no declarante".
    const pctBaja = configCategoria ? formatearPorcentajeTarifa(configCategoria.tarifaBaja) + ' ' : '';
    const pctAlta = configCategoria ? formatearPorcentajeTarifa(configCategoria.tarifaAlta) + ' ' : '';
    opciones.push({ valor: sugerido.bajo, label: `${pctBaja}(pagos del año a este proveedor ≤ 3.300 UVT) — $${sugerido.bajo.toLocaleString('es-CO')}` });
    opciones.push({ valor: sugerido.alto, label: `${pctAlta}(pagos del año a este proveedor > 3.300 UVT) — $${sugerido.alto.toLocaleString('es-CO')}` });
  } else {
    const pctBaja = configCategoria ? formatearPorcentajeTarifa(configCategoria.tarifaBaja) + ' ' : '';
    const pctAlta = configCategoria ? formatearPorcentajeTarifa(configCategoria.tarifaAlta) + ' ' : '';
    opciones.push({ valor: sugerido.bajo, label: `${pctBaja}(declarante de renta) — $${sugerido.bajo.toLocaleString('es-CO')}` });
    opciones.push({ valor: sugerido.alto, label: `${pctAlta}(no declarante / no se sabe) — $${sugerido.alto.toLocaleString('es-CO')}` });
  }

  // OJO -- "Ninguno" también vale 0, igual que un campo todavía vacío,
  // así que no basta con buscar qué opción coincide con el valor actual:
  // si el campo está en $0 y el contador nunca lo tocó, eso NO es una
  // elección deliberada de "Ninguno", es que todavía no se ha calculado
  // nada -- en ese caso se recomienda la tarifa baja y se aplica de una,
  // igual que ya hacía el flujo anterior. Solo se respeta "Ninguno" como
  // elección real cuando el campo está en $0 Y el contador ya lo había
  // tocado antes (lo vació a propósito).
  const valorActual = parseVal(fuenteInput.value);
  let coincide = null;
  if (valorActual > 0) {
    coincide = opciones.find((o) => o.valor === valorActual) || null;
    // Si no coincide con ninguna opción Y el contador nunca tocó el
    // campo a mano (`tocado`), lo más probable es que ese valor haya
    // quedado de un cálculo automático ANTERIOR con menos información
    // (ej. el acumulado anual de honorarios_natural que todavía no había
    // llegado del servidor) -- no de una elección deliberada. En ese
    // caso NO se trata como "otro valor ya escrito": se deja `coincide`
    // en null para que la rama de abajo lo actualice solo al nuevo
    // estimado, en vez de quedarse pegado a un número que ya quedó
    // desactualizado sin que el contador lo haya elegido nunca.
    if (!coincide && tocado) {
      coincide = { valor: valorActual, label: `Otro valor ya escrito — $${valorActual.toLocaleString('es-CO')}` };
      opciones.push(coincide);
    }
  } else if (tocado) {
    coincide = opciones[0]; // el contador ya lo había dejado en $0 a propósito -- respeta "Ninguno"
  }
  const recomendado = opciones[1];
  const preseleccionado = coincide ? coincide.valor : recomendado.valor;

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '4px';
  const titulo = document.createElement('div');
  titulo.className = 'fine';
  titulo.textContent = 'Tarifa de retención recomendada según la categoría (verifica antes de guardar -- no es asesoría tributaria):';
  wrap.appendChild(titulo);

  const select = document.createElement('select');
  select.className = 'tarifa-retencion-select';
  select.innerHTML = opciones.map((o) => `<option value="${o.valor}"${o.valor === preseleccionado ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  select.addEventListener('change', () => {
    const monto = Number(select.value) || 0;
    fuenteInput.value = monto.toLocaleString('es-CO');
    fuenteInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  wrap.appendChild(select);

  contenedorEl.appendChild(wrap);
  contenedorEl.classList.add('show');

  if (!coincide) {
    fuenteInput.value = preseleccionado.toLocaleString('es-CO');
  }
}

// ---------- Export para Node (server.js) ----------
//
// Este archivo se carga de dos formas: como <script> plano en el
// navegador (Escanear, Carga masiva, Facturas, Informe de auditoría --
// todo lo de arriba queda como variables/funciones globales, igual que
// siempre) y, desde este bloque, como módulo de Node vía
// require('./public/retenciones') en server.js.
//
// Antes server.js tenía su PROPIA copia a mano de las tarifas con rango
// (TARIFAS_CON_RANGO, para "recordar" qué tarifa exacta confirmó el
// contador) -- exactamente el mismo riesgo que este archivo existe para
// evitar en el navegador: si TARIFAS_RETENCION cambia aquí y esa copia
// en server.js no se actualiza también, quedan desincronizadas sin que
// nadie lo note. Ahora server.js hace require() de este archivo y usa
// esta MISMA tabla -- un solo lugar que tocar cuando cambie una tarifa.
//
// El `if` de abajo es lo que permite que el mismo archivo sirva para
// los dos mundos sin romper ninguno: en el navegador no existe la
// variable `module`, así que la condición da falso y este bloque no
// hace nada (el resto del archivo ya quedó definido como variables
// globales, que es todo lo que necesita el navegador). En Node sí
// existe `module`, así que aquí se arma el export.
//
// Solo se exportan piezas que NO tocan el DOM -- renderSelectorTarifaFuente()
// sí lo hace (document.createElement, etc.) y no tendría sentido
// llamarla desde el servidor, así que a propósito se deja afuera.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TARIFAS_RETENCION,
    AIU_PISO_PORCENTAJE,
    UVT_POR_ANIO,
    UVT_ANIO_MAS_RECIENTE,
    CUENTAS_PUC_FIJAS,
    SUBCUENTAS_GASTO,
    CATEGORIA_CONCEPTO_LABELS,
    RETEIVA_TARIFA_GENERAL,
    esCategoriaBaseAiu,
    autoCompletarAiuDesdeDescripcion,
    consolidarAiuEnItems,
    registrarSubcuentasAprendidas,
    registrarHistorialSubcuentas,
    subcuentaServicioPublico,
    subcuentaPorTexto,
    subcuentaSugerida,
    subcuentaAprendida,
    esCategoriaCriterioAcumulado,
    umbralAcumuladoPesos,
    montoCategoriaEnFactura,
    valorUvt,
    esUvtDeRespaldo,
    anioDeFechaFactura,
    umbralPesos,
    rigeTablaAnteriorAl572,
    perfilFiscalEfectivo,
    esNitPersonaJuridica,
    registrarNitsArticulo383,
    calcularRetencionCategoriaLinea,
    calcularRetencionSugerida,
    calcularRetencionSugeridaPorItems,
    normalizarItemsDesdeIA,
    tarifaFuenteOpciones,
    itemsParaGuardar,
    desgloseDesdeItems,
    desgloseAiuDesdeItems,
    calcularReteIvaSugerido,
    calcularReteIcaSugerido,
    formatearPorcentajeTarifa,
  };
}