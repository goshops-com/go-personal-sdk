import { getSession } from "./storage";

// Proyectos cuyo modulo de tienda manda el id del producto padre (configurable
// de Magento) aunque el catalogo tenga cada variante con su propia URL. Para
// esos, el server resuelve la variante por la URL de la pagina (preProcess) y,
// si no la encuentra, se queda con el id que vino.
const RESOLVE_PRODUCT_BY_URL_PROJECTS = [
  "69f9fd15bcb8468256ba4565", // Cannon Home CL
];

export function getProductUrlLookup() {
  if (!RESOLVE_PRODUCT_BY_URL_PROJECTS.includes(getSession()?.project)) {
    return null;
  }
  return window.location.origin + window.location.pathname;
}
