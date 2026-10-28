// Utilidades de prueba: base en memoria (SQLite de Node), usuarios por rol y llamadas a la API.
import { readFileSync } from 'node:fs';
import { despachar } from '../src/api.js';
import { db } from '../src/db.js';
import { hashearPassword } from '../src/modules/auth/seguridad.js';
import { crearSesion } from '../src/modules/auth/sesiones.js';
import { crearMotorSqlite } from './motor-sqlite.js';
import { crearMotorPostgres } from './motor-postgres.js';

/** Motor de prueba: SQLite en memoria por defecto; con RADAS_PSQL apunta a un PostgreSQL real (ver motor-postgres.js). */
export async function iniciarBase() {
  if (process.env.RADAS_PSQL) {
    db.usar(await crearMotorPostgres());
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    db.usar(crearMotorSqlite());
  }
  await db.exec(readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
}

let hashRapido = null;
export async function crearUsuario(rol, nombre = `Usuario ${rol}`, email = `${rol}@test.local`, password = 'clave-de-prueba-1') {
  hashRapido ??= await hashearPassword(password);
  const { rows } = await db.query('INSERT INTO usuario (nombre, email, contrasena, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, rol', [nombre, email, hashRapido, rol]);
  return rows[0];
}

/** Crea (o reutiliza) un usuario del rol y le abre sesión: devuelve { usuario, token }. */
const sesiones = new Map();
export const AHORA = new Date('2026-10-14T15:00:00Z'); // 12:00 en Buenos Aires
export async function conSesion(rol, ahora = AHORA) {
  if (!sesiones.has(rol)) {
    const usuario = await crearUsuario(rol);
    const { token } = await crearSesion(usuario.id, ahora, 24 * 365 * 5);
    sesiones.set(rol, { usuario, token });
  }
  return sesiones.get(rol);
}

export async function api(metodo, ruta, { body, token, query, ahora, ip = '10.0.0.1' } = {}) {
  return despachar({ metodo, ruta, body, token, query, ahora, ip });
}

export const CLAVE = 'clave-de-prueba-1';

/** Verifica el status y muestra el cuerpo si falla. */
export function esperar(res, status) {
  if (res.status !== status) throw new Error(`Se esperaba ${status} y llegó ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}
