import { db } from '../../db.js';
import { normalizarPresentaciones } from '../../domain/presentaciones.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { MERMAS, ROLES, SOLO_ADMIN } from '../../roles.js';
import { armarSet } from './util.js';

const COLUMNAS = 'id, nombre, unidad, costo_unitario, stock_actual, stock_minimo, stock_maximo, dias_aviso_vencimiento, id_proveedor, activo';
const cantidad = v.numero({ min: 0, max: 1_000_000_000 });

const esquemaCrear = v.objeto({
  nombre: v.texto({ min: 1, max: 100 }),
  unidad: v.opcion(['ml', 'g', 'unidad']), // la unidad no se puede cambiar después: invalidaría recetas y stock
  costo_unitario: v.numero({ min: 0, max: 100_000_000, opcional: true }),
  stock_minimo: v.numero({ min: 0, max: 1_000_000_000, opcional: true }),
  stock_maximo: v.numero({ min: 0, max: 1_000_000_000, nulo: true }),
  dias_aviso_vencimiento: v.numero({ entero: true, min: 0, max: 365, opcional: true }),
  id_proveedor: v.numero({ entero: true, min: 1, nulo: true }),
});
const esquemaPresentaciones = v.objeto({
  presentaciones: v.lista(
    v.objeto({ nombre: v.texto({ min: 1, max: 60 }), cantidad: v.numero({ minExclusivo: 0, max: 1_000_000_000 }), principal: v.booleano({ opcional: true }) }),
    { max: 10 },
  ),
});
const esquemaActualizar = v.objeto({
  nombre: v.texto({ min: 1, max: 100 }),
  costo_unitario: v.numero({ min: 0, max: 100_000_000 }),
  stock_minimo: cantidad,
  stock_maximo: v.numero({ min: 0, max: 1_000_000_000, nulo: true }),
  dias_aviso_vencimiento: v.numero({ entero: true, min: 0, max: 365 }),
  id_proveedor: v.numero({ entero: true, min: 1, nulo: true }),
  activo: v.booleano(),
}, { parcial: true });

async function verificarProveedor(id) {
  if (id == null) return;
  const { rows } = await db.query('SELECT id FROM proveedor WHERE id = $1 AND activo', [id]);
  if (!rows[0]) throw new HttpError(422, 'El proveedor no existe o está dado de baja');
}

function traducirDuplicado(error) {
  if (error.code === '23505') throw new HttpError(409, 'Ya existe un insumo con ese nombre');
  throw error;
}

/** Agrega a cada insumo su lista de presentaciones (envases). */
async function conPresentaciones(insumos) {
  if (!insumos.length) return insumos;
  const { rows } = await db.query('SELECT id, id_insumo, nombre, cantidad, principal FROM presentacion_insumo ORDER BY id');
  return insumos.map((i) => ({ ...i, presentaciones: rows.filter((p) => p.id_insumo === i.id).map(({ id_insumo, ...p }) => p) }));
}

async function listar({ usuario, query }) {
  if (usuario.rol !== ROLES.ADMIN) {
    // Mermas: el personal solo necesita saber qué insumos existen; no ve costos ni stock
    return conPresentaciones((await db.query('SELECT id, nombre, unidad FROM insumo WHERE activo ORDER BY nombre')).rows);
  }
  const donde = query.incluir_inactivos === 'true' ? '' : 'WHERE i.activo';
  return conPresentaciones((await db.query(
    `SELECT i.id, i.nombre, i.unidad, i.costo_unitario, i.stock_actual, i.stock_minimo, i.stock_maximo,
            i.dias_aviso_vencimiento, i.id_proveedor, i.activo, p.nombre AS proveedor,
            (SELECT MIN(l.fecha_vencimiento) FROM lote_insumo l WHERE l.id_insumo = i.id AND l.cantidad_actual > 0) AS proximo_vencimiento
       FROM insumo i LEFT JOIN proveedor p ON p.id = i.id_proveedor
       ${donde} ORDER BY i.nombre`,
  )).rows);
}

/** Reemplaza las presentaciones de un insumo (todo o nada). */
async function reemplazarPresentaciones(id, { presentaciones }) {
  const { lista, error } = normalizarPresentaciones(presentaciones);
  if (error) throw new HttpError(400, error);
  await db.transaction(async (tx) => {
    const { rows } = await tx.query('SELECT id FROM insumo WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Insumo no encontrado');
    await tx.query('DELETE FROM presentacion_insumo WHERE id_insumo = $1', [id]);
    for (const p of lista) {
      await tx.query('INSERT INTO presentacion_insumo (id_insumo, nombre, cantidad, principal) VALUES ($1, $2, $3, $4)', [id, p.nombre, p.cantidad, p.principal]);
    }
  });
  const { rows } = await db.query('SELECT id, nombre, cantidad, principal FROM presentacion_insumo WHERE id_insumo = $1 ORDER BY id', [id]);
  return { id_insumo: id, presentaciones: rows };
}

