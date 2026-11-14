// Decision de contenidos en el navegador (payload `fd` del listado publico,
// GET /public/cached-content/:project/?pageType=X&fd=1). Modulo PURO: sin DOM,
// sin red y sin storage. Es el port de lo que hace discover en
// utils/targetEval.js, tal como lo describe la cabecera de utils/contentFront.js.
//
// Todo es de TRES valores: true, false o null. null = "no se": un campo u
// operador que este SDK no conoce, un nodo o termino mal formado, o cualquier
// excepcion. Con un solo null el resultado es null y decide el servidor.
//
// Hoja { f: 'current_url', o, x }, con L = currentPage.location tal cual viaja
// en el POST (sin normalizar; si falta vale '') y dec(v) = decodeURIComponent(v),
// o v si tira:
//   o = null | '=' | 'like' | '!=' | 'not_like' (x: string no vacio)
//     m = L.includes(x) || dec(L).includes(x) || L.includes(dec(x)) || dec(L).includes(dec(x))
//     SENSIBLE a mayusculas y sin trim. '!=' y 'not_like' devuelven !m.
//   o = 'in' | 'not_in' | 'like_any' | 'not_like_any' (x: string o array de strings)
//     terminos   = trim de cada uno -> por cada t: [t, dec(t)] -> trim -> sin
//                  los vacios -> minusculas
//     candidatos = [L, dec(L)] en minusculas, sin trim
//     in / not_in comparan por igualdad; like_any / not_like_any por includes.
// Grupo { t: 'and' | 'or', c: [...] }: 'and' = todos, 'or' = alguno, y sin hijos
// matchea SIEMPRE, tambien si es 'or'.

