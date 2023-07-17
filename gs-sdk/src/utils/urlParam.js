
export const previewVariant = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('gsPreviewVariant');
}