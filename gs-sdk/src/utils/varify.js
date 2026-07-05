const VARIFY_SCRIPT_SELECTOR = 'script[src*="app.varify.io/varify.js"]';
const VARIFY_SCRIPT_SRC = "https://app.varify.io/varify.js";
const BLOCKED_VARIFY_GLOBAL_KEYS = [
  "_varify",
  "varifyLoaded",
  "varifyScriptLoaded",
];
let pendingVarifyLoad = null;
let pendingVarifyIid = null;
let guardedVarifyIid = null;

const forceVarifyIid = (target, iid) => {
  let currentIid = iid;
  const baseTarget =
    target && typeof target === "object"
      ? target
      : {};

  // Keep the expected iid stable even if another script tries to mutate it later.
  Object.defineProperty(baseTarget, "iid", {
    configurable: true,
    enumerable: true,
    get() {
      return currentIid;
    },
    set(value) {
      if (String(value) !== String(currentIid)) {
        window.gsLog?.("Blocked unexpected Varify iid change", {
          attemptedIid: value,
          lockedIid: currentIid,
        });
      }
    },
  });

  return baseTarget;
};

const installVarifyGuard = (iid, existingVarify = {}) => {
  guardedVarifyIid = iid;

  try {
    delete window.varify;
  } catch (error) {
    window.gsLog?.("Could not delete previous window.varify", error);
  }

  // Guard the global so a later assignment still keeps the iid we decided to use.
  let currentVarify = forceVarifyIid(existingVarify, iid);

  Object.defineProperty(window, "varify", {
    configurable: true,
    get() {
      return currentVarify;
    },
    set(value) {
      const nextVarify = forceVarifyIid(value, guardedVarifyIid);
      window.gsLog?.("Blocked replacement of the guarded Varify instance", {
        attemptedIid: value?.iid,
        lockedIid: guardedVarifyIid,
      });
      currentVarify = nextVarify;
    },
  });

  return currentVarify;
};

export const ensureVarify = async (iid) => {
  if (!iid || typeof document === "undefined") {
    return window?.varify;
  }

  if (window?.varify?.iid === iid && window?.varify?.loaded) {
    installVarifyGuard(iid, window.varify);
    return window.varify;
  }

  // Reuse the same pending promise to avoid overlapping loads for the same iid.
  if (pendingVarifyLoad && pendingVarifyIid === iid) {
    window.gsLog?.("Varify load already in progress", { iid });
    return pendingVarifyLoad;
  }

  try {
    if (window?.varify) {
      window.gsLog?.("Reloading Varify with the expected iid", {
        previousIid: window.varify.iid,
        nextIid: iid,
        previousLoaded: window.varify.loaded,
      });
    }

    document.querySelectorAll(VARIFY_SCRIPT_SELECTOR).forEach((script) => script.remove());
    document
      .querySelectorAll('iframe[src*="varify"]')
      .forEach((iframe) => iframe.remove());

    BLOCKED_VARIFY_GLOBAL_KEYS.forEach((key) => {
      try {
        delete window[key];
      } catch (error) {
        window.gsLog?.("Could not clear previous Varify global", { key, error });
      }
    });

    // Remove the current runtime footprint before forcing a fresh script load.
    installVarifyGuard(iid);

    pendingVarifyIid = iid;
    pendingVarifyLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${VARIFY_SCRIPT_SRC}?forceReload=${Date.now()}`;
      script.async = true;
      script.onload = () => {
        window.gsLog?.("Varify script loaded", {
          iid,
          currentIid: window?.varify?.iid,
          loaded: window?.varify?.loaded,
        });
        resolve(window.varify);
      };
      script.onerror = (error) => reject(error);
      document.head.appendChild(script);
    });

    await pendingVarifyLoad;
  } catch (error) {
    window.gsLog?.("Varify load failed", error);
  } finally {
    pendingVarifyLoad = null;
    pendingVarifyIid = null;
  }

  return window?.varify;
};

export const getAppliedExperimentBySlug = (experimentSlug) => {
  const appliedExperiments = window?.varify?.debug?.appliedExperiments || {};

  return Object.values(appliedExperiments).find(
    (experiment) => experiment?.experimentSlug === experimentSlug,
  );
};

export const getAppliedExperiments = () => {
  return window?.varify?.debug?.appliedExperiments || {};
};
