import { config } from '../../config.js';
import { db } from '../../db.js';
import { ESTADOS_ACTIVOS, puedeCambiar, totalDe, transicionValida } from '../../domain/pedidos.js';
import { jornadaDe, rangoDeJornadas } from '../../domain/ventas.js';
import { redondear3 } from '../../domain/stock-fefo.js';
import { HttpError } from '../../http/errores.js';
import { marcadores } from '../catalogo/util.js';
import { consumirInsumo, revertirVenta } from '../stock/stock.servicio.js';

const iso = (d) => d.toISOString();

/* ---------- lectura ---------- */

const COLUMNAS_PEDIDO = `p.id, p.canal, p.id_mesa, m.nombre AS mesa, p.etiqueta, p.estado, p.id_usuario, u.nombre AS mozo,
  p.creado_en, p.cerrado_en, p.total, p.medio_pago`;
const DESDE_PEDIDO = 'FROM pedido p LEFT JOIN mesa m ON m.id = p.id_mesa JOIN usuario u ON u.id = p.id_usuario';
const COLUMNAS_ITEM = `id, id_pedido, id_producto, nombre, destino, cantidad, precio_unitario, nota, estado,
  creado_en, preparando_en, listo_en, entregado_en`;

/** Devuelve las cuentas con sus líneas y el total. `consulta` es db.query o el query de una transacción. */
async function leerPedidos(consulta, where, params = [], { limite = 200, orden = 'p.creado_en, p.id' } = {}) {
  const { rows: pedidos } = await consulta(
    `SELECT ${COLUMNAS_PEDIDO} ${DESDE_PEDIDO} WHERE ${where} ORDER BY ${orden} LIMIT ${Number(limite)}`, params,
  );
  if (!pedidos.length) return [];
  const { rows: items } = await consulta(
    `SELECT ${COLUMNAS_ITEM} FROM item_pedido WHERE id_pedido IN (${marcadores(pedidos.length)}) ORDER BY id`,
    pedidos.map((p) => p.id),
  );
  return pedidos.map((p) => {
    const suyos = items.filter((i) => i.id_pedido === p.id);
    return { ...p, items: suyos, total: p.estado === 'cerrado' ? p.total : totalDe(suyos) };
  });
}

/** Cuentas abiertas, o las cobradas en la noche comercial en curso (06:00 a 06:00). */
export function listar(estado, ahora = new Date()) {
  if (estado !== 'cerrado') return leerPedidos(db.query, "p.estado = 'abierto'");
  const noche = jornadaDe(ahora, config.zonaHoraria, config.jornadaInicioHora);
  const { inicio, fin } = rangoDeJornadas(noche, noche, config.zonaHoraria, config.jornadaInicioHora);
  return leerPedidos(db.query, "p.estado = 'cerrado' AND p.cerrado_en >= $1 AND p.cerrado_en < $2", [inicio, fin], { limite: 200, orden: 'p.cerrado_en DESC, p.id DESC' });
}

export async function obtener(id, consulta = db.query) {
  const [p] = await leerPedidos(consulta, 'p.id = $1', [id]);
  if (!p) throw new HttpError(404, 'Cuenta no encontrada');
  return p;
}

/** Cola de un destino (barra o cocina): líneas pendientes, en preparación y listas para llevar. */
export async function cola(destino, ahora) {
  const { rows } = await db.query(
    `SELECT ip.id, ip.id_pedido, ip.id_producto, ip.nombre, ip.destino, ip.cantidad, ip.nota, ip.estado,
            ip.creado_en, ip.preparando_en, ip.listo_en, p.canal, p.etiqueta, m.nombre AS mesa, u.nombre AS mozo
       FROM item_pedido ip
       JOIN pedido p ON p.id = ip.id_pedido
       LEFT JOIN mesa m ON m.id = p.id_mesa
       JOIN usuario u ON u.id = p.id_usuario
      WHERE ip.destino = $1 AND ip.estado IN (${ESTADOS_ACTIVOS.map((e) => `'${e}'`).join(', ')}) AND p.estado = 'abierto'
      ORDER BY ip.creado_en, ip.id`,
    [destino],
  );
  return { destino, ahora: iso(ahora), items: rows };
}

