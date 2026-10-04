'use strict';
// ---------- Tema visual de las gráficas (Chart.js) ----------
// Solo presentación: tipografía, colores de texto y cuadrícula, leyenda,
// tooltip y formato de pesos en ejes y tooltips. No calcula nada -- los
// datos siguen saliendo de estadisticas.js y de cada página.
//
// Se carga después de que la página definió window.chartJsListo (la
// promesa que carga Chart.js desde cdnjs o jsDelivr).
(function () {
  const COP = (v) => '$ ' + Math.round(Number(v) || 0).toLocaleString('es-CO');

  // Eje abreviado: $ 12,5 M · $ 850 mil · $ 0
  function eje(v) {
    const n = Number(v) || 0;
    const abs = Math.abs(n);
    const signo = n < 0 ? '−' : '';
    if (abs >= 1e6) return signo + '$ ' + (abs / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
    if (abs >= 1e3) return signo + '$ ' + Math.round(abs / 1e3).toLocaleString('es-CO') + ' mil';
    return signo + '$ ' + abs.toLocaleString('es-CO');
  }

  window.enlazaGraficas = {
    eje,
    COP,
    colores: {
      ingreso: '#5B8072', ingresoArea: 'rgba(91,128,114,0.10)',
      egreso: '#FF5A36', egresoArea: 'rgba(255,90,54,0.08)',
      resultado: '#0B4F6C',
    },
  };

  function aplicar() {
    const Chart = window.Chart;
    if (!Chart || !Chart.defaults) return;
    const d = Chart.defaults;
    d.font.family = "'Figtree', -apple-system, 'Segoe UI', sans-serif";
    d.font.size = 12;
    d.color = '#4A5E68';
    d.borderColor = '#E4EDF1';
    d.animation = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 };

    d.plugins.legend.align = 'start';
    d.plugins.legend.labels.usePointStyle = true;
    d.plugins.legend.labels.pointStyle = 'rectRounded';
    d.plugins.legend.labels.boxWidth = 10;
    d.plugins.legend.labels.boxHeight = 10;
    d.plugins.legend.labels.padding = 16;
    d.plugins.legend.labels.color = '#1D2A32';
    d.plugins.legend.labels.font = { size: 13, weight: '600' };

    const t = d.plugins.tooltip;
    t.backgroundColor = '#1D2A32';
    t.titleColor = '#FFFFFF';
    t.bodyColor = 'rgba(255,255,255,0.88)';
    t.titleFont = { weight: '700', size: 13 };
    t.bodyFont = { size: 13 };
    t.padding = 10;
    t.cornerRadius = 8;
    t.boxPadding = 4;
    t.usePointStyle = true;
    t.mode = 'index';
    t.intersect = false;
    t.callbacks = Object.assign({}, t.callbacks, {
      label(ctx) {
        const v = ctx.parsed && (ctx.parsed.y !== undefined && ctx.chart.options.indexAxis !== 'y' ? ctx.parsed.y : ctx.parsed.x);
        const nombre = ctx.dataset.label ? ctx.dataset.label + ': ' : '';
        return ' ' + nombre + COP(v);
      },
    });

    d.interaction = { mode: 'index', intersect: false };
    d.elements.line.borderWidth = 2;
    d.elements.point.radius = 0;
    d.elements.point.hoverRadius = 5;
    d.elements.point.hitRadius = 12;
    d.elements.bar.borderRadius = 4;

    d.scale.grid.color = '#EDF3F6';
    d.scale.grid.drawTicks = false;
    d.scale.border = Object.assign({}, d.scale.border, { display: false });
    d.scale.ticks.padding = 8;
    d.scale.ticks.color = '#566D79';
  }

  if (window.chartJsListo && typeof window.chartJsListo.then === 'function') {
    window.chartJsListo.then(aplicar);
  } else {
    aplicar();
  }
})();
