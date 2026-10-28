import { config } from '../../config.js';
import { db } from '../../db.js';
import { calcularArqueo, jornadaDe, rangoDeJornadas, resumirVentas } from '../../domain/ventas.js';
import { HttpError } from '../../http/errores.js';

const zona = config.zonaHoraria;
const hora = config.jornadaInicioHora;

export const jornadaActual = (ahora) => jornadaDe(ahora, zona, hora);

/** Cuentas cobradas y sus líneas dentro de las jornadas desde..hasta. */
async function leerVentas(desde, hasta, consulta = db.query) {
  const { inicio, fin } = rangoDeJornadas(desde, hasta, zona, hora);
  const { rows: cuentas } = await consulta(
    `SELECT p.id, p.canal, p.medio_pago, p.total, p.cerrado_en, p.id_usuario, u.nombre AS usuario
       FROM pedido p JOIN usuario u ON u.id = p.id_usuario
      WHERE p.estado = 'cerrado' AND p.cerrado_en >= $1 AND p.cerrado_en < $2`,
    [inicio, fin],
  );
  const { rows: items } = await consulta(
    `SELECT ip.id_pedido, ip.id_producto, ip.nombre, pr.categoria, ip.cantidad, ip.precio_unitario, ip.costo_unitario, ip.estado, ip.creado_en
       FROM item_pedido ip JOIN pedido p ON p.id = ip.id_pedido JOIN producto pr ON pr.id = ip.id_producto
      WHERE p.estado = 'cerrado' AND p.cerrado_en >= $1 AND p.cerrado_en < $2`,
    [inicio, fin],
  );
  return { cuentas, items, inicio, fin };
}

/** Reporte de ventas del período (con costos y márgenes). */
export async function reporte(desde, hasta) {
  const datos = await leerVentas(desde, hasta);
  return { desde, hasta, ...resumirVentas(datos, zona, hora) };
}

export const CAJAS = ['mesa', 'barra', 'todos'];

/**
 * Estado de la caja de una jornada: lo cobrado, lo que falta cobrar y, si ya se cerró, el cierre.
 * `por_caja` separa el salón (`mesa`) de la barra (`barra`): cada una se cuenta y se cierra por su lado. `todos` es el total
 * y sirve para cerrar todo junto cuando hay una sola persona en la caja.
 */
export async function jornada(fecha, ahora, consulta = db.query) {
  const datos = await leerVentas(fecha, fecha, consulta);
  const r = resumirVentas(datos, zona, hora);
  const { rows: abiertas } = await consulta(
    `SELECT p.id, p.canal, p.etiqueta, m.nombre AS mesa, p.creado_en
       FROM pedido p LEFT JOIN mesa m ON m.id = p.id_mesa
      WHERE p.estado = 'abierto' AND p.creado_en < $1 ORDER BY p.creado_en, p.id`,
    [datos.fin],
  );
  const { rows: canceladas } = await consulta(
    "SELECT COUNT(*) AS n FROM pedido WHERE estado = 'cancelado' AND cerrado_en >= $1 AND cerrado_en < $2",
    [datos.inicio, datos.fin],
  );
  const lista = await cierres({ fecha }, consulta);
  const cierreDe = (canal) => lista.find((c) => c.canal === canal) ?? null;

  const medios = (resumen) => Object.fromEntries(resumen.por_medio.map((m) => [m.medio_pago, m.ventas]));
  const caja = (canal) => {
    const cuentas = canal === 'todos' ? datos.cuentas : datos.cuentas.filter((c) => c.canal === canal);
    const ids = new Set(cuentas.map((c) => c.id));
    const rc = canal === 'todos' ? r : resumirVentas({ cuentas, items: datos.items.filter((i) => ids.has(i.id_pedido)) }, zona, hora);
    return {
      canal, cuentas: rc.resumen.cuentas, ventas_total: rc.resumen.ventas, ticket_promedio: rc.resumen.ticket_promedio,
      por_medio: rc.por_medio, ventas_efectivo: medios(rc).efectivo ?? 0,
      abiertas: canal === 'todos' ? abiertas : abiertas.filter((a) => a.canal === canal),
      cierre: cierreDe(canal),
    };
  };
  const porCaja = { mesa: caja('mesa'), barra: caja('barra'), todos: caja('todos') };
  // La noche está cerrada cuando se cerró todo junto, o cuando se cerraron el salón y la barra
  const cerrada = Boolean(cierreDe('todos')) || (Boolean(cierreDe('mesa')) && Boolean(cierreDe('barra')));
  return {
    fecha, es_actual: fecha === jornadaActual(ahora), inicio: datos.inicio, fin: datos.fin,
    ventas_total: r.resumen.ventas, cuentas: r.resumen.cuentas, ticket_promedio: r.resumen.ticket_promedio,
    por_medio: r.por_medio, por_canal: r.por_canal, ventas_efectivo: porCaja.todos.ventas_efectivo,
    anulado: r.resumen.anulado, canceladas: Number(canceladas[0].n),
    abiertas, cierre: cierreDe('todos'), cierres: lista, por_caja: porCaja, cerrada,
  };
}

