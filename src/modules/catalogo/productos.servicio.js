import { db } from '../../db.js';
import { aplicarPorcentaje, calcularMargen, costoDeReceta, precioParaMargen } from '../../domain/costos.js';
import { HttpError } from '../../http/errores.js';
import { armarSet, marcadores } from './util.js';

const BASICAS = 'id, nombre, descripcion, categoria, precio, destino, activo';

function lineasPorProducto(lineas) {
  const por = new Map();
  for (const l of lineas) {
    if (!por.has(l.id_producto)) por.set(l.id_producto, []);
    por.get(l.id_producto).push(l);
  }
  return por;
}

function conCosto(producto, items) {
  if (!items.length) return { ...producto, tiene_receta: false, costo: null, costo_incompleto: false, margen: null, margen_pct: null };
  const { costo, incompleto } = costoDeReceta(items);
  return { ...producto, tiene_receta: true, costo, costo_incompleto: incompleto, ...calcularMargen(producto.precio, costo) };
}

const SQL_LINEAS = `SELECT dr.id_producto, dr.id_insumo, dr.cantidad, i.nombre AS insumo, i.unidad, i.costo_unitario
                      FROM detalle_receta dr JOIN insumo i ON i.id = dr.id_insumo`;

export async function carta() {
  const { rows } = await db.query('SELECT id, nombre, descripcion, categoria, precio FROM producto WHERE activo ORDER BY categoria, nombre');
  const grupos = new Map();
  for (const { categoria, ...item } of rows) {
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(item);
  }
  return [...grupos].map(([categoria, items]) => ({ categoria, items }));
}

export async function listarBasico() {
  return (await db.query(`SELECT ${BASICAS} FROM producto WHERE activo ORDER BY categoria, nombre`)).rows;
}

/** Listado para el administrador: con costo de receta y margen de cada plato. */
export async function listarConCostos({ incluirInactivos = false } = {}) {
  const productos = (await db.query(`SELECT ${BASICAS} FROM producto ${incluirInactivos ? '' : 'WHERE activo'} ORDER BY categoria, nombre`)).rows;
  const por = lineasPorProducto((await db.query(SQL_LINEAS)).rows);
  return productos.map((p) => conCosto(p, por.get(p.id) ?? []));
}

