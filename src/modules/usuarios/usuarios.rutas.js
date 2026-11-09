import { db } from '../../db.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { ROLES, SOLO_ADMIN, TODOS } from '../../roles.js';
import { passwordNueva } from '../auth/auth.rutas.js';
import { hashearPassword } from '../auth/seguridad.js';
import { cerrarSesionesDe } from '../auth/sesiones.js';

const COLUMNAS = 'id, nombre, email, rol, activo';
const nombre = v.texto({ min: 1, max: 100 });
const rol = v.opcion(TODOS);

const esquemaCrear = v.objeto({
  nombre,
  email: v.texto({ min: 1, max: 150, minusculas: true, email: true }),
  password: passwordNueva,
  rol,
});
const esquemaActualizar = v.objeto({ nombre, rol, activo: v.booleano(), password: passwordNueva }, { parcial: true });

async function crear(datos) {
  try {
    const { rows } = await db.query(
      `INSERT INTO usuario (nombre, email, contrasena, rol) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS}`,
      [datos.nombre, datos.email, await hashearPassword(datos.password), datos.rol],
    );
    return rows[0];
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'Ya existe un usuario con ese email');
    throw error;
  }
}

async function actualizar(id, { password, ...resto }, actor) {
  if (id === actor.id && (resto.activo === false || (resto.rol && resto.rol !== ROLES.ADMIN))) {
    throw new HttpError(400, 'No podés darte de baja ni quitarte el rol de administrador a vos mismo');
  }
  const campos = Object.keys(resto);
  const valores = Object.values(resto);
  if (password) {
    campos.push('contrasena');
    valores.push(await hashearPassword(password));
  }
  if (!campos.length) throw new HttpError(400, 'No hay nada para actualizar');

  const { rows } = await db.query(
    `UPDATE usuario SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${campos.length + 1} RETURNING ${COLUMNAS}`,
    [...valores, id],
  );
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
  // Si se cambió la clave o se lo dio de baja, se le cierran las sesiones abiertas
  if (password || resto.activo === false) await cerrarSesionesDe(id);
  return rows[0];
}

export default [
  {
    metodo: 'GET', ruta: '/usuarios', roles: SOLO_ADMIN,
    handler: async () => (await db.query(`SELECT ${COLUMNAS} FROM usuario ORDER BY nombre`)).rows,
  },
  {
    metodo: 'POST', ruta: '/usuarios', roles: SOLO_ADMIN, status: 201,
    handler: ({ body }) => crear(validar(esquemaCrear, body)),
  },
  {
    metodo: 'PATCH', ruta: '/usuarios/:id', roles: SOLO_ADMIN,
    handler: ({ params, body, usuario }) => actualizar(idDe(params.id), validar(esquemaActualizar, body), usuario),
  },
];