const COLUMNAS_CIERRE = `c.id, c.fecha_jornada, c.canal, c.cerrado_en, c.id_usuario, u.nombre AS usuario, c.cuentas, c.ventas_total, c.ventas_efectivo,
  c.ventas_tarjeta, c.ventas_mercado_pago, c.ventas_transferencia, c.fondo_inicial, c.retiros, c.efectivo_esperado,
  c.efectivo_contado, c.diferencia, c.nota`;

export async function cierres({ fecha = null, limite = 60 } = {}, consulta = db.query) {
  const { rows } = await consulta(
    `SELECT ${COLUMNAS_CIERRE} FROM cierre_caja c JOIN usuario u ON u.id = c.id_usuario
      ${fecha ? 'WHERE c.fecha_jornada = $1' : ''} ORDER BY c.fecha_jornada DESC, c.canal LIMIT ${Number(limite)}`,
    fecha ? [fecha] : [],
  );
  return rows;
}

/** ¿Está cerrada la caja que le corresponde a una cuenta de este canal en esa jornada? (la suya, o la de todo junto) */
export async function cajaCerradaPara(consulta, fecha, canal) {
  const { rows } = await consulta('SELECT canal FROM cierre_caja WHERE fecha_jornada = $1 AND canal IN ($2, $3)', [fecha, canal, 'todos']);
  return rows.length > 0;
}

export async function cerrarCaja({ fecha, canal = 'todos', fondo_inicial = 0, retiros = 0, efectivo_contado, nota = '' }, usuario, ahora) {
  const actual = jornadaActual(ahora);
  if (fecha > actual) throw new HttpError(400, 'No se puede cerrar la caja de una jornada que todavía no empezó');
  if (!CAJAS.includes(canal)) throw new HttpError(400, 'La caja debe ser mesa, barra o todos');
  return db.transaction(async (tx) => {
    const j = await jornada(fecha, ahora, tx.query);
    const nombre = { mesa: 'del salón', barra: 'de la barra', todos: 'de la noche' }[canal];
    if (j.por_caja[canal].cierre) throw new HttpError(409, `La caja ${nombre} ya está cerrada`, { id: j.por_caja[canal].cierre.id });
    if (canal === 'todos' && j.cierres.length) throw new HttpError(409, 'Ya se cerró la caja del salón o de la barra: cerrá la que falta, o pedile al administrador que la reabra para cerrar todo junto', { id: j.cierres[0].id });
    if (canal !== 'todos' && j.cierre) throw new HttpError(409, 'La caja de esa noche ya se cerró con todo junto', { id: j.cierre.id });
    const caja = j.por_caja[canal];
    if (caja.abiertas.length) {
      throw new HttpError(409, `Hay ${caja.abiertas.length} ${caja.abiertas.length === 1 ? 'cuenta abierta' : 'cuentas abiertas'}: cobralas o cancelalas antes de cerrar la caja`, { abiertas: caja.abiertas.map((a) => a.id) });
    }
    const medio = (m) => caja.por_medio.find((x) => x.medio_pago === m)?.ventas ?? 0;
    const arqueo = calcularArqueo({ ventas_efectivo: medio('efectivo'), fondo_inicial, retiros, efectivo_contado });
    const { rows } = await tx.query(
      `INSERT INTO cierre_caja (fecha_jornada, canal, cerrado_en, id_usuario, cuentas, ventas_total, ventas_efectivo, ventas_tarjeta, ventas_mercado_pago,
         ventas_transferencia, fondo_inicial, retiros, efectivo_esperado, efectivo_contado, diferencia, nota)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [fecha, canal, ahora.toISOString(), usuario.id, caja.cuentas, caja.ventas_total, medio('efectivo'), medio('tarjeta'), medio('mercado_pago'), medio('transferencia'),
        fondo_inicial, retiros, arqueo.efectivo_esperado, efectivo_contado, arqueo.diferencia, nota],
    );
    const creado = (await cierres({ fecha }, tx.query)).find((c) => c.id === rows[0].id);
    return creado;
  });
}

export async function reabrirCaja(id) {
  const { rowCount } = await db.query('DELETE FROM cierre_caja WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Cierre no encontrado');
}

