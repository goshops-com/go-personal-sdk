const pdpTieneDescuentoItau = (function () {
  return async function (url) {
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' en ' + url);
    var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    var wrapper = doc.querySelector('.preciosWrapper');
    if (!wrapper) return { url: url, tieneItau: false, descuentos: [], error: 'no se encontró el bloque de precios' };
    var descuentos = [];
    wrapper.querySelectorAll('.descuentosMDP > [class*="desc_"]').forEach(function (el) {
      var conTitulo = el.querySelector('[title]');
      var texto = (conTitulo && conTitulo.getAttribute('title')) || '';
      if (!/ita[uú]/i.test(texto)) return;
      var pct = texto.match(/(\d+(?:[.,]\d+)?)\s*%/);
      var monto = el.querySelector('.precio .monto') || el.querySelector('.precio');
      descuentos.push({
        texto: texto.trim(),
        porcentaje: pct ? parseFloat(pct[1].replace(',', '.')) : null,
        precio: monto ? Number(monto.textContent.replace(/\./g, '').replace(/[^\d,]/g, '').replace(',', '.')) : null
      });
    });
    return { url: url, tieneItau: descuentos.length > 0, descuentos: descuentos };
  };
})();

export { pdpTieneDescuentoItau };
export default pdpTieneDescuentoItau;