const SUPPORTED_VERSION = 1;
const SCALAR_OPERATORS = ["=", "like", "!=", "not_like"];
const MULTI_VALUE_OPERATORS = ["in", "not_in", "like_any", "not_like_any"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value) {
  return typeof value === "string" && value !== "";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

// Deja en `why` el motivo del primer null (para el reporte de shadow).
function unknown(why, reason) {
  if (why.length === 0) {
    why.push(reason);
  }
  return null;
}

function evalCurrentUrl(node, location, why) {
  const operator = node.o;
  const term = node.x;
  const decodedLocation = safeDecode(location);

  if (MULTI_VALUE_OPERATORS.includes(operator)) {
    const list = Array.isArray(term) ? term : [term];
    // El servidor nunca manda un termino vacio (ni un array vacio): con eso no
    // matchea nada, tampoco not_in. Si llega, no se evalua.
    if (list.length === 0 || !list.every((item) => typeof item === "string" && item.trim() !== "")) {
      return unknown(why, "term");
    }
    const terms = [];
    for (const item of list) {
      const trimmed = item.trim();
      for (const candidate of [trimmed, safeDecode(trimmed)]) {
        const clean = candidate.trim();
        if (clean !== "") {
          terms.push(clean.toLowerCase());
        }
      }
    }
    const candidates = [location.toLowerCase(), decodedLocation.toLowerCase()];
    const equals = operator === "in" || operator === "not_in";
    const found = candidates.some((candidate) =>
      terms.some((item) => (equals ? candidate === item : candidate.includes(item))),
    );
    return operator === "in" || operator === "like_any" ? found : !found;
  }

  if (operator !== null && !SCALAR_OPERATORS.includes(operator)) {
    return unknown(why, "operator");
  }
  if (typeof term !== "string" || term === "") {
    return unknown(why, "term");
  }
  const decodedTerm = safeDecode(term);
  const matches =
    location.includes(term) ||
    decodedLocation.includes(term) ||
    location.includes(decodedTerm) ||
    decodedLocation.includes(decodedTerm);
  return operator === "!=" || operator === "not_like" ? !matches : matches;
}

const LEAF_EVALUATORS = {
  current_url: evalCurrentUrl,
};

function evalNode(node, location, why) {
  if (!isPlainObject(node)) {
    return unknown(why, "node");
  }

  if ("t" in node || "c" in node) {
    if ((node.t !== "and" && node.t !== "or") || !Array.isArray(node.c) || "f" in node) {
      return unknown(why, "group");
    }
    // Se evaluan TODOS los hijos, sin cortar antes: un null en cualquiera
    // anula el grupo aunque otro hijo ya alcance para decidirlo.
    const results = node.c.map((child) => evalNode(child, location, why));
    if (results.includes(null)) {
      return null;
    }
    if (results.length === 0) {
      return true;
    }
    return node.t === "and" ? results.every(Boolean) : results.some(Boolean);
  }

  const evaluator =
    typeof node.f === "string" && Object.prototype.hasOwnProperty.call(LEAF_EVALUATORS, node.f)
      ? LEAF_EVALUATORS[node.f]
      : null;
  if (!evaluator) {
    return unknown(why, "field");
  }
  return evaluator(node, location, why);
}

function evaluate(tree, location, why) {
  try {
    if (location != null && typeof location !== "string") {
      return unknown(why, "location");
    }
    return evalNode(tree, location || "", why);
  } catch (e) {
    return unknown(why, "error");
  }
}

/**
 * Evalua un arbol normalizado contra `location` (el currentPage.location del POST).
 * Devuelve true, false o null (no se puede decidir aca).
 */
export function evaluateTree(tree, location) {
  return evaluate(tree, location, []);
}

function unknownDecision(reason) {
  return { status: "unknown", reason };
}

function decideEntry(fdEntry, location) {
  if (!isPlainObject(fdEntry) || !isId(fdEntry.id)) {
    return unknownDecision("entry");
  }
  if (fdEntry.name !== null && typeof fdEntry.name !== "string") {
    return unknownDecision("entry");
  }
  if (typeof fdEntry.rev !== "number" || !Number.isFinite(fdEntry.rev)) {
    return unknownDecision("entry");
  }
  // Fase 1: exactamente un target con exactamente una variante. Con mas hay
  // orden entre targets, A/B y stickiness, que hoy solo resuelve el servidor.
  if (!Array.isArray(fdEntry.t) || fdEntry.t.length !== 1) {
    return unknownDecision("targets");
  }

  for (const target of fdEntry.t) {
    if (!isPlainObject(target) || !isId(target.id)) {
      return unknownDecision("target");
    }
    if (!Array.isArray(target.v) || target.v.length !== 1) {
      return unknownDecision("variants");
    }
    const variant = target.v[0];
    if (
      !isPlainObject(variant) ||
      !isId(variant.id) ||
      typeof variant.w !== "number" ||
      !(variant.w > 0) ||
      typeof variant.s !== "number" ||
      !(variant.s > 0)
    ) {
      return unknownDecision("variant");
    }

    const why = [];
    const result = evaluate(target.r, location, why);
    if (result === null) {
      return unknownDecision(`rules:${why[0]}`);
    }
    if (result) {
      return { status: "match", targetId: target.id, variantId: variant.id };
    }
  }

  return { status: "no_match" };
}

/**
 * Decide un contenido con su `fd` del listado:
 *   { status: 'match', targetId, variantId } | { status: 'no_match' } | { status: 'unknown', reason }
 * Cualquier forma que no sea exactamente la esperada es `unknown`. Nunca tira.
 */
export function decide(fdEntry, location) {
  try {
    return decideEntry(fdEntry, location);
  } catch (e) {
    return unknownDecision("error");
  }
}

/** Bloque `fd` de primer nivel del listado: solo se entiende la version 1. */
export function isSupportedVersion(listingFd) {
  return isPlainObject(listingFd) && listingFd.v === SUPPORTED_VERSION;
}

// Hash de la sesion a [0, 1): FNV-1a de 32 bits sobre las unidades UTF-16 de
// "gsfd:" + sessionId, mas el mezclado final de murmur3 (fmix32) para que ids
// parecidos (mismo prefijo, ultimo caracter distinto) no caigan juntos. El
// prefijo lo separa de otros repartos hechos con el mismo id.
function sessionFraction(sessionId) {
  const input = `gsfd:${sessionId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/**
 * La sesion entra en la muestra? Estable por sesion: la misma sesion da siempre
 * lo mismo, y al subir `sample` nadie que ya estaba adentro queda afuera.
 * sample 1 = todas, 0 = ninguna; cualquier otro valor invalido = ninguna.
 */
export function inSample(sessionId, sample) {
  if (typeof sessionId !== "string" || sessionId === "") {
    return false;
  }
  if (typeof sample !== "number" || !(sample > 0) || sample > 1) {
    return false;
  }
  if (sample === 1) {
    return true;
  }
  return sessionFraction(sessionId) < sample;
}
