// Presentaciones (envases) de un insumo. Todo se guarda en la unidad base (ml, g, unidad); esto convierte y da formato.
// Lo usan el servidor y la interfaz.

const redondear3 = (n) => Math.round(n * 1000) / 1000;

/** Cantidad base que trae esa cantidad de envases: 12 × 1500 ml = 18000 ml. */
export const aBase = (envases, presentacion) => redondear3(envases * presentacion.cantidad);

/** Cuántos envases enteros hay en una cantidad y cuánto sobra suelto. Las cantidades negativas no se parten. */
export function desglosar(cantidad, presentacion) {
  if (!(cantidad > 0) || !presentacion) return { envases: 0, resto: redondear3(cantidad) };
  const envases = Math.floor(redondear3(cantidad / presentacion.cantidad));
  return { envases, resto: redondear3(cantidad - envases * presentacion.cantidad) };
}

/** La presentación para mostrar equivalencias: la marcada como principal, o la primera. */
export const principalDe = (presentaciones = []) => presentaciones.find((p) => p.principal) ?? presentaciones[0] ?? null;

/** Costo de un envase a partir del costo por unidad base. */
export const costoDeEnvase = (costoUnitario, presentacion) => redondear3(costoUnitario * presentacion.cantidad * 1000) / 1000;

/**
 * Texto de equivalencia: «3 × Botella 750 ml + 200 ml». Devuelve null si el insumo no tiene presentaciones o si lo que hay
 * no alcanza para un envase entero (ahí alcanza con la cantidad en ml).
 */
export function equivalencia(cantidad, unidad, presentaciones, formatoNumero = (n) => String(n)) {
  const p = principalDe(presentaciones);
  if (!p) return null;
  const { envases, resto } = desglosar(cantidad, p);
  if (envases === 0) return null;
  const sufijo = unidad === 'unidad' ? '' : ` ${unidad}`;
  return resto > 0 ? `${envases} × ${p.nombre} + ${formatoNumero(resto)}${sufijo || ' u.'}` : `${envases} × ${p.nombre}`;
}

/**
 * Valida una lista de presentaciones y la normaliza: nombres sin repetir (sin distinguir mayúsculas) y exactamente una
 * principal (la primera si ninguna lo era). Devuelve { lista, error }.
 */
export function normalizarPresentaciones(lista) {
  const vistos = new Set();
  for (const p of lista) {
    const clave = p.nombre.trim().toLowerCase();
    if (vistos.has(clave)) return { error: `La presentación «${p.nombre.trim()}» está repetida` };
    vistos.add(clave);
  }
  const marcadas = lista.filter((p) => p.principal);
  if (marcadas.length > 1) return { error: 'Solo una presentación puede ser la principal' };
  return { lista: lista.map((p, i) => ({ nombre: p.nombre.trim(), cantidad: p.cantidad, principal: marcadas.length ? Boolean(p.principal) : i === 0 })) };
}
