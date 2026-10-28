import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { db } from '../src/db.js';
import { config } from '../src/config.js';
import { sembrarDemo } from '../src/seed-demo.js';
import { Descarga } from '../src/http/descarga.js';
import * as r from '../src/modules/respaldo/respaldo.servicio.js';
import { crearSesion } from '../src/modules/auth/sesiones.js';
import { api, AHORA, conSesion, esperar, iniciarBase } from './ayuda.js';

let dir;
let admin;
let cajero;
before(async () => {
  await iniciarBase();
  dir = mkdtempSync(path.join(tmpdir(), 'radas-respaldo-'));
  config.respaldo.dir = dir; // las rutas usan este directorio
  await sembrarDemo(AHORA);
  admin = await conSesion('administrador');
  cajero = await conSesion('cajero');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const foto = async (sinAuditoria = false) => {
  const { tablas } = await r.volcar();
  if (sinAuditoria) delete tablas.auditoria; // restaurar deja constancia en la auditoría, después de restaurar
  return JSON.stringify(tablas);
};

test('el respaldo cubre todas las tablas del esquema (salvo las excluidas a propósito)', () => {
  const sql = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const enEsquema = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  const faltan = enEsquema.filter((t) => !r.TABLAS.includes(t) && !r.TABLAS_EXCLUIDAS.includes(t));
  assert.deepEqual(faltan, [], 'Agregá estas tablas a TABLAS en src/modules/respaldo/respaldo.servicio.js');
  const sobran = r.TABLAS.filter((t) => !enEsquema.includes(t));
  assert.deepEqual(sobran, []);
  // el orden respeta las claves foráneas: cada tabla aparece después de las que referencia
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
    const [, tabla, cuerpo] = m;
    for (const ref of cuerpo.matchAll(/REFERENCES (\w+)/g)) {
      if (r.TABLAS.includes(tabla) && r.TABLAS.includes(ref[1])) assert.ok(r.TABLAS.indexOf(ref[1]) < r.TABLAS.indexOf(tabla), `${tabla} debe ir después de ${ref[1]}`);
    }
  }
});

test('ida y vuelta: crear copia, ensuciar la base, restaurar y quedar idéntico', async () => {
  const antes = await foto();
  const copia = await r.crearRespaldo({ ahora: AHORA });
  assert.match(copia.nombre, /^radas-\d{8}-\d{6}\.json\.gz$/);
  assert.ok(copia.filas.producto > 0 && copia.filas.pedido > 0);

  // Se rompe todo: cambia un precio, se borran los pedidos y se agrega un usuario
  await db.query('UPDATE producto SET precio = precio + 1');
  await db.query('DELETE FROM item_pedido');
  await db.query('DELETE FROM pedido');
  await db.query("INSERT INTO usuario (nombre, email, contrasena, rol) VALUES ('Intruso', 'i@x.com', 'x', 'cajero')");
  assert.notEqual(await foto(), antes);

  const datos = r.interpretar(readFileSync(path.join(dir, copia.nombre)));
  const resumen = await r.restaurar(datos);
  assert.equal(resumen.producto, copia.filas.producto);
  assert.equal(await foto(), antes);

  // Los contadores de id siguen donde corresponde: insertar después de restaurar no choca con ids existentes
  const { rows } = await db.query("INSERT INTO proveedor (nombre) VALUES ('Proveedor nuevo') RETURNING id");
  const { rows: max } = await db.query('SELECT MAX(id) AS m FROM proveedor');
  assert.equal(rows[0].id, max[0].m);
  const { rows: ids } = await db.query('SELECT id FROM proveedor');
  assert.equal(new Set(ids.map((x) => x.id)).size, ids.length);
});

test('restaurar es todo o nada: una copia dañada no deja la base a medias', async () => {
  const copia = await r.crearRespaldo({ ahora: new Date(AHORA.getTime() + 5000) });
  const datos = r.interpretar(readFileSync(path.join(dir, copia.nombre)));
  datos.tablas.item_pedido.push({ ...datos.tablas.item_pedido[0], id: 999999, id_pedido: 888888 }); // pedido inexistente
  const antes = await foto();
  await assert.rejects(r.restaurar(datos));
  assert.equal(await foto(), antes);
});

test('interpretar rechaza archivos que no son copias o están incompletos', () => {
  assert.throws(() => r.interpretar(Buffer.from('hola')), /no se pudo leer/);
  assert.throws(() => r.interpretar(gzipSync(Buffer.from(JSON.stringify({ formato: 'otro' })))), /no es una copia/);
  assert.throws(() => r.interpretar(gzipSync(Buffer.from(JSON.stringify({ formato: r.FORMATO, version: 1, tablas: { usuario: [] } })))), /incompleto/);
  assert.throws(() => r.interpretar(gzipSync(Buffer.from(JSON.stringify({ formato: r.FORMATO, version: 99, tablas: {} })))), /más nueva/);
});

test('restaurar tolera columnas que la base ya no tiene', async () => {
  const datos = await r.volcar();
  for (const fila of datos.tablas.mesa) fila.columna_vieja = 'x';
  await r.restaurar(r.interpretar(Buffer.from(JSON.stringify(datos))));
});

test('dos copias en el mismo segundo no se pisan, y se conservan solo las últimas N', async () => {
  const limpio = mkdtempSync(path.join(tmpdir(), 'radas-dep-'));
  try {
    const nombres = new Set();
    for (let i = 0; i < 5; i += 1) nombres.add((await r.crearRespaldo({ dir: limpio, ahora: AHORA })).nombre);
    assert.equal(nombres.size, 5);
    assert.equal(r.listar(limpio).length, 5);
    const borradas = r.depurar(limpio, 3);
    assert.equal(borradas.length, 2);
    const quedan = r.listar(limpio).map((c) => c.nombre);
    assert.equal(quedan.length, 3);
    assert.deepEqual(quedan, [...nombres].sort().reverse().slice(0, 3)); // quedan las más nuevas
    assert.deepEqual(readdirSync(limpio).filter((n) => n.endsWith('.tmp')), []);
    // archivos ajenos en la carpeta no se tocan ni se listan
    writeFileSync(path.join(limpio, 'notas.txt'), 'x');
    r.depurar(limpio, 1);
    assert.ok(existsSync(path.join(limpio, 'notas.txt')));
  } finally {
    rmSync(limpio, { recursive: true, force: true });
  }
});

// Restaurar borra las sesiones (a propósito): se vuelve a iniciar sesión con los mismos usuarios
const reiniciarSesiones = async () => {
  admin.token = (await crearSesion(admin.usuario.id, AHORA, 24 * 365)).token;
  cajero.token = (await crearSesion(cajero.usuario.id, AHORA, 24 * 365)).token;
};

test('API: solo el administrador; crear, listar y descargar dejan rastro en la auditoría', async () => {
  await reiniciarSesiones();
  esperar(await api('GET', '/respaldos', { token: cajero.token, ahora: AHORA }), 403);
  esperar(await api('POST', '/respaldos', { token: cajero.token, ahora: AHORA }), 403);
  const nueva = esperar(await api('POST', '/respaldos', { token: admin.token, ahora: new Date(AHORA.getTime() + 60_000) }), 201);
  const est = esperar(await api('GET', '/respaldos', { token: admin.token, ahora: new Date(AHORA.getTime() + 3_600_000 * 5) }), 200);
  assert.ok(est.copias.some((c) => c.nombre === nueva.nombre));
  assert.equal(est.ultima_copia_horas, 4); // la más nueva es de hace 4 h 59 min
  assert.equal(est.ultima_salida_horas, null); // todavía nadie la descargó
  const bajada = await api('GET', `/respaldos/${nueva.nombre}`, { token: admin.token, ahora: AHORA });
  assert.equal(bajada.status, 200);
  assert.ok(bajada.body instanceof Descarga);
  assert.doesNotThrow(() => r.interpretar(bajada.body.buffer));
  const est2 = esperar(await api('GET', '/respaldos', { token: admin.token, ahora: new Date(AHORA.getTime() + 3_600_000 * 5) }), 200);
  assert.equal(est2.ultima_salida_horas, 5); // la descarga cuenta como copia fuera del servidor
  const acciones = (await db.query("SELECT accion FROM auditoria WHERE accion LIKE 'respaldo.%'")).rows.map((x) => x.accion);
  assert.ok(acciones.includes('respaldo.crear') && acciones.includes('respaldo.descargar'));
});

test('API: no se puede pedir un archivo fuera de la carpeta de copias', async () => {
  for (const nombre of ['..%2F..%2Fetc%2Fpasswd', 'radas-20260101-000000.json.gz%2F..%2Fx', 'cualquiera.txt', '.env']) {
    const res = await api('GET', `/respaldos/${nombre}`, { token: admin.token, ahora: AHORA });
    assert.equal(res.status, 400, nombre);
  }
  esperar(await api('GET', '/respaldos/radas-20000101-000000.json.gz', { token: admin.token, ahora: AHORA }), 404);
});

test('copia automática: crea, depura y avisa a la copia externa; si el envío falla queda registrado', async () => {
  const limpio = mkdtempSync(path.join(tmpdir(), 'radas-auto-'));
  const marca = path.join(limpio, 'enviada.txt');
  const antes = { ...config.respaldo };
  try {
    config.respaldo.conservar = 2;
    config.respaldo.comandoExterno = `node -e "require('fs').writeFileSync(process.argv[1], process.env.RESPALDO_ARCHIVO)" "${marca}"`;
    const a = await r.hacerRespaldoAutomatico({ dir: limpio, ahora: AHORA });
    assert.equal(a.externo.ok, true);
    assert.ok(readFileSync(marca, 'utf8').endsWith(a.nombre));
    config.respaldo.comandoExterno = 'node -e "process.exit(3)"';
    const b = await r.hacerRespaldoAutomatico({ dir: limpio, ahora: new Date(AHORA.getTime() + 2000) });
    assert.equal(b.externo.ok, false);
    await r.hacerRespaldoAutomatico({ dir: limpio, ahora: new Date(AHORA.getTime() + 4000) });
    assert.equal(r.listar(limpio).length, 2);
    const { rows } = await db.query("SELECT resultado FROM auditoria WHERE accion = 'respaldo.externo' ORDER BY id");
    assert.deepEqual(rows.map((x) => x.resultado).slice(0, 2), ['ok', 'fallido']);
    // sin comando externo configurado no se intenta nada
    config.respaldo.comandoExterno = null;
    assert.equal((await r.hacerRespaldoAutomatico({ dir: limpio, ahora: new Date(AHORA.getTime() + 6000) })).externo, null);
  } finally {
    Object.assign(config.respaldo, antes);
    rmSync(limpio, { recursive: true, force: true });
  }
});

test('script de terminal: crear, listar, verificar y restaurar (pide confirmación)', async () => {
  const limpio = mkdtempSync(path.join(tmpdir(), 'radas-cli-'));
  const antes = config.respaldo.dir;
  const lineas = [];
  const salida = { log: (t) => lineas.push(t) };
  const opciones = { salida, conectar: async () => {}, cerrar: false };
  const { ejecutar } = await import('../src/modules/respaldo/cli.js');
  try {
    config.respaldo.dir = limpio;
    await assert.rejects(ejecutar(['borrar'], opciones), /Uso:/);
    await ejecutar(['listar'], opciones);
    assert.match(lineas.at(-1), /No hay copias/);
    await ejecutar(['crear'], opciones);
    const [{ nombre }] = r.listar(limpio);
    assert.ok(lineas.some((l) => l.includes(nombre)));
    await ejecutar(['verificar', path.join(limpio, nombre)], opciones);
    assert.match(lineas.at(-2), /Copia válida/);

    const conCambio = await foto(true);
    await db.query("UPDATE mesa SET capacidad = capacidad + 1");
    await ejecutar(['restaurar', path.join(limpio, nombre)], opciones); // sin --si: no toca nada
    assert.match(lineas.at(-1), /agregando --si/);
    assert.notEqual(await foto(true), conCambio);
    await ejecutar(['restaurar', path.join(limpio, nombre), '--si'], opciones);
    assert.equal(await foto(true), conCambio);
    assert.equal(r.listar(limpio).length, 2); // la copia original + la de seguridad previa a restaurar
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'respaldo.restaurar'")).rows[0].n, 1);

    writeFileSync(path.join(limpio, 'roto.json.gz'), 'basura');
    await assert.rejects(ejecutar(['restaurar', path.join(limpio, 'roto.json.gz'), '--si'], opciones), /no se pudo leer/);
  } finally {
    config.respaldo.dir = antes;
    rmSync(limpio, { recursive: true, force: true });
  }
});
