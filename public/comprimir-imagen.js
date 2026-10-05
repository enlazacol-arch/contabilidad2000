'use strict';
// ---------- Compresión de fotos antes de subirlas ----------
// Compartido por Escanear y Carga masiva (ver <script src="/comprimir-imagen.js">).
//
// Las fotos de celular modernas pueden pesar varios MB cada una -- un
// lote de 20-30 fotos así de una sola vez puede superar fácilmente el
// límite del cuerpo de la petición (y antes se caía con un error poco
// claro, como si no se pudiera leer nada). Antes de subir, cada imagen
// (los PDF no se tocan -- no se pueden recomprimir así de fácil en el
// navegador) se reduce a un tamaño razonable para que la IA la siga
// leyendo perfectamente bien, mientras el lote completo pesa mucho menos.
const COMPRESION_MAX_LADO = 2000; // px, lado más largo de la imagen
const COMPRESION_CALIDAD = 0.82;
const COMPRESION_UMBRAL_BYTES = 900 * 1024; // no vale la pena tocar fotos ya livianas

function esImagenComprimible(file){
  return /^image\/(jpe?g|png|webp)$/i.test(file.type || '') || /\.(jpe?g|png|webp)$/i.test(file.name || '');
}

function comprimirImagenSiHaceFalta(file){
  if (!esImagenComprimible(file) || file.size <= COMPRESION_UMBRAL_BYTES) {
    return Promise.resolve(file);
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > COMPRESION_MAX_LADO || height > COMPRESION_MAX_LADO) {
        if (width >= height) {
          height = Math.round(height * (COMPRESION_MAX_LADO / width));
          width = COMPRESION_MAX_LADO;
        } else {
          width = Math.round(width * (COMPRESION_MAX_LADO / height));
          height = COMPRESION_MAX_LADO;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        // Si la "compresión" salió más pesada (pasa con fotos que ya
        // venían muy comprimidas), se manda la original -- mejor eso que
        // arriesgar perder calidad sin ganar nada de peso.
        if (!blob || blob.size >= file.size) { resolve(file); return; }
        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
      }, 'image/jpeg', COMPRESION_CALIDAD);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); }; // si no se puede leer como imagen, se manda tal cual
    img.src = url;
  });
}
