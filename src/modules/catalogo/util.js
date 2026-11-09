import { db } from '../../db.js';
import { HttpError } from '../../http/errores.js';

/** "$1, $2, $3" para una cláusula IN con `n` valores, empezando en el parámetro `desde`. */
export const marcadores = (n, desde = 1) => Array.from({ length: n }, (_, i) => `$${i + desde}`).join(', ');

/** "campo = $1, campo2 = $2" desde un objeto ya validado (las claves provienen del esquema, nunca del usuario). */
export function armarSet(datos) {
  const claves = Object.keys(datos);
  return { sql: claves.map((c, i) => `${c} = $${i + 1}`).join(', '), valores: claves.map((c) => datos[c]), cantidad: claves.length };
}

/**
 * Eliminación definitiva (el «Delete» del CRUD): borra la fila de verdad, pero SOLO si nada la usa.
 * `usos` es una lista de [consulta de conteo, texto del motivo]; si alguna cuenta más de cero, responde 409
 * con un mensaje claro y no toca nada. Lo que tiene historial (ventas, stock, pedidos) se da de baja, no se borra:
 * así los informes, la caja y la auditoría nunca quedan apuntando a algo que ya no existe.
 * `limpiar(tx)` borra lo que depende solo de este registro (por ejemplo la receta de un producto).
 */
export async function eliminarSinHistorial({ tabla, id, sustantivo, usos, limpiar }) {
  try {
    return await db.transaction(async (tx) => {
      const { rows } = await tx.query(`SELECT nombre FROM ${tabla} WHERE id = $1`, [id]);
      if (!rows[0]) throw new HttpError(404, `No se encontró ${sustantivo}: puede que ya se haya eliminado`);
      for (const [consulta, motivo] of usos) {
        const { rows: [{ n }] } = await tx.query(consulta, [id]);
        if (Number(n) > 0) {
          throw new HttpError(409, `No se puede eliminar ${sustantivo} «${rows[0].nombre}»: ${motivo(Number(n))}. Para dejar de usarlo, dalo de baja: queda en el historial y se puede reactivar.`);
        }
      }
      if (limpiar) await limpiar(tx, id);
      await tx.query(`DELETE FROM ${tabla} WHERE id = $1`, [id]);
      return { id, nombre: rows[0].nombre, eliminado: true };
    });
  } catch (e) {
    // Red de seguridad: si apareció una referencia que no previmos, la base la rechaza y el usuario recibe un 409 en vez de un 500
    if (e.code === '23503') throw new HttpError(409, `No se puede eliminar ${sustantivo}: otros datos todavía lo usan. Dalo de baja en su lugar.`);
    throw e;
  }
}

export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
