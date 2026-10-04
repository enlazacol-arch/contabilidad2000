// Pruebas de public/puc-cliente.js -- el PUC propio de cada cliente.
// El plan de abajo es inventado, con la misma forma que exporta un
// programa contable (auxiliares de 8 dígitos, cuentas "IVA ..." al gasto,
// retenciones con su tarifa y cuentas viejas de ajustes por inflación).
//
//   npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nivelDeCodigo,
  motivoObsoleta,
  cuentasClienteParaCategoria,
  elegirCuentaCliente,
  cuentaRetencionCliente,
  cuentaIvaGastoCliente,
  nombreCuentaCliente,
} = require('../public/puc-cliente');

const c = (codigo, concepto, extra = {}) => ({ codigo, concepto, categoria_concepto: '', activo: true, recibe_movimiento: true, porcentaje: null, ...extra });
const PLAN = [
  c('5135', 'GASTOS POR SERVICIOS', { recibe_movimiento: false }),
  c('513507', 'VIGILANCIA'),
  c('513508', 'IVA VIGILANCIA'),
  c('513506', 'IVA ASEO Y VIGILANCIA'),
  c('513530', 'ENERGIA ELECTRICA'),
  c('513599', 'AJUSTES POR INFLACION'),
  c('514510', 'MANTMTO CONSTRUC Y EDIFIC.', { recibe_movimiento: false }),
  c('51451001', 'MANTMTO ZONAS COMUNES'),
  c('51451002', 'IVA MTTO'),
  c('51451006', 'MANTENIMIENTO PUERTAS'),
  c('514515', 'MAQUINARIA Y EQUIPO', { recibe_movimiento: false }),
  c('51451501', 'EQUIPO DE BOMBEO'),
  c('51451506', 'IVA ASCENSOR'),
  c('519525', 'IMPLEMENTOS ASEO Y CAFETERIA', { recibe_movimiento: false }),
  c('51952501', 'IMPLEMENTOS ASEO Y CAFETERIA'),
  c('51952502', 'IVA IMPLEMENTOS ASEO Y CAFETER'),
  c('51959504', 'DOTACION', { activo: false }),
  c('236515', 'RF x P HONORARIOS', { porcentaje: 10 }),
  c('236516', 'HONORARIOS 11%', { porcentaje: 11 }),
  c('236525', 'RF x P SERVICIOS', { recibe_movimiento: false }),
  c('23652501', 'RETEFTE SERVICIOS 2%', { porcentaje: 2 }),
  c('23652502', 'RETEFTE SERVICIOS 4%', { porcentaje: 4 }),
  c('23654005', 'POR COMPRAS 2.5%'),
  c('236905', 'RETENCION CREE 0.4%', { porcentaje: 4 }),
  c('470510', 'C.M. INVENTARIOS (CR)'),
];

test('nivelDeCodigo: por la cantidad de dígitos', () => {
  assert.equal(nivelDeCodigo('5'), 'clase');
  assert.equal(nivelDeCodigo('51'), 'grupo');
  assert.equal(nivelDeCodigo('5135'), 'cuenta');
  assert.equal(nivelDeCodigo('513507'), 'subcuenta');
  assert.equal(nivelDeCodigo('51451501'), 'auxiliar');
});

test('motivoObsoleta: ajustes por inflación, corrección monetaria y CREE', () => {
  assert.match(motivoObsoleta('513599', 'AJUSTES POR INFLACION'), /inflación/);
  assert.match(motivoObsoleta('140599', 'AJUS.INLF.INVENT MAT.PRIMAS'), /inflación/); // con el error de digitación del plan real
  assert.match(motivoObsoleta('470510', 'C.M. INVENTARIOS (CR)'), /Corrección monetaria/);
  assert.match(motivoObsoleta('236905', 'RETENCION CREE 0.4%'), /CREE/);
  assert.equal(motivoObsoleta('513507', 'VIGILANCIA'), '');
  assert.equal(motivoObsoleta('23652599', 'PAGOS'), '');
});

test('cuentasClienteParaCategoria: por grupo del PUC, sin IVA, inactivas ni cuentas que no reciben movimiento', () => {
  const servicios = cuentasClienteParaCategoria(PLAN, 'servicios').map((x) => x.codigo);
  assert.ok(servicios.includes('513507'));
  assert.ok(servicios.includes('51451501'));
  assert.ok(!servicios.includes('513508'), 'una cuenta "IVA ..." no es el gasto');
  assert.ok(!servicios.includes('5135'), 'no recibe movimiento');
  assert.ok(!servicios.includes('514510'), 'no recibe movimiento');
  const compras = cuentasClienteParaCategoria(PLAN, 'compras').map((x) => x.codigo);
  assert.ok(compras.includes('51952501'));
  assert.ok(!compras.includes('51959504'), 'inactiva');
});

test('cuentasClienteParaCategoria: una cuenta marcada a mano con su categoría se respeta', () => {
  const plan = [...PLAN, c('51058', 'COMISIONES', { categoria_concepto: 'honorarios_juridica' })];
  assert.deepEqual(cuentasClienteParaCategoria(plan, 'honorarios_juridica').map((x) => x.codigo), ['51058']);
  assert.ok(!cuentasClienteParaCategoria(plan, 'servicios').some((x) => x.codigo === '51058'));
});

