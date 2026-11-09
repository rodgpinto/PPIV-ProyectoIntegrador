import { config } from '../../config.js';
import { db } from '../../db.js';
import { HttpError } from '../../http/errores.js';
import { v, validar } from '../../http/validar.js';
import { TODOS } from '../../roles.js';
import { hashearPassword, verificarPassword } from './seguridad.js';
import { cerrarOtrasSesionesDe, cerrarSesion, crearSesion } from './sesiones.js';

// Límite de intentos fallidos por IP y email (en memoria: vale para un solo proceso).
const VENTANA_MS = 15 * 60 * 1000;
const MAX_FALLOS = 5;
const fallos = new Map();
setInterval(() => {
  const ahora = Date.now();
  for (const [clave, f] of fallos) if (ahora > f.vence) fallos.delete(clave);
}, VENTANA_MS).unref();

const bloqueado = (clave, ahora) => {
  const f = fallos.get(clave);
  return Boolean(f) && ahora <= f.vence && f.cantidad >= MAX_FALLOS;
};
const registrarFallo = (clave, ahora) => {
  const f = fallos.get(clave);
  if (!f || ahora > f.vence) fallos.set(clave, { cantidad: 1, vence: ahora + VENTANA_MS });
  else f.cantidad += 1;
};

// Se compara contra un hash falso cuando el email no existe, para no revelar qué emails están registrados.
let hashFalso = null;

export const passwordNueva = v.texto({ min: 8, max: 128, sinRecortar: true });

const esquemaLogin = v.objeto({
  email: v.texto({ min: 1, max: 150, minusculas: true }),
  password: v.texto({ min: 1, max: 128, sinRecortar: true }),
});
const esquemaCambio = v.objeto({
  actual: v.texto({ min: 1, max: 128, sinRecortar: true }),
  nueva: passwordNueva,
});

export default [
  {
    metodo: 'POST', ruta: '/auth/login', publico: true, auditar: true,
    async handler({ body, ip, ahora }) {
      const { email, password } = validar(esquemaLogin, body);
      const clave = `${ip}|${email}`;
      if (bloqueado(clave, ahora.getTime())) throw new HttpError(429, 'Demasiados intentos fallidos. Probá de nuevo en unos minutos');

      const { rows } = await db.query('SELECT id, nombre, email, rol, activo, contrasena FROM usuario WHERE email = $1', [email]);
      const usuario = rows[0];
      hashFalso ??= await hashearPassword('contrasena-inexistente');
      const coincide = await verificarPassword(password, usuario ? usuario.contrasena : hashFalso);

      if (!usuario || !usuario.activo || !coincide) {
        registrarFallo(clave, ahora.getTime());
        throw new HttpError(401, 'Email o contraseña incorrectos');
      }
      fallos.delete(clave);
      const { token, expira } = await crearSesion(usuario.id, ahora, config.sesionHoras);
      return { token, expira, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } };
    },
  },
  {
    metodo: 'POST', ruta: '/auth/logout', roles: TODOS,
    async handler({ token }) {
      await cerrarSesion(token);
    },
  },
  {
    metodo: 'GET', ruta: '/auth/me', roles: TODOS,
    handler: ({ usuario }) => ({ usuario }),
  },
  {
    metodo: 'POST', ruta: '/auth/cambiar-contrasena', roles: TODOS,
    async handler({ usuario, body, token }) {
      const { actual, nueva } = validar(esquemaCambio, body);
      const { rows } = await db.query('SELECT contrasena FROM usuario WHERE id = $1', [usuario.id]);
      if (!(await verificarPassword(actual, rows[0].contrasena))) throw new HttpError(400, 'La contraseña actual no es correcta');
      await db.query('UPDATE usuario SET contrasena = $1 WHERE id = $2', [await hashearPassword(nueva), usuario.id]);
      await cerrarOtrasSesionesDe(usuario.id, token); // las demás sesiones abiertas quedan cerradas
    },
  },
];
