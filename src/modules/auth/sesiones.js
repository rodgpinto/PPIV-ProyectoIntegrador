import { db } from '../../db.js';
import { hashToken, nuevoToken } from './seguridad.js';

export async function crearSesion(idUsuario, ahora, horas) {
  const token = nuevoToken();
  const expira = new Date(ahora.getTime() + horas * 3_600_000).toISOString();
  await db.query('INSERT INTO sesion (token_hash, id_usuario, expira) VALUES ($1, $2, $3)', [hashToken(token), idUsuario, expira]);
  await db.query('DELETE FROM sesion WHERE expira < $1', [ahora.toISOString()]); // limpieza de sesiones vencidas
  return { token, expira };
}

/** Usuario dueño de la sesión, o null si no existe, venció o el usuario está dado de baja. */
export async function buscarSesion(token, ahora) {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.rol
       FROM sesion s JOIN usuario u ON u.id = s.id_usuario
      WHERE s.token_hash = $1 AND s.expira > $2 AND u.activo`,
    [hashToken(token), ahora.toISOString()],
  );
  return rows[0] ?? null;
}

export const cerrarSesion = (token) => db.query('DELETE FROM sesion WHERE token_hash = $1', [hashToken(token)]);
export const cerrarSesionesDe = (idUsuario) => db.query('DELETE FROM sesion WHERE id_usuario = $1', [idUsuario]);
export const cerrarOtrasSesionesDe = (idUsuario, token) =>
  db.query('DELETE FROM sesion WHERE id_usuario = $1 AND token_hash <> $2', [idUsuario, hashToken(token)]);
