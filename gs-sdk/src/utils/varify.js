const VARIFY_SCRIPT_SELECTOR = 'script[src*="app.varify.io/varify.js"]';
const VARIFY_SCRIPT_SRC = "https://app.varify.io/varify.js";

export const ensureVarify = async (iid) => {
  if (!iid || typeof document === "undefined") {
    return window?.varify;
  }

  if (window?.varify?.iid === iid) {
    return window.varify;
  }

  try {
    if (window?.varify) {
      window.gsLog?.("Replacing Varify instance", {
        previousIid: window.varify.iid,
        nextIid: iid,
      });
    }

    document.querySelectorAll(VARIFY_SCRIPT_SELECTOR).forEach((script) => script.remove());

    delete window.varify;
    window.varify = { iid };

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${VARIFY_SCRIPT_SRC}?t=${Date.now()}`;
      script.async = true;
      script.onload = () => {
        window.gsLog?.("Varify imported successfully", { iid });
        resolve(window.varify);
      };
      script.onerror = (error) => reject(error);
      document.head.appendChild(script);
    });
  } catch (error) {
    window.gsLog?.("Varify load failed", error);
  }

  return window?.varify;
};

export const getAppliedExperimentBySlug = (experimentSlug) => {
  const appliedExperiments = window?.varify?.debug?.appliedExperiments || {};

  return Object.values(appliedExperiments).find(
    (experiment) => experiment?.experimentSlug === experimentSlug,
  );
};
