'use strict';
// ---------- ¿Por qué esta factura va sin retención? ----------
//
// Compartido por Escanear y Carga masiva. Cuando el sistema propone una
// Rete Fuente y la contadora guarda la factura en $0, se le pregunta el
// motivo, y el sistema lo recuerda para las próximas facturas de ese
// proveedor (ver POST /api/proveedores/motivo-sin-retencion):
//   - autorretenedor / Régimen Simple / Art. 383: marca en el perfil
//     fiscal del proveedor (deja de proponer la retención ordinaria);
//   - "a este proveedor no se le retiene": tarifa aprendida 0 en esa
//     categoría;
//   - "solo esta vez": no se recuerda nada.
// Antes un "sin retención" no se aprendía, y en la prueba con la
// contabilidad real de Bosques el sistema seguía proponiendo retención
// cada mes a proveedores a los que la contadora no les retiene.

const MOTIVOS_SIN_RETENCION_UI = [
  ['', '¿Por qué va sin retención?'],
  ['autorretenedor', 'Es autorretenedor'],
  ['regimen_simple', 'Es del Régimen Simple (RST)'],
  ['articulo_383', 'Se le aplica el Art. 383 (rentas de trabajo)'],
  ['no_retener', 'A este proveedor no se le retiene en esta categoría'],
  ['solo_esta_vez', 'Solo esta vez (no recordar)'],
];

function selectorMotivoSinRetencionHtml(atributos) {
  return `<select class="motivo-sin-retencion" ${atributos || ''} aria-label="Motivo para no practicar retención">` +
    MOTIVOS_SIN_RETENCION_UI.map(([valor, texto]) => `<option value="${valor}">${texto}</option>`).join('') +
    '</select>';
}

// Guarda el motivo y actualiza en memoria el perfil fiscal o la tarifa
// aprendida de la página (terceroFiscalPorNit / tarifasAprendidas), para
// que la próxima factura de ese proveedor ya no proponga retención.
// Nunca lanza: si no se pudo guardar, devuelve false (la factura igual
// se guarda sin retención).
async function registrarMotivoSinRetencion({ nit, nombre, categoria, motivo }) {
  if (!motivo || motivo === 'solo_esta_vez' || !nit) return true;
  try {
    const res = await fetch('/api/proveedores/motivo-sin-retencion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nit, nombre, categoria, motivo }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const nitLimpio = String(nit).replace(/-\s*\d$/, '').replace(/[^0-9]/g, '');
    if (data.perfil && typeof terceroFiscalPorNit !== 'undefined') terceroFiscalPorNit[nitLimpio] = data.perfil;
    if (data.tarifa && typeof tarifasAprendidas !== 'undefined') tarifasAprendidas[`${data.tarifa.nit_proveedor}|${data.tarifa.categoria}`] = 0;
    return true;
  } catch (e) {
    return false;
  }
}

const TEXTO_MOTIVO_SIN_RETENCION = {
  autorretenedor: 'marcado como autorretenedor',
  regimen_simple: 'marcado como Régimen Simple',
  articulo_383: 'marcado con Art. 383',
  no_retener: 'no se le volverá a proponer retención en esta categoría',
};