test('elegirCuentaCliente: el auxiliar del cliente por subcuenta estándar y palabras', () => {
  assert.equal(elegirCuentaCliente(PLAN, 'servicios', '514510', 'mantenimiento puertas'), '51451006');
  assert.equal(elegirCuentaCliente(PLAN, 'compras', '519595', 'implementos de aseo y cafeteria'), '51952501');
  assert.equal(elegirCuentaCliente(PLAN, 'servicios_publicos', '513530', 'energia'), '513530');
  assert.equal(elegirCuentaCliente(PLAN, 'vigilancia_aseo', '513505', 'servicio de vigilancia'), '513507');
});

test('elegirCuentaCliente: sin relación con ninguna cuenta del cliente, no adivina', () => {
  assert.equal(elegirCuentaCliente(PLAN, 'servicios', '513595', 'software contable'), '');
  assert.equal(elegirCuentaCliente([], 'servicios', '514510', 'mantenimiento'), '');
});

test('cuentaRetencionCliente: la cuenta de la tarifa', () => {
  assert.equal(cuentaRetencionCliente(PLAN, '236525', 0.04).codigo, '23652502');
  assert.equal(cuentaRetencionCliente(PLAN, '236525', 0.02).codigo, '23652501');
  assert.equal(cuentaRetencionCliente(PLAN, '236540', 0.025).codigo, '23654005', 'por el % en el nombre');
  assert.equal(cuentaRetencionCliente(PLAN, '236515', 0.10).codigo, '236515');
  assert.equal(cuentaRetencionCliente(PLAN, '236515', 0.11).codigo, '236516', 'hermana del mismo grupo');
});

test('cuentaRetencionCliente: sin cuenta de esa tarifa -> null (se usa la estándar)', () => {
  assert.equal(cuentaRetencionCliente(PLAN, '236525', 0.06), null);
  assert.equal(cuentaRetencionCliente(PLAN, '236530', 0.035), null);
});

test('cuentaIvaGastoCliente: la "IVA ..." que corresponde al gasto', () => {
  assert.equal(cuentaIvaGastoCliente(PLAN, '513507').codigo, '513508');
  assert.equal(cuentaIvaGastoCliente(PLAN, '51952501').codigo, '51952502');
  assert.equal(cuentaIvaGastoCliente(PLAN, '51451006').codigo, '51451002');
});

test('cuentaIvaGastoCliente: nunca una "IVA" de otra cosa', () => {
  assert.equal(cuentaIvaGastoCliente(PLAN, '51451501'), null); // EQUIPO DE BOMBEO no es IVA ASCENSOR
  assert.equal(cuentaIvaGastoCliente(PLAN, '513530'), null);
});

test('nombreCuentaCliente', () => {
  assert.equal(nombreCuentaCliente(PLAN, '51451501'), 'EQUIPO DE BOMBEO');
  assert.equal(nombreCuentaCliente(PLAN, '999999'), '');
});

// ---------- lectura del archivo ----------

const { leerSiNoPuc, leerPorcentajePuc, filasPucDesdeTabla } = require('../public/puc-cliente');
const cartera = require('../cartera');

test('filasPucDesdeTabla: formato exportado por Contai (con tildes en Latin-1 ya decodificado)', () => {
  const csv = 'Codigo,Concepto,Tipo de Cuenta,Id. Recibe Movto.,Id. Centro Costo,Id. Ajustes,Porcentaje Base,Tipo Plazo,Activo\n'
    + '5135,GASTOS POR SERVICIOS          ,N,N,N,,0,N,S\n'
    + '513540,"CORREO, PORTES Y TELEGRAMAS   ",S,S,S,N,0,N,S\n'
    + '23652502,RETEFTE SERVICIOS 4%          ,B,S,N,N,4,N,S\n'
    + '51451501,DEPRECIACIÓN EQUIPO,S,S,N,N,0,N,N\n';
  const { filasCrudas, error } = filasPucDesdeTabla(cartera.parsearFilasCSV(csv));
  assert.equal(error, undefined);
  assert.equal(filasCrudas.length, 4);
  assert.deepEqual(
    { codigo: filasCrudas[0].codigo, recibe: filasCrudas[0].recibe_movimiento, activo: filasCrudas[0].activo, categoria: filasCrudas[0].categoria },
    { codigo: '5135', recibe: 'N', activo: 'S', categoria: '' }
  );
  assert.equal(filasCrudas[1].concepto.trim(), 'CORREO, PORTES Y TELEGRAMAS');
  assert.equal(filasCrudas[2].porcentaje, '4');
  assert.equal(filasCrudas[2].tipo_cuenta, 'B');
  assert.equal(filasCrudas[3].activo, 'N');
});

test('filasPucDesdeTabla: CSV sencillo de código y nombre (como antes)', () => {
  const { filasCrudas } = filasPucDesdeTabla([['Código Cuenta', 'Nombre Cuenta'], ['51058', 'Comisiones']]);
  assert.equal(filasCrudas[0].codigo, '51058');
  assert.equal(filasCrudas[0].concepto, 'Comisiones');
  assert.equal(filasCrudas[0].recibe_movimiento, '');
});

test('filasPucDesdeTabla: sin columna de código -> error claro', () => {
  assert.match(filasPucDesdeTabla([['nombre'], ['x']]).error, /codigo/);
});

test('leerSiNoPuc / leerPorcentajePuc', () => {
  assert.equal(leerSiNoPuc('S', false), true);
  assert.equal(leerSiNoPuc(' n ', true), false);
  assert.equal(leerSiNoPuc('', true), true);
  assert.equal(leerPorcentajePuc('2,5'), 2.5);
  assert.equal(leerPorcentajePuc('4%'), 4);
  assert.equal(leerPorcentajePuc('0'), null);
  assert.equal(leerPorcentajePuc(''), null);
});
