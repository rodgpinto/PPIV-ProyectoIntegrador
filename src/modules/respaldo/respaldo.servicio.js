// Copias de seguridad "lógicas": un archivo comprimido con TODAS las tablas en JSON. Sirve igual para PostgreSQL,
// PGlite y SQLite (las pruebas), no depende de pg_dump y se puede restaurar sobre cualquier motor.
// Complementa (no reemplaza) a pg_dump: ver docs/COPIAS.md.
import { exec } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { config } from '../../config.js';
import { db } from '../../db.js';
import { offsetMinutos } from '../../domain/fechas.js';
import { HttpError } from '../../http/errores.js';
import { registrar } from '../auditoria/auditoria.servicio.js';

export const FORMATO = 'radas-respaldo';
export const VERSION = 1;

/**
 * Tablas en orden de dependencia (primero las que otras referencian). `sesion` queda afuera a propósito: son
 * sesiones abiertas, y tras restaurar conviene que todos vuelvan a iniciar sesión.
 * Si agregás una tabla al esquema, agregala acá: el test "el respaldo cubre todas las tablas" falla si se olvida.
 */
export const TABLAS = [
  'usuario', 'proveedor', 'producto', 'insumo', 'detalle_receta', 'presentacion_insumo', 'lote_insumo', 'mesa',
  'fichaje', 'pedido', 'item_pedido', 'movimiento_stock', 'cierre_caja', 'auditoria',
];
export const TABLAS_EXCLUIDAS = ['sesion'];

const PATRON = /^radas-\d{8}-\d{6}\.json\.gz$/;
export const esNombreValido = (nombre) => PATRON.test(nombre);

const esSqlite = () => String(db.nombre).startsWith('sqlite');
const identificador = (t) => {
  if (!/^[a-z_]+$/.test(t)) throw new Error(`Nombre de tabla inválido: ${t}`);
  return t;
};

/** Lee todas las tablas. Con `tx` lo hace dentro de una transacción (foto consistente). */
export async function volcar(consulta = db.query, ahora = new Date()) {
  const tablas = {};
  const filas = {};
  for (const t of TABLAS) {
    const { rows } = await consulta(`SELECT * FROM ${identificador(t)} ORDER BY id`);
    tablas[t] = rows;
    filas[t] = rows.length;
  }
  return { formato: FORMATO, version: VERSION, creado_en: ahora.toISOString(), motor: db.nombre, filas, tablas };
}

