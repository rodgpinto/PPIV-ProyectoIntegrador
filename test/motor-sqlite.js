// Motor de verificación rápida: corre el esquema y las consultas sobre SQLite (node:sqlite, Node 22+).
// No reemplaza a PostgreSQL: sirve para probar la lógica sin instalar nada.
import { DatabaseSync } from 'node:sqlite';

const ENUMS = ['rol_usuario', 'destino_producto', 'zona_mesa', 'estado_mesa', 'turno_trabajo', 'tipo_movimiento', 'motivo_merma'];
const BOOLEANAS = new Set(['activo', 'manual', 'tiene_receta', 'costo_incompleto', 'principal']);
const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function traducirEsquema(sql) {
  let s = sql.replace(/DO \$\$[\s\S]*?END \$\$;/g, '');
  s = s.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  s = s.replace(new RegExp(`\\b(${ENUMS.join('|')})\\b`, 'g'), 'TEXT');
  s = s.replace(/NUMERIC\(\d+,\s*\d+\)/g, 'REAL').replace(/\bTIMESTAMPTZ\b/g, 'TEXT').replace(/\bDATE\b/g, 'TEXT');
  s = s.replace(/DEFAULT now\(\)/g, `DEFAULT (${AHORA})`);
  return s;
}

export function traducirSql(sql) {
  return sql
    .replace(/\$(\d+)/g, '?$1')
    .replace(/::[a-z0-9_]+(\[\])?/gi, '')
    .replace(/\bnow\(\)/gi, AHORA)
    .replace(/\s+FOR UPDATE\b/gi, '');
}

const convertir = (fila) => {
  const o = { ...fila };
  for (const k of Object.keys(o)) if (BOOLEANAS.has(k) && typeof o[k] === 'number') o[k] = o[k] === 1;
  return o;
};

function correr(bd, sql, params = []) {
  const t = traducirSql(sql);
  const p = params.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x));
  try {
    const stmt = bd.prepare(t);
    if (/^\s*(select|with)\b/i.test(t) || /\breturning\b/i.test(t)) {
      const rows = stmt.all(...p).map(convertir);
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: Number(stmt.run(...p).changes) };
  } catch (e) {
    const m = String(e.message);
    if (m.includes('UNIQUE constraint failed')) e.code = '23505';
    else if (m.includes('FOREIGN KEY constraint failed')) e.code = '23503';
    else if (m.includes('CHECK constraint failed')) e.code = '23514';
    else if (m.includes('NOT NULL constraint failed')) e.code = '23502';
    throw e;
  }
}

export function crearMotorSqlite() {
  const bd = new DatabaseSync(':memory:');
  bd.exec('PRAGMA foreign_keys = ON');
  let cola = Promise.resolve();
  return {
    nombre: 'sqlite (solo verificación)',
    query: async (t, p) => correr(bd, t, p),
    exec: async (script) => { bd.exec(traducirEsquema(script)); },
    close: async () => bd.close(),
    transaction(fn) {
      const ejecutar = async () => {
        bd.exec('BEGIN');
        try {
          const r = await fn({ query: async (t, p) => correr(bd, t, p) });
          bd.exec('COMMIT');
          return r;
        } catch (e) {
          bd.exec('ROLLBACK');
          throw e;
        }
      };
      const p = cola.then(ejecutar);
      cola = p.catch(() => {});
      return p;
    },
  };
}
