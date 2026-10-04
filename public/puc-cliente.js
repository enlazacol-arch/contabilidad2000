'use strict';
// ---------- PUC personalizado de cada cliente ----------
//
// Cada empresa cliente lleva su propio plan de cuentas (exportado de su
// programa contable: código, nombre, nivel, si recibe movimiento, tarifa
// de las cuentas de retención...). Este módulo concentra TODA la lógica
// sobre ese plan, para que Escanear, Carga masiva, Revisión, la ficha del
// cliente y el asiento contable del servidor decidan igual:
//
// - nivelDeCodigo / motivoObsoleta: para depurar el plan (ej. el de
//   Bosques de la Macarena traía 61 cuentas de ajustes por inflación,
//   corrección monetaria y CREE, conceptos que ya no existen).
// - cuentasClienteParaCategoria: qué cuentas del cliente sirven para una
//   categoría de gasto (por el grupo del PUC, no por una marca manual).
// - elegirCuentaCliente: el auxiliar del cliente más parecido a lo que
//   se está causando (ej. "mantenimiento bomba" -> 51451501 EQUIPO DE
//   BOMBEO), a partir de la subcuenta estándar sugerida y del texto.
// - cuentaRetencionCliente / cuentaIvaGastoCliente: las cuentas del
//   cliente para la retención (según la tarifa) y para el IVA llevado al
//   gasto (clientes no responsables de IVA).
//
// Isomórfico, igual que retenciones.js: en el navegador sus funciones
// quedan globales, en el servidor se usan con require().

// Nivel del PUC por la cantidad de dígitos.
function nivelDeCodigo(codigo) {
  const n = String(codigo || '').replace(/[^0-9]/g, '').length;
  if (n <= 1) return 'clase';
  if (n === 2) return 'grupo';
  if (n <= 4) return 'cuenta';
  if (n <= 6) return 'subcuenta';
  return 'auxiliar';
}

// Cuentas de conceptos que ya no existen en la norma colombiana. Solo se
// SEÑALAN para que el contador decida; nunca se desactivan solas.
function motivoObsoleta(codigo, nombre) {
  const c = String(codigo || '').replace(/[^0-9]/g, '');
  const n = String(nombre || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/AJUS.*IN(FL|LF)|INFLACION/.test(n)) return 'Ajustes por inflación (eliminados en 2007)';
  if (c.startsWith('47') || /^C\.?M\.? /.test(n) || /CORRECCION MONETARIA/.test(n)) return 'Corrección monetaria (eliminada en 2007)';
  if (/\bCREE\b/.test(n)) return 'CREE (derogado en 2017)';
  return '';
}

// Grupos del PUC (4 dígitos) donde se busca la cuenta del cliente para
// cada categoría de gasto. El grupo equivalente de gastos de ventas (52)
// se agrega solo (5135 -> 5235, 5195 -> 5295...).
const GRUPOS_PUC_POR_CATEGORIA = {
  compras: ['5195', '5145', '5165'],
  compras_tarjeta: ['5195', '5145'],
  servicios: ['5135', '5145', '5195', '5140'],
  honorarios_juridica: ['5110'],
  honorarios_natural: ['5110'],
  arrendamiento_muebles: ['5120'],
  arrendamiento_inmuebles: ['5120'],
  transporte_carga: ['5135'],
  transporte_pasajeros: ['5195', '5155'],
  licenciamiento_software: ['5135', '5165'],
  vigilancia_aseo: ['5135'],
  servicios_temporales: ['5135'],
  hoteles_restaurantes: ['5195', '5155'],
  servicios_publicos: ['5135'],
  otro: ['51', '52', '53'],
};
function gruposDeCategoria(categoria) {
  const base = GRUPOS_PUC_POR_CATEGORIA[String(categoria || '').toLowerCase()] || GRUPOS_PUC_POR_CATEGORIA.otro;
  const ventas = base.filter((g) => g.length === 4 && g.startsWith('51')).map((g) => '52' + g.slice(2));
  return [...base, ...ventas];
}

const esCuentaDeIva = (nombre) => /^\s*IVA\b/i.test(String(nombre || ''));

// ¿Se puede usar para registrar un movimiento? Activa, que recibe
// movimiento y de nivel subcuenta o auxiliar.
function cuentaUsable(c) {
  if (!c) return false;
  if (c.activo === false || c.recibe_movimiento === false) return false;
  return String(c.codigo || '').replace(/[^0-9]/g, '').length >= 6;
}

