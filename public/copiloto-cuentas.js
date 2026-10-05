'use strict';
// ---------- Copiloto de cuentas (navegador) ----------
//
// Compartido por Escanear y Carga masiva. Para un cliente con plan de
// cuentas propio, cuando el sistema todavía no sabe a qué cuenta va una
// factura (proveedor o concepto nuevos), le pide al servidor la cuenta de
// cada ítem (POST /api/clients/:id/copiloto-cuentas): la del proveedor si
// siempre fue a la misma, o la que escoge la IA con el plan del cliente y
// ejemplos de cómo causa su contadora. La contadora la ve marcada y la
// confirma o la cambia.

const RESPUESTAS_COPILOTO = new Map(); // clave de la factura -> promesa de la respuesta

function claveCopiloto(clienteId, d) {
  return [clienteId, d.nit_cc, d.valor_con_iva, d.letras_fe, d.numeros_fe, (d.items || []).length].join('|');
}

// ¿Hay algún ítem (no elegido a mano) del que el sistema todavía no sepa
// la cuenta por lo aprendido de este cliente?
function necesitaCopiloto(clienteId, nit, items) {
  if (!clienteId || !Array.isArray(items) || items.length === 0) return false;
  if (typeof subcuentaAprendida !== 'function') return true;
  return items.some((it) => !it._subcuentaManual && !subcuentaAprendida(nit, it.categoria_concepto, clienteId, it.descripcion));
}

function pedirCopilotoCuentas(clienteId, d) {
  const clave = claveCopiloto(clienteId, d);
  if (!RESPUESTAS_COPILOTO.has(clave)) {
    RESPUESTAS_COPILOTO.set(clave, fetch(`/api/clients/${encodeURIComponent(clienteId)}/copiloto-cuentas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nit: d.nit_cc, nombre: d.nombre_razon_social, concepto: d.concepto,
        items: (d.items || []).map((it) => ({ descripcion: it.descripcion, subtotal: it.subtotal })),
      }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return RESPUESTAS_COPILOTO.get(clave);
}

// Aplica la respuesta a los ítems que no se eligieron a mano. Devuelve
// true si cambió alguno.
function aplicarCopilotoAItems(items, respuesta, clienteId) {
  if (!respuesta || !Array.isArray(respuesta.cuentas) || respuesta.cuentas.length === 0) return false;
  let cambio = false;
  respuesta.cuentas.forEach(({ indice, codigo }) => {
    const it = items[indice];
    if (!it || it._subcuentaManual || !codigo) return;
    if (it.subcuenta_gasto !== codigo) cambio = true;
    it.subcuenta_gasto = codigo;
    it._copiloto = respuesta.fuente;
    it._pucCliente = clienteId; // ya está en la cuenta del cliente: no volver a mapearla
  });
  return cambio;
}

const TEXTO_FUENTE_COPILOTO = {
  copiloto: 'Sugerida por el copiloto (plan y criterio de la contadora)',
  proveedor: 'La de siempre con este proveedor',
};
