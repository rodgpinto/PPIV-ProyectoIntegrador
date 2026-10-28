import { diasEntre } from './fechas.js';

/**
 * Alertas de stock. `hoy` es 'YYYY-MM-DD' en la zona del local.
 * insumos: activos, con stock_actual, stock_minimo, stock_maximo (o null), dias_aviso_vencimiento.
 * lotes: solo los que tienen cantidad_actual > 0.
 */
export function calcularAlertas({ insumos, lotes, hoy }) {
  const reponer = [];
  const sobrestock = [];
  const porVencer = [];
  const vencidos = [];
  const porInsumo = new Map(insumos.map((i) => [i.id, i]));

  for (const i of insumos) {
    if (i.stock_minimo > 0 && i.stock_actual <= i.stock_minimo) {
      reponer.push({
        id_insumo: i.id, nombre: i.nombre, unidad: i.unidad,
        stock_actual: i.stock_actual, stock_minimo: i.stock_minimo,
        faltante: Math.max(0, i.stock_minimo - i.stock_actual),
      });
    }
  }

  for (const l of lotes) {
    const i = porInsumo.get(l.id_insumo);
    if (!i || !l.fecha_vencimiento) continue;
    const dias = diasEntre(hoy, l.fecha_vencimiento);
    const base = {
      id_lote: l.id, id_insumo: i.id, nombre: i.nombre, unidad: i.unidad,
      cantidad: l.cantidad_actual, fecha_vencimiento: l.fecha_vencimiento,
    };
    if (dias < 0) vencidos.push({ ...base, dias_vencido: -dias });
    else if (dias <= i.dias_aviso_vencimiento) porVencer.push({ ...base, dias_restantes: dias });
  }

  for (const i of insumos) {
    if (i.stock_maximo != null && i.stock_actual > i.stock_maximo) {
      const fechas = lotes.filter((l) => l.id_insumo === i.id).map((l) => l.fecha_ingreso).sort();
      sobrestock.push({
        id_insumo: i.id, nombre: i.nombre, unidad: i.unidad,
        stock_actual: i.stock_actual, stock_maximo: i.stock_maximo,
        exceso: i.stock_actual - i.stock_maximo,
        // antigüedad del lote más viejo con stock: un exceso que lleva tiempo parado es el que termina vencido
        dias_en_stock: fechas.length ? diasEntre(fechas[0], hoy) : null,
      });
    }
  }

  reponer.sort((a, b) => b.faltante / b.stock_minimo - a.faltante / a.stock_minimo);
  porVencer.sort((a, b) => a.dias_restantes - b.dias_restantes);
  vencidos.sort((a, b) => b.dias_vencido - a.dias_vencido);
  sobrestock.sort((a, b) => (b.dias_en_stock ?? 0) - (a.dias_en_stock ?? 0));

  return {
    reponer, sobrestock, por_vencer: porVencer, vencidos,
    total: reponer.length + sobrestock.length + porVencer.length + vencidos.length,
  };
}
