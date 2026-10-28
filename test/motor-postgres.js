// Motor de verificación contra un PostgreSQL REAL, usando el cliente `psql` (sirve cuando no se puede instalar el driver `pg`).
// Imita lo que hace `pg`: cada consulta se valida primero con PREPARE (así falla igual que con parámetros reales:
// "could not determine data type of parameter $1", etc.) y después se ejecuta con los valores ya incrustados.
// Uso: RADAS_PSQL="-h /tmp/pgsock -p 5433 -U postgres -d radas_test" npm test
import { spawn } from 'node:child_process';
import { normalizar } from '../src/db.js';

const FIN = '@@FIN@@';
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d(:\d\d)?$/;

function literal(valor) {
  if (valor === null || valor === undefined) return 'NULL';
  if (valor instanceof Date) return `'${valor.toISOString()}'`;
  if (Array.isArray(valor)) {
    const elementos = valor.map((x) => (typeof x === 'string' ? `"${x.replace(/(["\\])/g, '\\$1')}"` : String(x)));
    return `'{${elementos.join(',')}}'`;
  }
  return `'${String(valor).replaceAll("'", "''")}'`;
}

class Sesion {
  constructor(argumentos) {
    this.p = spawn('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=0', '-v', 'VERBOSITY=verbose', ...argumentos], {
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    });
    this.salida = ''; this.errores = ''; this.pendiente = null;
    this.p.stdout.on('data', (d) => { this.salida += d; this.revisar(); });
    this.p.stderr.on('data', (d) => { this.errores += d; this.revisar(); });
    this.p.on('error', (e) => { throw e; });
    // Sin esto, los procesos psql abiertos mantienen vivo a Node y los tests no terminan.
    this.vivo(false);
  }
  /** Mientras haya una consulta en curso el proceso mantiene vivo a Node; en reposo no. */
  vivo(si) { for (const x of [this.p, this.p.stdin, this.p.stdout, this.p.stderr]) si ? x.ref() : x.unref(); }
  revisar() {
    if (!this.pendiente || !this.salida.includes(`${FIN}\n`) || !this.errores.includes(`${FIN}\n`)) return;
    const salida = this.salida.slice(0, this.salida.indexOf(`${FIN}\n`));
    const errores = this.errores.slice(0, this.errores.indexOf(`${FIN}\n`));
    this.salida = ''; this.errores = '';
    const { resolver } = this.pendiente; this.pendiente = null;
    this.vivo(false);
    resolver({ salida, errores });
  }
  ejecutar(sql) {
    return new Promise((resolver) => {
      this.pendiente = { resolver };
      this.vivo(true);
      this.p.stdin.write(`${sql}\n;\n\\echo ${FIN}\n\\warn ${FIN}\n`);
    }).then(({ salida, errores }) => {
      const m = /ERROR:\s+(\w{5}):\s+([^\n]*)/.exec(errores);
      if (m) throw Object.assign(new Error(m[2]), { code: m[1], detalle: errores });
      return salida;
    });
  }
  cerrar() { this.p.stdin.end(); }
}

const devuelveFilas = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);

async function consulta(sesion, texto, params = []) {
  await sesion.ejecutar(`PREPARE __chk AS ${texto}`); // valida tipos de parámetros como lo hace el driver
  await sesion.ejecutar('DEALLOCATE __chk');
  const sql = texto.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
  if (devuelveFilas(sql)) {
    const salida = await sesion.ejecutar(`WITH __q AS (${sql}) SELECT coalesce(json_agg(row_to_json(__q)), '[]'::json) FROM __q`);
    const rows = JSON.parse(salida.trim().split('\n').filter((l) => !/^(SET|BEGIN|COMMIT|ROLLBACK)$/.test(l)).join('\n') || '[]')
      .map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' && ISO.test(v) ? new Date(v) : v])));
    return normalizar({ rows });
  }
  const salida = await sesion.ejecutar(sql);
  const m = /^(?:INSERT \d+|UPDATE|DELETE) (\d+)$/m.exec(salida);
  return normalizar({ rows: [], rowCount: m ? Number(m[1]) : 0 });
}

export async function crearMotorPostgres(argumentos = process.env.RADAS_PSQL.split(/\s+/), tamano = 4) {
  const sesiones = Array.from({ length: tamano }, () => new Sesion(argumentos));
  const libres = [...sesiones];
  const esperando = [];
  const tomar = () => (libres.length ? Promise.resolve(libres.pop()) : new Promise((r) => esperando.push(r)));
  const soltar = (s) => (esperando.length ? esperando.shift()(s) : libres.push(s));
  return {
    nombre: 'postgresql (psql, solo verificación)',
    async query(t, p) { const s = await tomar(); try { return await consulta(s, t, p); } finally { soltar(s); } },
    async exec(script) { const s = await tomar(); try { await s.ejecutar(script); } finally { soltar(s); } },
    async close() { sesiones.forEach((s) => s.cerrar()); },
    async transaction(fn) {
      const s = await tomar();
      try {
        await s.ejecutar('BEGIN');
        try {
          const r = await fn({ query: (t, p) => consulta(s, t, p) });
          await s.ejecutar('COMMIT');
          return r;
        } catch (e) {
          await s.ejecutar('ROLLBACK').catch(() => {});
          throw e;
        }
      } finally { soltar(s); }
    },
  };
}
