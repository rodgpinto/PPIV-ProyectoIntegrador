// Acceso a la base. En producción es PostgreSQL (pg). En desarrollo, si no hay DATABASE_URL,
// se usa PGlite: PostgreSQL real compilado a WebAssembly que corre dentro de Node, sin instalar nada.
// Los servicios no saben cuál de los dos están usando: ven siempre { rows, rowCount }.
import { mkdirSync } from 'node:fs';

let motor = null;

export const db = {
  usar: (m) => { motor = m; },
  get nombre() { return motor?.nombre; },
  query: (texto, params) => motor.query(texto, params),
  /** fn recibe `tx`, con el mismo .query. Dentro de la transacción usar SIEMPRE `tx`, nunca `db`. */
  transaction: (fn) => motor.transaction(fn),
  exec: (script) => motor.exec(script),
  cerrar: () => motor?.close(),
};

// numeric y bigint llegan como texto o BigInt; date como Date. Se llevan a number y 'AAAA-MM-DD'.
export function normalizar(res) {
  const campos = res.fields ?? [];
  const numericos = campos.filter((f) => f.dataTypeID === 1700 || f.dataTypeID === 20).map((f) => f.name);
  const fechas = campos.filter((f) => f.dataTypeID === 1082).map((f) => f.name);
  let rows = res.rows ?? [];
  if (numericos.length || fechas.length) {
    rows = rows.map((fila) => {
      const o = { ...fila };
      for (const n of numericos) if (o[n] != null) o[n] = Number(o[n]);
      for (const n of fechas) if (o[n] instanceof Date) o[n] = o[n].toISOString().slice(0, 10);
      return o;
    });
  }
  return { rows, rowCount: rows.length || (res.rowCount ?? res.affectedRows ?? 0) };
}

async function motorPg(config) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(1082, (valor) => valor); // date -> texto 'AAAA-MM-DD' (sin corrimientos de zona horaria)
  // Pool chico a propósito: cada conexión de PostgreSQL es un proceso y sobran 5 para este volumen.
  // connectionTimeoutMillis: una base gratuita «dormida» (Neon, por ejemplo) tarda unos segundos en despertar; si no responde en 30 s, se corta con error.
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 30_000 });
  // Sin este manejador, una conexión inactiva que el servidor cierra (la base se durmió, se reinició, cortó la red) emite un
  // 'error' que nadie escucha y Node termina el proceso. Se registra y el pool abre otra conexión en la próxima consulta.
  pool.on('error', (error) => console.warn('Conexión inactiva con la base cerrada por el servidor (se reabre sola):', error.message));
  return {
    nombre: 'postgresql',
    query: async (t, p) => normalizar(await pool.query(t, p)),
    exec: (script) => pool.query(script),
    close: () => pool.end(),
    async transaction(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await fn({ query: async (t, p) => normalizar(await cliente.query(t, p)) });
        await cliente.query('COMMIT');
        return resultado;
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        cliente.release();
      }
    },
  };
}

async function motorPglite(config) {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('Falta PGlite: ejecutá "npm install", o definí DATABASE_URL para usar PostgreSQL.');
  }
  if (config.pgliteDir !== 'memory') mkdirSync(config.pgliteDir, { recursive: true });
  const bd = new PGlite(config.pgliteDir === 'memory' ? undefined : config.pgliteDir);
  await bd.waitReady;
  return {
    nombre: 'pglite',
    query: async (t, p) => normalizar(await bd.query(t, p)),
    exec: (script) => bd.exec(script),
    close: () => bd.close(),
    transaction: (fn) => bd.transaction((tx) => fn({ query: async (t, p) => normalizar(await tx.query(t, p)) })),
  };
}

export async function conectarDb(config) {
  if (config.databaseUrl) return db.usar(await motorPg(config));
  if (config.produccion) throw new Error('Falta DATABASE_URL: en producción hace falta PostgreSQL.');
  return db.usar(await motorPglite(config));
}
