export const redondear3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

// FEFO (first expired, first out): sale primero lo que vence antes; lo que no vence, al final;
// a igual vencimiento, lo que ingresó antes.
function porVencimiento(a, b) {
  const va = a.fecha_vencimiento ?? null;
  const vb = b.fecha_vencimiento ?? null;
  if (va !== vb) {
    if (va === null) return 1;
    if (vb === null) return -1;
    return va < vb ? -1 : 1;
  }
  if (a.fecha_ingreso !== b.fecha_ingreso) return a.fecha_ingreso < b.fecha_ingreso ? -1 : 1;
  return a.id - b.id;
}

/**
 * Reparte `cantidad` entre los lotes. Devuelve qué tomar de cada uno y el `faltante`
 * (lo que no alcanzó a cubrirse con lotes: el stock quedará negativo).
 * lotes: [{ id, cantidad_actual, fecha_vencimiento, fecha_ingreso, costo_unitario }]
 */
export function asignarFefo(lotes, cantidad) {
  let pendiente = redondear3(cantidad);
  const asignaciones = [];
  for (const lote of lotes.filter((l) => l.cantidad_actual > 0).sort(porVencimiento)) {
    if (pendiente <= 0) break;
    const tomar = Math.min(pendiente, lote.cantidad_actual);
    asignaciones.push({ id_lote: lote.id, cantidad: redondear3(tomar), costo_unitario: lote.costo_unitario });
    pendiente = redondear3(pendiente - tomar);
  }
  return { asignaciones, faltante: Math.max(0, pendiente) };
}