// Cuentas del cliente que sirven para una categoría de gasto: las que el
// contador marcó a mano con esa categoría, y las del PUC importado cuyo
// grupo corresponde a la categoría (sin las cuentas "IVA ..." del gasto).
function cuentasClienteParaCategoria(pucCliente, categoria) {
  const lista = Array.isArray(pucCliente) ? pucCliente : [];
  const cat = String(categoria || '').toLowerCase();
  const grupos = gruposDeCategoria(cat);
  const vistas = new Set();
  const salida = [];
  for (const c of lista) {
    if (vistas.has(c.codigo)) continue;
    const manual = c.categoria_concepto && String(c.categoria_concepto).toLowerCase() === cat;
    const porGrupo = !c.categoria_concepto && cuentaUsable(c) && !esCuentaDeIva(c.concepto)
      && grupos.some((g) => String(c.codigo).startsWith(g));
    if ((manual && c.activo !== false) || porGrupo) { vistas.add(c.codigo); salida.push(c); }
  }
  return salida.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
}

// Raíces de palabras (4 letras, sin tildes) para comparar nombres de
// cuentas con el texto de una factura. Abreviaturas comunes en los PUC
// (MTTO, MANTMTO, MANTO...) se llevan a la misma raíz.
const ABREVIATURAS = { MTTO: 'MANT', MANTO: 'MANT', MANTTO: 'MANT', MANTMTO: 'MANT', IMPLEM: 'IMPL', SERV: 'SERV' };
const RAICES_IGNORADAS = new Set(['PARA', 'CON', 'POR', 'LOS', 'LAS', 'DEL', 'OTRO', 'OTRA', 'GAST', 'GTOS', 'GTO', 'VARI']);
function raices(texto) {
  return [...new Set(String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z ]+/g, ' ').split(/\s+/)
    .map((p) => ABREVIATURAS[p] || p)
    .filter((p) => p.length >= 4)
    .map((p) => p.slice(0, 4))
    .filter((p) => !RAICES_IGNORADAS.has(p)))];
}

// El auxiliar del cliente más adecuado para lo que se está causando.
// `codigoEstandar`: la subcuenta del PUC estándar que ya sugirió Enlaza
// (ej. 514510); `texto`: descripción del ítem + concepto + proveedor.
// Puntaje: empieza por la subcuenta estándar (+3), por su grupo (+1), y
// +2 por cada raíz de palabra en común con el nombre de la cuenta.
// Devuelve '' si ninguna cuenta del cliente tiene relación.
function elegirCuentaCliente(pucCliente, categoria, codigoEstandar, texto) {
  const candidatas = cuentasClienteParaCategoria(pucCliente, categoria);
  if (candidatas.length === 0) return '';
  const estandar = String(codigoEstandar || '').replace(/[^0-9]/g, '');
  const delTexto = raices(texto);
  let mejor = null;
  let mejorPuntaje = 0;
  for (const c of candidatas) {
    const codigo = String(c.codigo);
    let puntaje = 0;
    if (estandar && codigo.startsWith(estandar)) puntaje += 3;
    else if (estandar && codigo.startsWith(estandar.slice(0, 4))) puntaje += 1;
    const delNombre = raices(c.concepto);
    puntaje += 2 * delTexto.filter((r) => delNombre.includes(r)).length;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = c; }
  }
  // Solo estar en el mismo grupo (1 punto) no basta para escoger entre
  // varias cuentas: mejor dejar que el contador elija.
  return mejor && mejorPuntaje >= 2 ? String(mejor.codigo) : '';
}