/* ---------- altas ---------- */

/** Agrega líneas a una cuenta abierta y descuenta del stock lo que lleva cada receta. Dentro de una transacción. */
async function agregarItems(tx, idPedido, items, usuario, ahora) {
  const idsProducto = [...new Set(items.map((i) => i.id_producto))];
  const { rows: productos } = await tx.query(
    `SELECT id, nombre, destino, precio FROM producto WHERE activo AND id IN (${marcadores(idsProducto.length)})`, idsProducto,
  );
  const faltan = idsProducto.filter((id) => !productos.some((p) => p.id === id));
  if (faltan.length) throw new HttpError(422, 'Hay productos que no existen o están dados de baja', { productos: faltan });

  const { rows: recetas } = await tx.query(
    `SELECT dr.id_producto, dr.id_insumo, dr.cantidad, i.costo_unitario
       FROM detalle_receta dr JOIN insumo i ON i.id = dr.id_insumo
      WHERE dr.id_producto IN (${marcadores(idsProducto.length)}) ORDER BY dr.id_insumo`,
    idsProducto,
  );
  // Se bloquean todos los insumos juntos y siempre en el mismo orden, para que dos pedidos simultáneos no se traben entre sí.
  const idsInsumo = [...new Set(recetas.map((r) => r.id_insumo))].sort((a, b) => a - b);
  if (idsInsumo.length) await tx.query(`SELECT id FROM insumo WHERE id IN (${idsInsumo.join(',')}) ORDER BY id FOR UPDATE`);

  const sinStock = new Map();
  const creados = [];
  for (const it of items) {
    const p = productos.find((x) => x.id === it.id_producto);
    const receta = recetas.filter((r) => r.id_producto === p.id);
    const costo = receta.length ? Math.round(receta.reduce((s, r) => s + r.cantidad * r.costo_unitario, 0) * 100) / 100 : null;
    const { rows } = await tx.query(
      `INSERT INTO item_pedido (id_pedido, id_producto, nombre, destino, cantidad, precio_unitario, costo_unitario, nota, creado_en, id_usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [idPedido, p.id, p.nombre, p.destino, it.cantidad, p.precio, costo, it.nota ?? '', iso(ahora), usuario.id],
    );
    creados.push(rows[0].id);
    for (const r of receta) {
      const c = await consumirInsumo(tx, {
        id_insumo: r.id_insumo, cantidad: redondear3(r.cantidad * it.cantidad), tipo: 'venta', referencia: `item:${rows[0].id}`, id_usuario: usuario.id,
      });
      if (c.faltante > 0) sinStock.set(r.id_insumo, { id_insumo: r.id_insumo, nombre: c.nombre, unidad: c.unidad, faltante: redondear3((sinStock.get(r.id_insumo)?.faltante ?? 0) + c.faltante) });
    }
  }
  return { creados, sin_stock: [...sinStock.values()] };
}

export async function crear({ canal, id_mesa, etiqueta, items }, usuario, ahora) {
  if (canal === 'mesa' && !id_mesa) throw new HttpError(400, 'Elegí la mesa');
  if (canal === 'barra' && id_mesa) throw new HttpError(400, 'Una cuenta de barra no lleva mesa');
  return db.transaction(async (tx) => {
    if (canal === 'mesa') {
      const { rows: mesa } = await tx.query('SELECT id, estado FROM mesa WHERE id = $1 AND activo FOR UPDATE', [id_mesa]);
      if (!mesa[0]) throw new HttpError(404, 'La mesa no existe o está dada de baja');
      const { rows: abierta } = await tx.query("SELECT id FROM pedido WHERE id_mesa = $1 AND estado = 'abierto'", [id_mesa]);
      if (abierta[0]) throw new HttpError(409, 'Esa mesa ya tiene una cuenta abierta', { id_pedido: abierta[0].id });
      if (mesa[0].estado !== 'ocupada') await tx.query("UPDATE mesa SET estado = 'ocupada', estado_desde = $1 WHERE id = $2", [iso(ahora), id_mesa]);
    }
    const { rows } = await tx.query(
      'INSERT INTO pedido (canal, id_mesa, etiqueta, id_usuario, creado_en) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [canal, canal === 'mesa' ? id_mesa : null, etiqueta ?? '', usuario.id, iso(ahora)],
    );
    const { sin_stock } = await agregarItems(tx, rows[0].id, items, usuario, ahora);
    return { ...(await obtener(rows[0].id, tx.query)), sin_stock };
  });
}

async function pedidoAbierto(tx, id) {
  const { rows } = await tx.query('SELECT id, estado, canal, id_mesa FROM pedido WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new HttpError(404, 'Cuenta no encontrada');
  if (rows[0].estado !== 'abierto') throw new HttpError(409, 'La cuenta ya está cerrada');
  return rows[0];
}

export async function agregar(id, items, usuario, ahora) {
  return db.transaction(async (tx) => {
    await pedidoAbierto(tx, id);
    const { sin_stock } = await agregarItems(tx, id, items, usuario, ahora);
    return { ...(await obtener(id, tx.query)), sin_stock };
  });
}

/* ---------- cambios de estado ---------- */

/** Mueve varias líneas a un mismo estado, todas o ninguna. Valida el paso y que el rol pueda darlo. */
export async function cambiarEstado(ids, a, usuario, ahora) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT ip.id, ip.estado, ip.destino, p.estado AS estado_pedido
         FROM item_pedido ip JOIN pedido p ON p.id = ip.id_pedido
        WHERE ip.id IN (${marcadores(ids.length)}) ORDER BY ip.id FOR UPDATE`, ids,
    );
    if (rows.length !== ids.length) throw new HttpError(404, 'Alguna de las líneas no existe');
    for (const it of rows) {
      if (it.estado_pedido !== 'abierto') throw new HttpError(409, 'La cuenta ya está cerrada');
      if (!puedeCambiar({ rol: usuario.rol, destino: it.destino, a })) throw new HttpError(403, 'No tenés permiso para este cambio');
      if (!transicionValida(it.estado, a)) throw new HttpError(409, `No se puede pasar de "${it.estado}" a "${a}". Actualizá la pantalla: puede que alguien ya lo haya cambiado`);
    }
    const t = iso(ahora);
    const marcas = {
      pendiente: 'preparando_en = NULL, listo_en = NULL, entregado_en = NULL',
      preparando: `preparando_en = $2, listo_en = NULL`,
      listo: 'listo_en = $2',
      entregado: 'entregado_en = $2',
    }[a];
    await tx.query(
      `UPDATE item_pedido SET estado = $1, ${marcas} WHERE id IN (${marcadores(ids.length, a === 'pendiente' ? 2 : 3)})`,
      a === 'pendiente' ? [a, ...ids] : [a, t, ...ids],
    );
    return { cambiadas: ids.length, estado: a };
  });
}

