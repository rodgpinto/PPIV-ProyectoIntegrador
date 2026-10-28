// Costos, márgenes y precios. Lo usan el servidor y la interfaz (misma fórmula en los dos lados).

export const redondear = (n, decimales = 0) => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Costo por unidad base (ml, g o unidad) de una compra: costo total / cantidad. */
export const costoUnitarioDeCompra = (costoTotal, cantidad) =>
  cantidad > 0 ? redondear(costoTotal / cantidad, 4) : 0;

/**
 * Costo de un plato a partir de su receta. Un insumo con costo 0 se considera "sin costo
 * cargado": el total queda marcado como incompleto para no mostrar un margen engañoso.
 * items: [{ cantidad, costo_unitario }]
 */
export function costoDeReceta(items) {
  let costo = 0;
  let incompleto = false;
  for (const i of items) {
    costo += i.cantidad * i.costo_unitario;
    if (!(i.costo_unitario > 0)) incompleto = true;
  }
  return { costo: redondear(costo, 2), incompleto };
}

/** Margen en pesos y como % del precio de venta (null si el precio es 0). */
export function calcularMargen(precio, costo) {
  return {
    margen: redondear(precio - costo, 2),
    margen_pct: precio > 0 ? redondear(((precio - costo) / precio) * 100, 1) : null,
  };
}

/** Precio de venta que deja el margen objetivo (% del precio). Redondea al `paso` en pesos. */
export function precioParaMargen(costo, margenPct, paso = 1) {
  if (!(costo >= 0) || !(margenPct >= 0 && margenPct < 100)) return null;
  return Math.round(costo / (1 - margenPct / 100) / paso) * paso;
}

/** Precio con un ajuste porcentual (10 sube 10%, -5 baja 5%). Redondea al `paso` en pesos. */
export const aplicarPorcentaje = (precio, porcentaje, paso = 1) =>
  Math.round((precio * (1 + porcentaje / 100)) / paso) * paso;