// Cuenta de retención del cliente para una cuenta estándar (ej. 236525
// Servicios) y una tarifa (ej. 0.04). Busca, en orden:
//   1. bajo ese código, la de la misma tarifa (23652502 "RETEFTE
//      SERVICIOS 4%", con su "Porcentaje Base" o el % en el nombre);
//   2. en el mismo grupo 2365, la de esa tarifa más cercana (ej. un plan
//      con 236516 "HONORARIOS 11%" junto a 236515 "HONORARIOS 10%");
//   3. la subcuenta misma, si el cliente la usa sin auxiliares.
function cuentaRetencionCliente(pucCliente, codigoEstandar, tarifa) {
  const lista = (Array.isArray(pucCliente) ? pucCliente : []).filter(cuentaUsable);
  const base = String(codigoEstandar || '');
  if (!base) return null;
  const pct = Math.round(Number(tarifa) * 10000) / 100; // 0.04 -> 4
  const tieneTarifa = (c) => {
    if (c.porcentaje !== null && c.porcentaje !== undefined && c.porcentaje !== '' && Number(c.porcentaje) > 0) {
      return Math.abs(Number(c.porcentaje) - pct) < 0.001;
    }
    return new RegExp(`(^|[^0-9.,])${String(pct).replace('.', '[.,]')}\\s*%`).test(String(c.concepto || ''));
  };
  const bajo = lista.filter((c) => String(c.codigo).startsWith(base));
  const enBase = bajo.find(tieneTarifa);
  if (enBase) return enBase;
  const grupo = base.slice(0, 4);
  const delGrupo = lista.filter((c) => String(c.codigo).startsWith(grupo) && tieneTarifa(c)
    && !/CREE/i.test(String(c.concepto || '')));
  if (delGrupo.length > 0) {
    const distancia = (c) => Math.abs(Number(String(c.codigo).slice(0, 6)) - Number(base.slice(0, 6)));
    return delGrupo.sort((a, b) => distancia(a) - distancia(b))[0];
  }
  return bajo.length === 1 ? bajo[0] : null;
}

// Para clientes NO responsables de IVA, el IVA que pagan es más gasto.
// Muchos PUC tienen una cuenta "IVA ..." al lado de cada gasto (ej.
// 51952502 "IVA IMPLEMENTOS ASEO Y CAFETER" junto a 51952501, 513508
// "IVA VIGILANCIA" junto a 513507 "VIGILANCIA"). Se elige la del mismo
// grupo con más palabras en común con el nombre del gasto; si ninguna
// comparte palabras, solo una del mismo padre (los 6 primeros dígitos de
// un auxiliar). Si no hay, null: el IVA se suma a la cuenta del gasto.
function cuentaIvaGastoCliente(pucCliente, codigoGasto) {
  const todas = Array.isArray(pucCliente) ? pucCliente : [];
  const lista = todas.filter((c) => cuentaUsable(c) && esCuentaDeIva(c.concepto));
  const gasto = String(codigoGasto || '');
  const nombreGasto = raices(nombreCuentaCliente(todas, gasto));
  const delIva = (c) => raices(String(c.concepto).replace(/^\s*IVA\b/i, ''));
  const comunes = (c) => delIva(c).filter((r) => nombreGasto.includes(r)).length;
  // Más palabras en común primero; a igualdad, la de menos palabras de
  // sobra ("IVA VIGILANCIA" antes que "IVA ASEO Y VIGILANCIA" para
  // VIGILANCIA) y luego la de código más cercano.
  const sobrantes = (c) => delIva(c).filter((r) => !nombreGasto.includes(r)).length;
  const distancia = (c) => Math.abs(Number(String(c.codigo).padEnd(8, '0')) - Number(gasto.padEnd(8, '0')));
  const mejorDe = (grupo) => grupo.sort((a, b) => (comunes(b) - comunes(a)) || (sobrantes(a) - sobrantes(b)) || (distancia(a) - distancia(b)))[0];
  const delGrupo = lista.filter((c) => String(c.codigo).startsWith(gasto.slice(0, 4)));
  const conPalabras = delGrupo.filter((c) => comunes(c) > 0);
  if (conPalabras.length > 0) return mejorDe(conPalabras);
  // Sin palabras en común con el gasto: sirve una "IVA ..." genérica del
  // mismo padre (ej. "IVA MTTO" bajo 514510 MANTMTO CONSTRUC), nunca una
  // de otra cosa (ej. "IVA ASCENSOR" para EQUIPO DE BOMBEO).
  if (gasto.length > 6) {
    const padre = raices(nombreCuentaCliente(todas, gasto.slice(0, 6)));
    const hermanas = delGrupo.filter((c) => String(c.codigo).startsWith(gasto.slice(0, 6))
      && delIva(c).length > 0 && delIva(c).every((r) => padre.includes(r)));
    if (hermanas.length > 0) return mejorDe(hermanas);
  }
  return null;
}

// ---------- Lectura del archivo del plan de cuentas ----------

