import { db } from '../../db.js';
import { etiquetaDe, serializarDetalle } from '../../domain/auditoria.js';

/** Guarda una fila. Nunca lanza: si la auditoría falla, la operación que se hizo no se deshace (queda en la consola). */
export async function registrar({ ahora = new Date(), usuario = null, accion, entidad = '', id_entidad = '', resultado = 'ok', detalle = null, ip = '' }) {
  try {
    await db.query(
      `INSERT INTO auditoria (fecha_hora, id_usuario, usuario, rol, accion, entidad, id_entidad, resultado, detalle, ip)
       VALUES ($10, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [usuario?.id ?? null, usuario?.nombre ?? '', usuario?.rol ?? '', accion, entidad, String(id_entidad ?? ''), resultado, serializarDetalle(detalle), ip ?? '', ahora.toISOString()],
    );
  } catch (error) {
    console.error('No se pudo guardar la auditoría:', error.message);
  }
}

/**
 * Lo llama el despachador al terminar cada pedido. Decide si hay algo para registrar:
 *  - rutas que modifican datos y salieron bien;
 *  - rutas con `auditar: true` (login, descargas);
 *  - cualquier intento sin permiso (403) y errores del servidor (5xx) de quien ya inició sesión.
 */
export async function desdeDespachador({ r, usuario, params, body, status, datos, extra = {}, ip, ahora }) {
  const etiqueta = etiquetaDe(r.metodo, r.ruta);
  const modifica = r.metodo !== 'GET' && r.metodo !== 'HEAD';
  const exito = status < 400;

  if (usuario && status === 403) {
    return registrar({ ahora, usuario, accion: 'sistema.acceso_denegado', entidad: etiqueta?.[2] ?? '', resultado: 'denegado', detalle: { ruta: `${r.metodo} ${r.ruta}` }, ip });
  }
  if (usuario && status >= 500) {
    return registrar({ ahora, usuario, accion: 'sistema.error', resultado: 'fallido', detalle: { ruta: `${r.metodo} ${r.ruta}` }, ip });
  }
  if (!etiqueta) return undefined;
  if (!(r.auditar || (modifica && exito))) return undefined;

  const [accion, , entidad] = etiqueta;
  const identificado = usuario ?? (exito ? datos?.usuario : null) ?? null;
  const detalle = {};
  if (r.publico) {
    if (body?.email) detalle.email = body.email; // en el login: quién lo intentó (nunca la contraseña)
  } else if (body && !extra.sinCuerpo) {
    detalle.datos = body; // lo que se envió; `limpiar` oculta cualquier campo secreto
  }
  Object.assign(detalle, extra.detalle);
  if (!exito) detalle.motivo = datos?.error;
  return registrar({
    ahora,
    usuario: identificado,
    accion,
    entidad: extra.entidad ?? entidad,
    id_entidad: extra.id_entidad ?? params?.id ?? params?.nombre ?? '',
    resultado: exito ? 'ok' : 'fallido',
    detalle,
    ip,
  });
}

const LIMITE_MAX = 500;

/** Consulta con filtros para la pantalla de auditoría. Devuelve las más nuevas primero. */
export async function listar({ desde, hasta, accion, id_usuario, resultado, texto, limite = 100, antes_de_id } = {}) {
  const cond = [];
  const params = [];
  const p = (valor) => { params.push(valor); return `$${params.length}`; };
  if (desde) cond.push(`fecha_hora >= ${p(desde)}`);
  if (hasta) cond.push(`fecha_hora < ${p(hasta)}`);
  if (accion) cond.push(`accion = ${p(accion)}`);
  if (id_usuario) cond.push(`id_usuario = ${p(id_usuario)}`);
  if (resultado) cond.push(`resultado = ${p(resultado)}`);
  if (texto) cond.push(`(LOWER(detalle) LIKE ${p(`%${texto.toLowerCase()}%`)} OR LOWER(usuario) LIKE ${p(`%${texto.toLowerCase()}%`)} OR id_entidad = ${p(texto)})`);
  if (antes_de_id) cond.push(`id < ${p(antes_de_id)}`);
  const tope = Math.min(Math.max(Number(limite) || 100, 1), LIMITE_MAX);
  const { rows } = await db.query(
    `SELECT id, fecha_hora, id_usuario, usuario, rol, accion, entidad, id_entidad, resultado, detalle, ip
       FROM auditoria ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ${tope + 1}`,
    params,
  );
  const hayMas = rows.length > tope;
  return { filas: rows.slice(0, tope).map((f) => ({ ...f, detalle: parsear(f.detalle) })), hay_mas: hayMas };
}

function parsear(texto) {
  if (!texto) return null;
  try { return JSON.parse(texto); } catch { return texto; }
}
