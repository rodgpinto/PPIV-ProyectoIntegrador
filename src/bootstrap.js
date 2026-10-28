import { readFile } from 'node:fs/promises';
import { db } from './db.js';
import { hashearPassword } from './modules/auth/seguridad.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a la base (útil si arranca junto con ella) y crea las tablas si faltan. */
export async function prepararBase({ intentos = 10 } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      await db.query('SELECT 1');
      break;
    } catch (error) {
      if (i >= intentos) throw new Error(`No se pudo conectar a la base de datos: ${error.message}`);
      console.log(`Esperando a la base de datos (${i}/${intentos})...`);
      await esperar(2000);
    }
  }
  // schema.sql es idempotente (IF NOT EXISTS): se puede ejecutar en cada arranque.
  await db.exec(await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
}

/** Crea el primer administrador desde el entorno, solo si no hay ninguno activo. Sirve también para recuperar el acceso. */
export async function asegurarAdministrador({ nombre, email, password }) {
  const { rows } = await db.query("SELECT id FROM usuario WHERE rol = 'administrador' AND activo LIMIT 1");
  if (rows[0]) return false;
  if (!email || !password || password.length < 8) {
    console.warn('ATENCION: no hay ningún administrador activo. Definí ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres) y reiniciá.');
    return false;
  }
  await db.query(
    `INSERT INTO usuario (nombre, email, contrasena, rol) VALUES ($1, $2, $3, 'administrador')
     ON CONFLICT (email) DO UPDATE SET rol = 'administrador', activo = TRUE, contrasena = excluded.contrasena`,
    [nombre, email, await hashearPassword(password)],
  );
  console.log(`Administrador listo: ${email}`);
  return true;
}