// Encabezados aceptados (sin tildes ni mayúsculas). Solo código y nombre
// son obligatorios; el resto viene en exportaciones como la de Contai
// ("Codigo, Concepto, Tipo de Cuenta, Id. Recibe Movto., ..., Porcentaje
// Base, ..., Activo").
const PUC_COLUMNAS = {
  categoria: { exactas: ['categoria_fiscal', 'categoria'], contiene: ['categoria'] },
  codigo: { exactas: ['codigo', 'cuenta', 'codigo puc'], contiene: ['codigo'] },
  concepto: { exactas: ['concepto', 'nombre', 'descripcion'], contiene: ['nombre', 'concepto', 'descripcion'] },
  recibe_movimiento: { exactas: ['recibe movimiento', 'recibe_movimiento', 'movimiento', 'id. recibe movto.', 'recibe movto.', 'recibe movto'], contiene: ['recibe'] },
  activo: { exactas: ['activo', 'activa', 'estado'], contiene: [] },
  porcentaje: { exactas: ['porcentaje', 'porcentaje base', 'tarifa', '%'], contiene: ['porcentaje', 'tarifa'] },
  tipo_cuenta: { exactas: ['tipo de cuenta', 'tipo cuenta', 'tipo_cuenta'], contiene: ['tipo de cuenta', 'tipo cuenta'] },
};

// "S", "Si", "X", "1", "true" -> true; "N", "No", "0", "false" -> false;
// vacío o desconocido -> el valor por defecto.
function leerSiNoPuc(valor, porDefecto) {
  const v = String(valor == null ? '' : valor).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['S', 'SI', 'Y', 'YES', 'X', '1', 'TRUE', 'ACTIVO', 'ACTIVA'].includes(v)) return true;
  if (['N', 'NO', '0', 'FALSE', 'INACTIVO', 'INACTIVA'].includes(v)) return false;
  return porDefecto;
}

// "4", "2.5", "2,5", "4%" -> número; 0 o vacío -> null (sin tarifa).
function leerPorcentajePuc(valor) {
  const n = Number(String(valor == null ? '' : valor).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

// De la tabla ya separada en celdas (primera fila = encabezados) a filas
// { numeroFila, categoria, codigo, concepto, recibe_movimiento, activo,
// porcentaje, tipo_cuenta }. Cada columna se busca primero por nombre
// exacto y luego por palabra contenida ("Código Cuenta", "Nombre
// Cuenta"), sin repetir una columna ya asignada.
// Devuelve { filasCrudas } o { error } si faltan código o nombre.
function filasPucDesdeTabla(filas) {
  const normalizar = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const encabezados = (filas[0] || []).map(normalizar);
  const usados = [];
  const columna = (campo) => {
    const { exactas, contiene } = PUC_COLUMNAS[campo];
    let i = encabezados.findIndex((h, pos) => !usados.includes(pos) && exactas.includes(h));
    if (i === -1) i = encabezados.findIndex((h, pos) => !usados.includes(pos) && contiene.some((p) => h.includes(p)));
    if (i !== -1) usados.push(i);
    return i;
  };
  const indices = {};
  for (const campo of Object.keys(PUC_COLUMNAS)) indices[campo] = columna(campo);
  if (indices.codigo === -1 || indices.concepto === -1) {
    return { error: 'No se reconocieron las columnas del archivo -- se necesita al menos una columna de "codigo" y una de "concepto" (o "nombre") en la primera fila.' };
  }
  const filasCrudas = [];
  for (let r = 1; r < filas.length; r++) {
    const fila = {};
    for (const campo of Object.keys(PUC_COLUMNAS)) fila[campo] = indices[campo] === -1 ? '' : (filas[r][indices[campo]] || '');
    filasCrudas.push({ numeroFila: r + 1, ...fila });
  }
  return { filasCrudas };
}

function nombreCuentaCliente(pucCliente, codigo) {
  const c = (Array.isArray(pucCliente) ? pucCliente : []).find((x) => String(x.codigo) === String(codigo));
  return c ? String(c.concepto || '').trim() : '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nivelDeCodigo,
    motivoObsoleta,
    gruposDeCategoria,
    cuentaUsable,
    cuentasClienteParaCategoria,
    elegirCuentaCliente,
    cuentaRetencionCliente,
    cuentaIvaGastoCliente,
    nombreCuentaCliente,
    leerSiNoPuc,
    leerPorcentajePuc,
    filasPucDesdeTabla,
  };
}
