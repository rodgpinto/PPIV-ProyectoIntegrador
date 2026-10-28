import { db } from '../../db.js';
import { calcularAlertas } from '../../domain/alertas.js';
import { costoUnitarioDeCompra } from '../../domain/costos.js';
import { asignarFefo, redondear3 } from '../../domain/stock-fefo.js';
import { HttpError } from '../../http/errores.js';

const SQL_INSUMO = 'SELECT id, nombre, unidad, costo_unitario, stock_actual FROM insumo WHERE id = $1 AND activo FOR UPDATE';

async function insumoActivo(tx, id) {
  const { rows } = await tx.query(SQL_INSUMO, [id]);
  if (!rows[0]) throw new HttpError(404, 'El insumo no existe o está dado de baja');
  return rows[0];
}

async function movimiento(tx, m) {
  await tx.query(
    `INSERT INTO movimiento_stock (tipo, id_insumo, id_lote, cantidad, costo_unitario, motivo, referencia, nota, id_usuario)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [m.tipo, m.id_insumo, m.id_lote ?? null, m.cantidad, m.costo_unitario ?? null, m.motivo ?? null, m.referencia ?? null, m.nota ?? null, m.id_usuario],
  );
}

/**
 * Descuenta stock de un insumo respetando FEFO (primero lo que vence antes). Se usa para mermas,
 * ajustes y, más adelante, para las ventas. Si no hay lotes suficientes el stock queda negativo
 * (supuesto S-16: se puede vender sin tener el ingreso registrado) y se informa el faltante.
 * Debe llamarse dentro de una transacción (`tx`).
 */
export async function consumirInsumo(tx, { id_insumo, cantidad, tipo, motivo = null, referencia = null, nota = null, id_usuario, id_lote = null }) {
  const insumo = await insumoActivo(tx, id_insumo);
  const { rows: lotes } = await tx.query(
    `SELECT id, cantidad_actual, fecha_vencimiento, fecha_ingreso, costo_unitario FROM lote_insumo
      WHERE id_insumo = $1 AND cantidad_actual > 0 ${id_lote ? 'AND id = $2' : ''}`,
    id_lote ? [id_insumo, id_lote] : [id_insumo],
  );
  if (id_lote && !lotes.length) throw new HttpError(404, 'El lote no existe o ya no tiene stock');
  const { asignaciones, faltante } = asignarFefo(lotes, cantidad);
  if (id_lote && faltante > 0) throw new HttpError(400, 'El lote no tiene esa cantidad');

  for (const a of asignaciones) {
    await tx.query('UPDATE lote_insumo SET cantidad_actual = ROUND(cantidad_actual - $1, 3) WHERE id = $2', [a.cantidad, a.id_lote]);
    await movimiento(tx, { tipo, id_insumo, id_lote: a.id_lote, cantidad: -a.cantidad, costo_unitario: a.costo_unitario, motivo, referencia, nota, id_usuario });
  }
  if (faltante > 0) {
    await movimiento(tx, { tipo, id_insumo, cantidad: -faltante, costo_unitario: insumo.costo_unitario, motivo, referencia, nota, id_usuario });
  }
  await tx.query('UPDATE insumo SET stock_actual = ROUND(stock_actual - $1, 3) WHERE id = $2', [redondear3(cantidad), id_insumo]);
  return { nombre: insumo.nombre, unidad: insumo.unidad, asignaciones, faltante, stock_anterior: insumo.stock_actual, stock_actual: redondear3(insumo.stock_actual - cantidad) };
}

/** Si el stock estaba en negativo (ventas sin ingreso), lo que entra primero cubre ese hueco. */
export const restanteTrasDeficit = (stockActual, entra) => redondear3(entra - Math.min(Math.max(0, -stockActual), entra));

/**
 * Deshace el consumo de una venta (por su referencia, p. ej. "item:42"). Lo que se devuelve cubre primero el hueco
 * que haya en ese momento (stock en negativo por ventas sin ingreso); el resto vuelve a los lotes de los que había
 * salido y, si ya no caben ahí, entra como un lote nuevo. Así la suma de los lotes sigue igual al stock.
 * Debe llamarse dentro de una transacción y con los insumos ya bloqueados.
 */
export async function revertirVenta(tx, { referencia, id_usuario, hoy, nota = 'Anulación de pedido' }) {
  const { rows: movs } = await tx.query(
    "SELECT id_insumo, id_lote, cantidad, costo_unitario FROM movimiento_stock WHERE referencia = $1 AND tipo = 'venta' ORDER BY id",
    [referencia],
  );
  const porInsumo = new Map();
  for (const m of movs) porInsumo.set(m.id_insumo, [...(porInsumo.get(m.id_insumo) ?? []), m]);

  for (const [id_insumo, lista] of porInsumo) {
    const total = redondear3(lista.reduce((suma, m) => suma - m.cantidad, 0));
    const { rows } = await tx.query('SELECT stock_actual, costo_unitario FROM insumo WHERE id = $1', [id_insumo]);
    let restante = restanteTrasDeficit(rows[0].stock_actual, total);
    const cubierto = redondear3(total - restante);
    if (cubierto > 0) {
      await movimiento(tx, { tipo: 'reversion', id_insumo, cantidad: cubierto, costo_unitario: lista[0].costo_unitario, referencia, nota, id_usuario });
    }
    for (const m of lista.filter((x) => x.id_lote)) {
      if (restante <= 0) break;
      const devolver = Math.min(restante, -m.cantidad);
      await tx.query('UPDATE lote_insumo SET cantidad_actual = ROUND(cantidad_actual + $1, 3) WHERE id = $2', [devolver, m.id_lote]);
      await movimiento(tx, { tipo: 'reversion', id_insumo, id_lote: m.id_lote, cantidad: devolver, costo_unitario: m.costo_unitario, referencia, nota, id_usuario });
      restante = redondear3(restante - devolver);
    }
    if (restante > 0) {
      const { rows: lote } = await tx.query(
        `INSERT INTO lote_insumo (id_insumo, origen, cantidad_inicial, cantidad_actual, costo_unitario, fecha_ingreso, id_usuario)
         VALUES ($1, 'ajuste', $2, $2, $3, $4, $5) RETURNING id`,
        [id_insumo, restante, rows[0].costo_unitario, hoy, id_usuario],
      );
      await movimiento(tx, { tipo: 'reversion', id_insumo, id_lote: lote[0].id, cantidad: restante, costo_unitario: rows[0].costo_unitario, referencia, nota, id_usuario });
    }
    await tx.query('UPDATE insumo SET stock_actual = ROUND(stock_actual + $1, 3) WHERE id = $2', [total, id_insumo]);
  }
  return movs.length;
}

export async function registrarIngreso(d, usuario, hoy) {
  const fechaIngreso = d.fecha_ingreso ?? hoy;
  if (fechaIngreso > hoy) throw new HttpError(400, 'La fecha de ingreso no puede ser futura');
  if (d.fecha_vencimiento && d.fecha_vencimiento < fechaIngreso) throw new HttpError(400, 'El vencimiento no puede ser anterior al ingreso');
  if (d.costo_total !== undefined && d.costo_unitario !== undefined) throw new HttpError(400, 'Indicá el costo total o el costo por unidad, no los dos');

  return db.transaction(async (tx) => {
    const insumo = await insumoActivo(tx, d.id_insumo);
    if (d.id_proveedor != null) {
      const { rows } = await tx.query('SELECT id FROM proveedor WHERE id = $1 AND activo', [d.id_proveedor]);
      if (!rows[0]) throw new HttpError(422, 'El proveedor no existe o está dado de baja');
    }
    const costo = d.costo_total !== undefined ? costoUnitarioDeCompra(d.costo_total, d.cantidad) : (d.costo_unitario ?? 0);
    const restante = restanteTrasDeficit(insumo.stock_actual, d.cantidad);

    const { rows } = await tx.query(
      `INSERT INTO lote_insumo (id_insumo, id_proveedor, origen, cantidad_inicial, cantidad_actual, costo_unitario, fecha_ingreso, fecha_vencimiento, id_usuario)
       VALUES ($1, $2, 'compra', $3, $4, $5, $6, $7, $8) RETURNING id`,
      [d.id_insumo, d.id_proveedor ?? null, d.cantidad, restante, costo, fechaIngreso, d.fecha_vencimiento ?? null, usuario.id],
    );
    await movimiento(tx, { tipo: 'ingreso', id_insumo: d.id_insumo, id_lote: rows[0].id, cantidad: d.cantidad, costo_unitario: costo, nota: d.nota, id_usuario: usuario.id });
    // El costo del insumo pasa a ser el de la última compra (costeo por última compra)
    await tx.query(
      `UPDATE insumo SET stock_actual = ROUND(stock_actual + $1, 3),
              costo_unitario = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE costo_unitario END,
              id_proveedor = COALESCE($3, id_proveedor)
        WHERE id = $4`,
      [d.cantidad, costo, d.id_proveedor ?? null, d.id_insumo],
    );
    return { id_lote: rows[0].id, costo_unitario: costo, stock_actual: redondear3(insumo.stock_actual + d.cantidad), sin_costo: !(costo > 0) };
  });
}

export async function registrarMerma(d, usuario) {
  return db.transaction((tx) =>
    consumirInsumo(tx, { id_insumo: d.id_insumo, cantidad: d.cantidad, tipo: 'merma', motivo: d.motivo, nota: d.nota, id_usuario: usuario.id, id_lote: d.id_lote ?? null }),
  );
}

/**
 * Conteo físico: deja el stock y los lotes en `cantidad_real`. Lo que se cuenta manda: si por algún motivo la suma de los
 * lotes no coincidía con el stock (por ejemplo, por ventas anuladas con una versión anterior), el conteo también lo corrige.
 */
export async function registrarAjuste(d, usuario, hoy) {
  return db.transaction(async (tx) => {
    const insumo = await insumoActivo(tx, d.id_insumo);
    const { rows: suma } = await tx.query('SELECT COALESCE(SUM(cantidad_actual), 0) AS total FROM lote_insumo WHERE id_insumo = $1 AND cantidad_actual > 0', [d.id_insumo]);
    const enLotes = redondear3(Number(suma[0].total));
    const diferencia = redondear3(d.cantidad_real - insumo.stock_actual);
    const diferenciaLotes = redondear3(d.cantidad_real - enLotes);
    if (diferencia === 0 && diferenciaLotes === 0) throw new HttpError(400, 'La cantidad coincide con el stock actual: no hay nada que ajustar');

    let registrado = 0; // lo que ya quedó asentado en movimientos, para que el historial sume la diferencia de stock
    if (diferenciaLotes < 0) {
      const { rows: lotes } = await tx.query(
        'SELECT id, cantidad_actual, fecha_vencimiento, fecha_ingreso, costo_unitario FROM lote_insumo WHERE id_insumo = $1 AND cantidad_actual > 0', [d.id_insumo],
      );
      for (const a of asignarFefo(lotes, -diferenciaLotes).asignaciones) {
        await tx.query('UPDATE lote_insumo SET cantidad_actual = ROUND(cantidad_actual - $1, 3) WHERE id = $2', [a.cantidad, a.id_lote]);
        await movimiento(tx, { tipo: 'ajuste', id_insumo: d.id_insumo, id_lote: a.id_lote, cantidad: -a.cantidad, costo_unitario: a.costo_unitario, nota: d.nota, id_usuario: usuario.id });
        registrado = redondear3(registrado - a.cantidad);
      }
    } else if (diferenciaLotes > 0) {
      const { rows } = await tx.query(
        `INSERT INTO lote_insumo (id_insumo, origen, cantidad_inicial, cantidad_actual, costo_unitario, fecha_ingreso, id_usuario)
         VALUES ($1, 'ajuste', $2, $2, $3, $4, $5) RETURNING id`,
        [d.id_insumo, diferenciaLotes, insumo.costo_unitario, hoy, usuario.id],
      );
      await movimiento(tx, { tipo: 'ajuste', id_insumo: d.id_insumo, id_lote: rows[0].id, cantidad: diferenciaLotes, costo_unitario: insumo.costo_unitario, nota: d.nota, id_usuario: usuario.id });
      registrado = diferenciaLotes;
    }
    // Hueco de ventas sin ingreso que el conteo da por cerrado (o descuadre entre stock y lotes): queda asentado sin lote
    const resto = redondear3(diferencia - registrado);
    if (resto !== 0) {
      await movimiento(tx, { tipo: 'ajuste', id_insumo: d.id_insumo, cantidad: resto, costo_unitario: insumo.costo_unitario, nota: d.nota, id_usuario: usuario.id });
    }
    await tx.query('UPDATE insumo SET stock_actual = $1 WHERE id = $2', [d.cantidad_real, d.id_insumo]);
    return { diferencia, stock_actual: d.cantidad_real };
  });
}

export async function alertas(hoy) {
  const { rows: insumos } = await db.query(
    'SELECT id, nombre, unidad, stock_actual, stock_minimo, stock_maximo, dias_aviso_vencimiento FROM insumo WHERE activo',
  );
  const { rows: lotes } = await db.query(
    'SELECT id, id_insumo, cantidad_actual, fecha_ingreso, fecha_vencimiento FROM lote_insumo WHERE cantidad_actual > 0',
  );
  return calcularAlertas({ insumos, lotes, hoy });
}

export async function lotes(idInsumo) {
  const { rows } = await db.query(
    `SELECT l.id, l.id_insumo, l.cantidad_inicial, l.cantidad_actual, l.costo_unitario, l.fecha_ingreso, l.fecha_vencimiento,
            l.origen, p.nombre AS proveedor
       FROM lote_insumo l LEFT JOIN proveedor p ON p.id = l.id_proveedor
      WHERE l.cantidad_actual > 0 ${idInsumo ? 'AND l.id_insumo = $1' : ''}
      ORDER BY l.fecha_vencimiento IS NULL, l.fecha_vencimiento, l.fecha_ingreso, l.id`,
    idInsumo ? [idInsumo] : [],
  );
  return rows;
}

export async function movimientos({ idInsumo, limite = 100 }) {
  const { rows } = await db.query(
    `SELECT m.id, m.fecha_hora, m.tipo, m.id_insumo, i.nombre AS insumo, i.unidad, m.cantidad, m.costo_unitario,
            m.motivo, m.nota, m.id_lote, u.nombre AS usuario
       FROM movimiento_stock m
       JOIN insumo i ON i.id = m.id_insumo
       LEFT JOIN usuario u ON u.id = m.id_usuario
      ${idInsumo ? 'WHERE m.id_insumo = $1' : ''}
      ORDER BY m.id DESC LIMIT ${Number(limite)}`,
    idInsumo ? [idInsumo] : [],
  );
  return rows;
}