function sello(ahora) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${f.year}${f.month}${f.day}-${f.hour}${f.minute}${f.second}`;
}

/** Instante en que se hizo la copia, leído del nombre (el reloj del archivo cambia al copiarlo o moverlo). */
export function instanteDeNombre(nombre, zona = config.zonaHoraria) {
  const m = /^radas-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(nombre);
  if (!m) return null;
  const [a, mes, d, h, mi, se] = m.slice(1).map(Number);
  const nominal = Date.UTC(a, mes - 1, d, h, mi, se);
  const primero = nominal - offsetMinutos(zona, new Date(nominal)) * 60000;
  return new Date(nominal - offsetMinutos(zona, new Date(primero)) * 60000);
}

/** Crea el archivo (primero temporal, después se renombra: nunca queda una copia a medias). */
export async function crearRespaldo({ dir = config.respaldo.dir, ahora = new Date() } = {}) {
  mkdirSync(dir, { recursive: true });
  // Una sola transacción para que todas las tablas sean de un mismo instante
  const datos = await db.transaction((tx) => volcar(tx.query, ahora));
  const buffer = gzipSync(Buffer.from(JSON.stringify(datos), 'utf8'));
  // Dos copias en el mismo segundo: la segunda toma el segundo siguiente en lugar de pisar a la primera
  let momento = ahora;
  let nombre = `radas-${sello(momento)}.json.gz`;
  while (statSyncSeguro(path.join(dir, nombre))) {
    momento = new Date(momento.getTime() + 1000);
    nombre = `radas-${sello(momento)}.json.gz`;
  }
  const temporal = path.join(dir, `${nombre}.tmp`);
  writeFileSync(temporal, buffer);
  renameSync(temporal, path.join(dir, nombre));
  return { nombre, bytes: buffer.length, creado_en: ahora.toISOString(), filas: datos.filas };
}

function statSyncSeguro(ruta) {
  try { return statSync(ruta); } catch { return null; }
}

/** Copias existentes, de la más nueva a la más vieja. */
export function listar(dir = config.respaldo.dir) {
  let nombres = [];
  try { nombres = readdirSync(dir); } catch { return []; }
  return nombres
    .filter(esNombreValido)
    .map((nombre) => {
      const st = statSync(path.join(dir, nombre));
      return { nombre, bytes: st.size, creado_en: instanteDeNombre(nombre).toISOString() };
    })
    .sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
}

/** Borra las más viejas y deja `conservar`. Devuelve los nombres borrados. */
export function depurar(dir = config.respaldo.dir, conservar = config.respaldo.conservar) {
  if (!(conservar >= 1)) return [];
  const sobran = listar(dir).slice(conservar);
  for (const { nombre } of sobran) unlinkSync(path.join(dir, nombre));
  return sobran.map((s) => s.nombre);
}

export function leerArchivo(nombre, dir = config.respaldo.dir) {
  if (!esNombreValido(nombre)) throw new HttpError(400, 'Nombre de copia inválido');
  try {
    return readFileSync(path.join(dir, nombre));
  } catch {
    throw new HttpError(404, 'No existe esa copia de seguridad');
  }
}

/** Valida y devuelve el contenido de un archivo de copia (Buffer gzip o JSON ya leído). */
export function interpretar(buffer) {
  let datos;
  try {
    const crudo = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
    datos = JSON.parse(crudo.toString('utf8'));
  } catch {
    throw new Error('El archivo no es una copia de seguridad de RADAS válida (no se pudo leer).');
  }
  if (datos?.formato !== FORMATO) throw new Error('El archivo no es una copia de seguridad de RADAS.');
  if (!(datos.version <= VERSION)) throw new Error(`La copia es de una versión más nueva del sistema (${datos.version}). Actualizá el sistema antes de restaurarla.`);
  for (const t of TABLAS) if (!Array.isArray(datos.tablas?.[t])) throw new Error(`Falta la tabla "${t}" en la copia: el archivo está incompleto.`);
  return datos;
}

async function columnasDe(tx, tabla) {
  const { rows } = esSqlite()
    ? await tx.query('SELECT name AS columna FROM pragma_table_info($1)', [tabla])
    : await tx.query("SELECT column_name AS columna FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1", [tabla]);
  return new Set(rows.map((r) => r.columna));
}

/**
 * Reemplaza TODO el contenido de la base por el de la copia, en una sola transacción: si algo falla, no cambia nada.
 * Las columnas que la copia trae y la base ya no tiene se ignoran; las que la base tiene y la copia no, quedan con su valor por defecto.
 */
export async function restaurar(datos) {
  const resumen = {};
  await db.transaction(async (tx) => {
    for (const t of [...TABLAS].reverse()) await tx.query(`DELETE FROM ${identificador(t)}`);
    for (const t of TABLAS) {
      const destino = await columnasDe(tx, t);
      for (const fila of datos.tablas[t]) {
        const columnas = Object.keys(fila).filter((c) => destino.has(c));
        const marcadores = columnas.map((_, i) => `$${i + 1}`).join(', ');
        await tx.query(`INSERT INTO ${identificador(t)} (${columnas.join(', ')}) VALUES (${marcadores})`, columnas.map((c) => fila[c]));
      }
      resumen[t] = datos.tablas[t].length;
      if (!esSqlite()) {
        await tx.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
      }
    }
  });
  return resumen;
}

/** Ejecuta el comando de copia externa (por ejemplo rclone) con la ruta de la copia en RESPALDO_ARCHIVO. */
export function enviarAfuera(archivo, comando = config.respaldo.comandoExterno) {
  if (!comando) return Promise.resolve(null);
  const lineaDeComando = comando.replaceAll('{archivo}', `"${archivo}"`).replaceAll('{nombre}', path.basename(archivo));
  return new Promise((resolver) => {
    exec(lineaDeComando, { env: { ...process.env, RESPALDO_ARCHIVO: archivo }, timeout: 120_000 }, (error, stdout, stderr) => {
      resolver({ ok: !error, salida: String(error ? stderr || error.message : stdout).trim().slice(0, 300) });
    });
  });
}

/** Una vuelta completa: crear, depurar, enviar afuera y dejar constancia en la auditoría. */
export async function hacerRespaldoAutomatico({ ahora = new Date(), dir = config.respaldo.dir } = {}) {
  const copia = await crearRespaldo({ dir, ahora });
  const borradas = depurar(dir);
  await registrar({ ahora, accion: 'respaldo.automatico', entidad: 'respaldo', id_entidad: copia.nombre, detalle: { bytes: copia.bytes, borradas: borradas.length } });
  const externo = await enviarAfuera(path.join(dir, copia.nombre));
  if (externo) {
    await registrar({ ahora, accion: 'respaldo.externo', entidad: 'respaldo', id_entidad: copia.nombre, resultado: externo.ok ? 'ok' : 'fallido', detalle: { salida: externo.salida } });
  }
  return { ...copia, externo };
}

/** Estado para la pantalla: copias, antigüedad y si alguna salió del servidor. */
export async function estado(ahora = new Date(), dir = config.respaldo.dir) {
  const copias = listar(dir);
  const { rows } = await db.query(
    "SELECT accion, MAX(fecha_hora) AS ultima FROM auditoria WHERE (accion = 'respaldo.descargar') OR (accion = 'respaldo.externo' AND resultado = 'ok') GROUP BY accion",
  );
  const ultimaFuera = rows.map((r) => new Date(r.ultima)).sort((a, b) => b - a)[0] ?? null;
  const ultima = copias[0] ? new Date(copias[0].creado_en) : null;
  const horas = (d) => (d ? Math.floor((ahora - d) / 3_600_000) : null);
  return {
    copias,
    ultima_copia_horas: horas(ultima),
    ultima_salida_horas: horas(ultimaFuera),
    automaticas_cada_horas: config.respaldo.cadaHoras,
    conservar: config.respaldo.conservar,
    copia_externa_configurada: Boolean(config.respaldo.comandoExterno),
  };
}
