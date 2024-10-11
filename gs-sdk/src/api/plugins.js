const baseURL = `https://sdk.gopersonal.ai/`
export const loadPlugin = async (name, external = true) => {
    if (external) {
        await import(`${baseURL}external-libs/${name}.js`);
    } else {
        await import(`${baseURL}libs/${name}.js`);
    }
}