/**
 * Anula una línea. Mientras esté pendiente vuelve al stock lo que se había descontado.
 * Si ya se empezó a preparar los ingredientes se usaron: solo el administrador puede anularla y el stock no se devuelve
 * (corresponde registrarlo como merma si se tiró).
 */
export async function anularItem(id, usuario, ahora, hoy) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT ip.id, ip.id_pedido, ip.estado, p.estado AS estado_pedido
         FROM item_pedido ip JOIN pedido p ON p.id = ip.id_pedido WHERE ip.id = $1 FOR UPDATE`, [id],
    );
    const it = rows[0];
    if (!it) throw new HttpError(404, 'La línea no existe');
    if (it.estado_pedido !== 'abierto') throw new HttpError(409, 'La cuenta ya está cerrada');
    if (it.estado === 'anulado') throw new HttpError(409, 'La línea ya estaba anulada');
    if (it.estado === 'entregado') throw new HttpError(409, 'Ya se entregó: no se puede anular');
    if (it.estado !== 'pendiente' && usuario.rol !== 'administrador') {
      throw new HttpError(403, 'Ya se empezó a preparar: pedile al administrador que la anule');
    }
    if (it.estado === 'pendiente') {
      const { rows: movs } = await tx.query("SELECT DISTINCT id_insumo FROM movimiento_stock WHERE referencia = $1 AND tipo = 'venta'", [`item:${id}`]);
      const idsInsumo = movs.map((m) => m.id_insumo).sort((a, b) => a - b);
      if (idsInsumo.length) await tx.query(`SELECT id FROM insumo WHERE id IN (${idsInsumo.join(',')}) ORDER BY id FOR UPDATE`);
      await revertirVenta(tx, { referencia: `item:${id}`, id_usuario: usuario.id, hoy });
    }
    await tx.query("UPDATE item_pedido SET estado = 'anulado' WHERE id = $1", [id]);
    return obtener(it.id_pedido, tx.query);
  });
}

/* ---------- cierre ---------- */

export async function cerrar(id, { medio_pago }, usuario, ahora) {
  return db.transaction(async (tx) => {
    const p = await pedidoAbierto(tx, id);
    const { rows: items } = await tx.query(`SELECT ${COLUMNAS_ITEM} FROM item_pedido WHERE id_pedido = $1`, [id]);
    const vivos = items.filter((i) => i.estado !== 'anulado');
    if (!vivos.length) throw new HttpError(409, 'La cuenta no tiene consumos: cancelala en lugar de cobrarla');
    const sinEntregar = vivos.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando');
    if (sinEntregar.length) {
      throw new HttpError(409, 'Todavía hay pedidos sin terminar. Esperá a que estén listos o anulalos antes de cobrar', { items: sinEntregar.map((i) => i.id) });
    }
    const jornada = jornadaDe(ahora, config.zonaHoraria, config.jornadaInicioHora);
    // Solo cuenta la caja de este canal (salón o barra), o la de toda la noche
    const { rows: cierre } = await tx.query('SELECT id FROM cierre_caja WHERE fecha_jornada = $1 AND canal IN ($2, $3)', [jornada, p.canal, 'todos']);
    if (cierre[0]) throw new HttpError(409, `La caja ${p.canal === 'barra' ? 'de la barra' : p.canal === 'mesa' ? 'del salón' : ''} de esta jornada ya está cerrada. El administrador puede reabrirla para seguir cobrando`.replace('  ', ' '), { fecha_jornada: jornada });
    const t = iso(ahora);
    // Lo que estaba listo y se cobra se da por entregado
    await tx.query("UPDATE item_pedido SET estado = 'entregado', entregado_en = $1 WHERE id_pedido = $2 AND estado = 'listo'", [t, id]);
    await tx.query(
      "UPDATE pedido SET estado = 'cerrado', cerrado_en = $1, total = $2, medio_pago = $3, id_cobrador = $4 WHERE id = $5",
      [t, totalDe(vivos), medio_pago, usuario.id, id],
    );
    if (p.id_mesa) await tx.query("UPDATE mesa SET estado = 'libre', estado_desde = $1 WHERE id = $2", [t, p.id_mesa]);
    return obtener(id, tx.query);
  });
}

/** Cuenta abierta sin consumos (se abrió por error o la mesa se fue sin pedir). */
export async function cancelar(id, ahora) {
  return db.transaction(async (tx) => {
    const p = await pedidoAbierto(tx, id);
    const { rows } = await tx.query("SELECT id FROM item_pedido WHERE id_pedido = $1 AND estado <> 'anulado'", [id]);
    if (rows.length) throw new HttpError(409, 'La cuenta tiene consumos: anulá las líneas pendientes o cobrala');
    await tx.query("UPDATE pedido SET estado = 'cancelado', cerrado_en = $1 WHERE id = $2", [iso(ahora), id]);
    if (p.id_mesa) await tx.query("UPDATE mesa SET estado = 'libre', estado_desde = $1 WHERE id = $2", [iso(ahora), p.id_mesa]);
    return obtener(id, tx.query);
  });
}

/* ---------- pasar cuentas entre mesas ---------- */

const nombreMesa = async (tx, id) => (id ? (await tx.query('SELECT nombre FROM mesa WHERE id = $1', [id])).rows[0]?.nombre ?? null : null);

async function mesaActiva(tx, id) {
  const { rows } = await tx.query('SELECT id, nombre, estado FROM mesa WHERE id = $1 AND activo FOR UPDATE', [id]);
  if (!rows[0]) throw new HttpError(404, 'La mesa no existe o está dada de baja');
  return rows[0];
}

const ocuparMesa = (tx, id, t) => tx.query("UPDATE mesa SET estado = 'ocupada', estado_desde = $1 WHERE id = $2 AND estado <> 'ocupada'", [t, id]);
const liberarMesa = (tx, id, t) => id && tx.query("UPDATE mesa SET estado = 'libre', estado_desde = $1 WHERE id = $2", [t, id]);

/** Bloquea las cuentas en orden de id (dos movimientos simultáneos no se traban entre sí) y verifica que estén abiertas. */
async function bloquearAbiertas(tx, ids) {
  const salida = {};
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) salida[id] = await pedidoAbierto(tx, id);
  return salida;
}

/**
 * Pasa una cuenta entera a otra mesa. Si la mesa de destino ya tiene una cuenta abierta hay que pedir `unir`: las líneas
 * se suman a esa cuenta y la de origen queda cancelada. La barra también puede pasar a una mesa (el cliente se sentó).
 * Las líneas no se tocan: la pantalla de cocina y el stock siguen apuntando a las mismas, solo cambia la mesa que se muestra.
 */
export async function moverCuenta(id, { id_mesa, unir = false }, ahora) {
  return db.transaction(async (tx) => {
    const t = iso(ahora);
    const { rows: pre } = await tx.query('SELECT id_mesa FROM pedido WHERE id = $1', [id]);
    if (!pre[0]) throw new HttpError(404, 'Cuenta no encontrada');
    const { rows: previa } = await tx.query("SELECT id FROM pedido WHERE id_mesa = $1 AND estado = 'abierto'", [id_mesa]);
    const bloqueadas = await bloquearAbiertas(tx, [id, ...(previa[0] ? [previa[0].id] : [])]);
    const origen = bloqueadas[id];
    if (origen.id_mesa === id_mesa) throw new HttpError(400, 'La cuenta ya está en esa mesa');
    const destino = await mesaActiva(tx, id_mesa);
    const desde = await nombreMesa(tx, origen.id_mesa);

    const ocupante = previa[0] ? bloqueadas[previa[0].id] : null;
    // Pudo abrirse una cuenta en la mesa mientras se esperaba el bloqueo
    const { rows: actual } = await tx.query("SELECT id FROM pedido WHERE id_mesa = $1 AND estado = 'abierto'", [id_mesa]);
    if (actual[0] && actual[0].id !== ocupante?.id) throw new HttpError(409, 'La mesa cambió mientras tanto: probá de nuevo');

    if (ocupante) {
      if (!unir) throw new HttpError(409, `La mesa ${destino.nombre} ya tiene una cuenta abierta. Si querés juntarlas, confirmá que se unan`, { id_pedido: ocupante.id, puede_unir: true });
      await tx.query('UPDATE item_pedido SET id_pedido = $1 WHERE id_pedido = $2', [ocupante.id, id]);
      await tx.query("UPDATE pedido SET estado = 'cancelado', cerrado_en = $1 WHERE id = $2", [t, id]);
      await liberarMesa(tx, origen.id_mesa, t);
      return { pedido: await obtener(ocupante.id, tx.query), desde, hacia: destino.nombre, unida: true, id_origen: id };
    }
    await tx.query("UPDATE pedido SET canal = 'mesa', id_mesa = $1, etiqueta = '' WHERE id = $2", [id_mesa, id]);
    await ocuparMesa(tx, id_mesa, t);
    await liberarMesa(tx, origen.id_mesa, t);
    return { pedido: await obtener(id, tx.query), desde: desde ?? `Barra${origen.etiqueta ? ` (${origen.etiqueta})` : ''}`, hacia: destino.nombre, unida: false, id_origen: id };
  });
}

/**
 * Pasa líneas sueltas a otra cuenta: para dividir lo que se pide en una mesa, o corregir que se cargó en la mesa equivocada.
 * El destino es una cuenta abierta (`id_pedido`) o una mesa (`id_mesa`): si la mesa tiene cuenta abierta se suma a esa y si no
 * se abre una nueva. Se mueven líneas enteras. Si en la cuenta de origen no queda nada para cobrar, se cancela y la mesa se libera.
 */
export async function moverItems(id, { ids, id_pedido, id_mesa }, usuario, ahora) {
  if (!id_pedido && !id_mesa) throw new HttpError(400, 'Elegí a qué cuenta o mesa pasarlas');
  return db.transaction(async (tx) => {
    const t = iso(ahora);
    let idDestino = id_pedido ?? null;
    if (!idDestino) {
      const { rows } = await tx.query("SELECT id FROM pedido WHERE id_mesa = $1 AND estado = 'abierto'", [id_mesa]);
      idDestino = rows[0]?.id ?? null;
    }
    if (idDestino === id) throw new HttpError(400, 'Esas líneas ya están en esa cuenta');
    const bloqueadas = await bloquearAbiertas(tx, [id, ...(idDestino ? [idDestino] : [])]);
    const origen = bloqueadas[id];

    const { rows: lineas } = await tx.query(
      `SELECT id, nombre, cantidad, estado FROM item_pedido WHERE id_pedido = $1 AND id IN (${marcadores(ids.length, 2)}) ORDER BY id`, [id, ...ids],
    );
    if (lineas.length !== ids.length) throw new HttpError(404, 'Alguna de las líneas no pertenece a esta cuenta');
    if (lineas.some((l) => l.estado === 'anulado')) throw new HttpError(409, 'No se pueden pasar líneas anuladas');

    let destino;
    let abierta = false;
    if (idDestino) {
      destino = bloqueadas[idDestino];
      if (id_mesa && destino.id_mesa !== id_mesa) throw new HttpError(409, 'La cuenta de esa mesa cambió: probá de nuevo');
    } else {
      await mesaActiva(tx, id_mesa);
      const { rows } = await tx.query('INSERT INTO pedido (canal, id_mesa, id_usuario, creado_en) VALUES ($1, $2, $3, $4) RETURNING id, canal, id_mesa', ['mesa', id_mesa, usuario.id, t]);
      destino = rows[0];
      idDestino = destino.id;
      abierta = true;
      await ocuparMesa(tx, id_mesa, t);
    }
    await tx.query(`UPDATE item_pedido SET id_pedido = $1 WHERE id IN (${marcadores(ids.length, 2)})`, [idDestino, ...ids]);

    const { rows: quedan } = await tx.query("SELECT id FROM item_pedido WHERE id_pedido = $1 AND estado <> 'anulado'", [id]);
    const vacia = quedan.length === 0;
    if (vacia) {
      await tx.query("UPDATE pedido SET estado = 'cancelado', cerrado_en = $1 WHERE id = $2", [t, id]);
      await liberarMesa(tx, origen.id_mesa, t);
    }
    return {
      origen: vacia ? null : await obtener(id, tx.query),
      pedido: await obtener(idDestino, tx.query),
      origen_cancelada: vacia,
      nueva: abierta,
      desde: (await nombreMesa(tx, origen.id_mesa)) ?? 'Barra',
      hacia: (await nombreMesa(tx, destino.id_mesa)) ?? 'Barra',
      lineas: lineas.map((l) => `${l.cantidad}× ${l.nombre}`),
    };
  });
}
