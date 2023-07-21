
export const previewVariant = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('gsPreviewVariant');
}

export const getParam = (param) => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

export const jsonToQueryString = (json) => {
    const queryString = Object.keys(json)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(json[key]))
      .join('&');
  
    return '?' + queryString;
  }