async function crear(datos) {
  const d = { costo_unitario: 0, stock_minimo: 0, stock_maximo: null, dias_aviso_vencimiento: 7, id_proveedor: null, ...datos };
  if (d.stock_maximo !== null && d.stock_maximo < d.stock_minimo) throw new HttpError(400, 'El stock máximo no puede ser menor que el mínimo');
  await verificarProveedor(d.id_proveedor);
  try {
    const { rows } = await db.query(
      `INSERT INTO insumo (nombre, unidad, costo_unitario, stock_minimo, stock_maximo, dias_aviso_vencimiento, id_proveedor)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNAS}`,
      [d.nombre, d.unidad, d.costo_unitario, d.stock_minimo, d.stock_maximo, d.dias_aviso_vencimiento, d.id_proveedor],
    );
    return rows[0];
  } catch (error) {
    return traducirDuplicado(error);
  }
}

async function actualizar(id, datos) {
  const { rows: actual } = await db.query(`SELECT ${COLUMNAS} FROM insumo WHERE id = $1`, [id]);
  if (!actual[0]) throw new HttpError(404, 'Insumo no encontrado');
  const fusion = { ...actual[0], ...datos };
  if (fusion.stock_maximo !== null && fusion.stock_maximo < fusion.stock_minimo) {
    throw new HttpError(400, 'El stock máximo no puede ser menor que el mínimo');
  }
  if ('id_proveedor' in datos) await verificarProveedor(datos.id_proveedor);
  if (datos.activo === false) {
    const { rows } = await db.query(
      `SELECT p.nombre FROM detalle_receta dr JOIN producto p ON p.id = dr.id_producto
        WHERE dr.id_insumo = $1 AND p.activo ORDER BY p.nombre`, [id]);
    if (rows.length) throw new HttpError(409, 'El insumo se usa en recetas de productos activos', { productos: rows.map((r) => r.nombre) });
  }
  const { sql, valores, cantidad: n } = armarSet(datos);
  if (!n) throw new HttpError(400, 'No hay nada para actualizar');
  try {
    const { rows } = await db.query(`UPDATE insumo SET ${sql} WHERE id = $${n + 1} RETURNING ${COLUMNAS}`, [...valores, id]);
    return rows[0];
  } catch (error) {
    return traducirDuplicado(error);
  }
}

/** Historial de compras de un insumo y último precio de cada proveedor (para comparar). */
async function compras(id) {
  const { rows: ins } = await db.query('SELECT id, nombre, unidad FROM insumo WHERE id = $1', [id]);
  if (!ins[0]) throw new HttpError(404, 'Insumo no encontrado');
  const { rows } = await db.query(
    `SELECT l.id, l.fecha_ingreso, l.fecha_vencimiento, l.cantidad_inicial, l.cantidad_actual, l.costo_unitario,
            l.id_proveedor, p.nombre AS proveedor
       FROM lote_insumo l LEFT JOIN proveedor p ON p.id = l.id_proveedor
      WHERE l.id_insumo = $1 AND l.origen = 'compra'
      ORDER BY l.fecha_ingreso DESC, l.id DESC`, [id]);
  const ultimoPorProveedor = new Map();
  for (const c of rows) {
    const clave = c.id_proveedor ?? 0;
    if (!ultimoPorProveedor.has(clave)) {
      ultimoPorProveedor.set(clave, { id_proveedor: c.id_proveedor, proveedor: c.proveedor ?? 'Sin proveedor', costo_unitario: c.costo_unitario, fecha: c.fecha_ingreso });
    }
  }
  const porProveedor = [...ultimoPorProveedor.values()].sort((a, b) => a.costo_unitario - b.costo_unitario);
  return { insumo: ins[0], compras: rows, por_proveedor: porProveedor };
}

export default [
  { metodo: 'GET', ruta: '/insumos', roles: MERMAS, handler: listar },
  { metodo: 'POST', ruta: '/insumos', roles: SOLO_ADMIN, status: 201, handler: ({ body }) => crear(validar(esquemaCrear, body)) },
  { metodo: 'PUT', ruta: '/insumos/:id/presentaciones', roles: SOLO_ADMIN, handler: ({ params, body }) => reemplazarPresentaciones(idDe(params.id), validar(esquemaPresentaciones, body)) },
  { metodo: 'PATCH', ruta: '/insumos/:id', roles: SOLO_ADMIN, handler: ({ params, body }) => actualizar(idDe(params.id), validar(esquemaActualizar, body)) },
  { metodo: 'DELETE', ruta: '/insumos/:id', roles: SOLO_ADMIN, handler: ({ params }) => actualizar(idDe(params.id), { activo: false }) },
  { metodo: 'GET', ruta: '/insumos/:id/compras', roles: SOLO_ADMIN, handler: ({ params }) => compras(idDe(params.id)) },
];
