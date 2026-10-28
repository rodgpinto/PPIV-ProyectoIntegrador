import { config } from '../../config.js';
import { db } from '../../db.js';
import { rangoDeJornadas } from '../../domain/ventas.js';
import { sumarDias, diasEntre } from '../../domain/fechas.js';
import { comprasSugeridas, compararPeriodos, consumoRealVsTeorico, rentabilidad, resumenMermas, valorizarStock } from '../../domain/informes.js';
import { reporte } from '../ventas/ventas.servicio.js';

const zona = config.zonaHoraria;
const hora = config.jornadaInicioHora;

const insumosTodos = async () => (await db.query('SELECT id, nombre, unidad, costo_unitario, stock_actual FROM insumo')).rows;

/** Movimientos del período ya sumados por insumo, tipo, motivo y costo (alcanza para valorizar y es liviano). */
async function movimientos(desde, hasta, tipos) {
  const { inicio, fin } = rangoDeJornadas(desde, hasta, zona, hora);
  const marcas = tipos.map((_, i) => `$${i + 3}`).join(', ');
  const { rows } = await db.query(
    `SELECT id_insumo, tipo, motivo, costo_unitario, SUM(cantidad) AS cantidad
       FROM movimiento_stock
      WHERE fecha_hora >= $1 AND fecha_hora < $2 AND tipo IN (${marcas})
      GROUP BY id_insumo, tipo, motivo, costo_unitario`,
    [inicio, fin, ...tipos],
  );
  return rows;
}

export async function consumo(desde, hasta) {
  const [movs, insumos] = await Promise.all([movimientos(desde, hasta, ['venta', 'reversion', 'merma', 'ajuste']), insumosTodos()]);
  return { desde, hasta, ...consumoRealVsTeorico(movs, insumos) };
}

export async function stockYMermas(desde, hasta) {
  const [insumos, { rows: lotes }, movs, ventas] = await Promise.all([
    insumosTodos(),
    db.query('SELECT id_insumo, cantidad_actual, costo_unitario FROM lote_insumo WHERE cantidad_actual > 0'),
    movimientos(desde, hasta, ['merma']),
    reporte(desde, hasta),
  ]);
  return {
    desde, hasta,
    stock: valorizarStock(insumos, lotes),
    mermas: resumenMermas(movs, insumos, ventas.resumen.ventas),
    ventas: ventas.resumen.ventas,
  };
}

export async function compras({ dias = 14, diasCobertura = 7 } = {}, ahora = new Date()) {
  const hasta = new Date(ahora).toISOString();
  const desde = new Date(new Date(ahora).getTime() - dias * 86_400_000).toISOString();
  const [{ rows: insumos }, { rows: pres }, { rows: proveedores }, { rows: usos }] = await Promise.all([
    db.query('SELECT id, nombre, unidad, stock_actual, stock_minimo, stock_maximo, costo_unitario, id_proveedor FROM insumo WHERE activo'),
    db.query('SELECT id_insumo, nombre, cantidad, principal FROM presentacion_insumo'),
    db.query('SELECT id, nombre, contacto, telefono FROM proveedor'),
    db.query(
      `SELECT id_insumo, SUM(cantidad) AS cantidad FROM movimiento_stock
        WHERE fecha_hora >= $1 AND fecha_hora < $2 AND tipo IN ('venta', 'reversion') GROUP BY id_insumo`,
      [desde, hasta],
    ),
  ]);
  const consumos = new Map(usos.map((u) => [u.id_insumo, Math.max(0, -u.cantidad)]));
  const conPres = insumos.map((i) => ({ ...i, presentaciones: pres.filter((p) => p.id_insumo === i.id) }));
  return comprasSugeridas({ insumos: conPres, consumos, proveedores, dias, diasCobertura });
}

export async function rentabilidadDe(desde, hasta) {
  const r = await reporte(desde, hasta);
  return { desde, hasta, resumen: r.resumen, ...rentabilidad(r.por_producto) };
}

/** Período anterior de la misma duración que desde..hasta. */
export function periodoAnterior(desde, hasta) {
  const largo = diasEntre(desde, hasta) + 1;
  return { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1) };
}

export async function comparar(actual, previo) {
  const [a, b] = await Promise.all([reporte(actual.desde, actual.hasta), reporte(previo.desde, previo.hasta)]);
  return { actual, previo, ...compararPeriodos(a, b) };
}

