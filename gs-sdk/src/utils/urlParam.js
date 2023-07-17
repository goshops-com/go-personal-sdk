
export const previewVariant = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('gsPreviewVariant');
}