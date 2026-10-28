// "Fotos" de un registro antes y después de una operación, para que la auditoría guarde qué cambió
// (por ejemplo precio: 4500 → 5200). Se asocian por ruta en INSTANTANEAS; para auditar el antes/después
// de una ruta nueva alcanza con agregar una línea acá. Si una foto falla, la operación sigue igual.
import { db } from '../../db.js';

const una = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
const porId = (sql) => (params) => una(sql, [Number(params.id)]);

const producto = async (params) => {
  const fila = await una('SELECT nombre, categoria, precio, destino, activo, descripcion FROM producto WHERE id = $1', [Number(params.id)]);
  if (!fila) return null;
  const { rows } = await db.query(
    `SELECT i.nombre, d.cantidad, i.unidad FROM detalle_receta d JOIN insumo i ON i.id = d.id_insumo WHERE d.id_producto = $1 ORDER BY i.nombre`,
    [Number(params.id)],
  );
  return { ...fila, receta: rows.map((r) => `${r.nombre} ${r.cantidad}${r.unidad}`).join(' · ') };
};

export const INSTANTANEAS = {
  'PATCH /productos/:id': producto,
  'DELETE /productos/:id': producto,
  'PUT /productos/:id/receta': producto,
  'PATCH /productos/:id/precio': producto,
  'PATCH /usuarios/:id': porId('SELECT nombre, email, rol, activo, contrasena FROM usuario WHERE id = $1'),
  'PATCH /insumos/:id': porId('SELECT nombre, unidad, costo_unitario, stock_minimo, stock_maximo, dias_aviso_vencimiento, id_proveedor, activo FROM insumo WHERE id = $1'),
  'DELETE /insumos/:id': porId('SELECT nombre, activo FROM insumo WHERE id = $1'),
  'PATCH /proveedores/:id': porId('SELECT nombre, contacto, telefono, notas, activo FROM proveedor WHERE id = $1'),
  'PATCH /mesas/:id': porId('SELECT nombre, zona, capacidad, activo FROM mesa WHERE id = $1'),
  'PATCH /fichajes/:id': porId('SELECT id_usuario, turno, ingreso, egreso, nota FROM fichaje WHERE id = $1'),
  'POST /fichajes/:id/cerrar': porId('SELECT egreso FROM fichaje WHERE id = $1'),
  'DELETE /caja/cierres/:id': porId('SELECT fecha_jornada, canal, ventas_total, efectivo_contado, diferencia FROM cierre_caja WHERE id = $1'),
  'DELETE /pedido-items/:id': porId('SELECT id_pedido, nombre, cantidad, precio_unitario, estado FROM item_pedido WHERE id = $1'),
};
