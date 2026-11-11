
// Se consulta muchas veces por contenido: el parseo se reusa mientras el query
// string de la pagina no cambie.
let parsedSearch = null;
let parsedParams = null;

const currentParams = () => {
  const search = window.location.search;
  if (search !== parsedSearch || !parsedParams) {
    parsedParams = new URLSearchParams(search);
    parsedSearch = search;
  }
  return parsedParams;
}

export const previewVariant = () => {
    return currentParams().get('gsPreviewVariant');
}

export const getParam = (param) => {
  return currentParams().get(param);
}

export const jsonToQueryString = (json) => {
    const queryString = Object.keys(json)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(json[key]))
      .join('&');
  
    return '?' + queryString;
  }

  export const isSearchReferral = () => {
    if(!document.referrer) return false;
    
    const urlParams = new URLSearchParams(document.referrer);
    return urlParams.get('_gsSearchId') !== null;
  }