export async function obtener(id) {
  const { rows } = await db.query(`SELECT ${BASICAS} FROM producto WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Producto no encontrado');
  const lineas = (await db.query(`${SQL_LINEAS} WHERE dr.id_producto = $1 ORDER BY i.nombre`, [id])).rows;
  const receta = lineas.map((l) => ({ ...l, costo_linea: Math.round(l.cantidad * l.costo_unitario * 100) / 100 }));
  return { ...conCosto(rows[0], lineas), receta };
}

async function validarInsumos(tx, items) {
  if (!items.length) return;
  const ids = items.map((i) => i.id_insumo);
  const { rows } = await tx.query(`SELECT id FROM insumo WHERE activo AND id IN (${marcadores(ids.length)})`, ids);
  if (rows.length !== ids.length) throw new HttpError(422, 'La receta incluye insumos inexistentes o dados de baja');
}

async function escribirReceta(tx, idProducto, items) {
  await validarInsumos(tx, items);
  await tx.query('DELETE FROM detalle_receta WHERE id_producto = $1', [idProducto]);
  for (const { id_insumo, cantidad } of items) {
    await tx.query('INSERT INTO detalle_receta (id_producto, id_insumo, cantidad) VALUES ($1, $2, $3)', [idProducto, id_insumo, cantidad]);
  }
}

function duplicado(error) {
  if (error.code === '23505') throw new HttpError(409, 'Ya existe un producto con ese nombre');
  throw error;
}

export async function crear({ nombre, descripcion = '', categoria, precio, destino, receta = [] }) {
  try {
    const id = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        'INSERT INTO producto (nombre, descripcion, categoria, precio, destino) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [nombre, descripcion, categoria, precio, destino],
      );
      await escribirReceta(tx, rows[0].id, receta);
      return rows[0].id;
    });
    return obtener(id);
  } catch (error) {
    return duplicado(error);
  }
}

/** Datos del producto. El precio NO se cambia por acá: ver cambiarPrecio / ajustarPrecios. */
export async function actualizar(id, datos) {
  const { sql, valores, cantidad } = armarSet(datos);
  if (!cantidad) throw new HttpError(400, 'No hay nada para actualizar');
  try {
    const { rowCount } = await db.query(`UPDATE producto SET ${sql} WHERE id = $${cantidad + 1}`, [...valores, id]);
    if (!rowCount) throw new HttpError(404, 'Producto no encontrado');
  } catch (error) {
    return duplicado(error);
  }
  return obtener(id);
}

export const darDeBaja = (id) => actualizar(id, { activo: false });

export async function reemplazarReceta(id, items) {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query('SELECT id FROM producto WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Producto no encontrado');
    await escribirReceta(tx, id, items);
  });
  return obtener(id);
}

export async function cambiarPrecio(id, precio) {
  const { rows } = await db.query(`UPDATE producto SET precio = $1 WHERE id = $2 RETURNING ${BASICAS}`, [precio, id]);
  if (!rows[0]) throw new HttpError(404, 'Producto no encontrado');
  return rows[0];
}

/** Precios finales de varios platos, todo o nada. */
export async function actualizarPrecios(lista) {
  return db.transaction(async (tx) => {
    const salida = [];
    for (const { id, precio } of lista) {
      const { rows } = await tx.query(`UPDATE producto SET precio = $1 WHERE id = $2 RETURNING ${BASICAS}`, [precio, id]);
      if (!rows[0]) throw new HttpError(404, `El producto ${id} no existe; no se aplicó ningún cambio`);
      salida.push(rows[0]);
    }
    return salida;
  });
}

/**
 * Ajuste masivo de precios. modo 'porcentaje': sube o baja un % (valor 10 = +10%).
 * modo 'margen': fija el precio para que el plato deje ese % de margen sobre su costo de receta.
 * Sin `aplicar` es una vista previa: no cambia nada.
 */
export async function ajustarPrecios({ modo, valor, ids, categoria, aplicar = false, paso = 1 }) {
  if (modo === 'porcentaje' && valor <= -100) throw new HttpError(400, 'El porcentaje tiene que ser mayor a -100');
  if (modo === 'margen' && !(valor >= 0 && valor < 100)) throw new HttpError(400, 'El margen tiene que estar entre 0 y 99,9');

  const todos = (await listarConCostos()).filter((p) => (!ids?.length || ids.includes(p.id)) && (!categoria || p.categoria === categoria));
  const cambios = [];
  const omitidos = [];
  for (const p of todos) {
    let nuevo;
    if (modo === 'porcentaje') {
      nuevo = aplicarPorcentaje(p.precio, valor, paso);
    } else if (!p.tiene_receta) {
      omitidos.push({ id: p.id, nombre: p.nombre, motivo: 'No tiene receta' });
      continue;
    } else if (p.costo_incompleto) {
      omitidos.push({ id: p.id, nombre: p.nombre, motivo: 'Faltan costos de algún insumo de la receta' });
      continue;
    } else {
      nuevo = precioParaMargen(p.costo, valor, paso);
    }
    cambios.push({
      id: p.id, nombre: p.nombre, categoria: p.categoria,
      precio_actual: p.precio, precio_nuevo: nuevo,
      costo: p.costo, margen_pct_actual: p.margen_pct,
      margen_pct_nuevo: p.tiene_receta && !p.costo_incompleto ? calcularMargen(nuevo, p.costo).margen_pct : null,
    });
  }

  const aCambiar = cambios.filter((c) => c.precio_nuevo !== c.precio_actual);
  if (aplicar && aCambiar.length) {
    await db.transaction(async (tx) => {
      for (const c of aCambiar) await tx.query('UPDATE producto SET precio = $1 WHERE id = $2', [c.precio_nuevo, c.id]);
    });
  }
  return { aplicado: Boolean(aplicar), cambios, omitidos };
}
