import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, AHORA, conSesion, esperar, iniciarBase } from './ayuda.js';
import { db } from '../src/db.js';
import { rutas } from '../src/api.js';
import { ETIQUETAS, diferencias, limpiar } from '../src/domain/auditoria.js';

let admin;
let cajero;
before(async () => {
  await iniciarBase();
  admin = await conSesion('administrador');
  cajero = await conSesion('cajero');
});

const ultimas = async (accion) => (await db.query('SELECT * FROM auditoria WHERE accion = $1 ORDER BY id DESC', [accion])).rows;

test('toda ruta que modifica datos tiene etiqueta de auditoría', () => {
  const sin = rutas.filter((r) => r.metodo !== 'GET' && !ETIQUETAS[`${r.metodo} ${r.ruta}`]).map((r) => `${r.metodo} ${r.ruta}`);
  assert.deepEqual(sin, [], 'Agregá estas rutas a ETIQUETAS en src/domain/auditoria.js');
  const claves = new Set(rutas.map((r) => `${r.metodo} ${r.ruta}`));
  const huerfanas = Object.keys(ETIQUETAS).filter((k) => !claves.has(k));
  assert.deepEqual(huerfanas, [], 'Etiquetas de rutas que ya no existen');
});

test('limpiar oculta secretos a cualquier profundidad y recorta textos largos', () => {
  const l = limpiar({ nombre: 'Ana', contrasena: 'x', anidado: { password: 'y', token: 'z', ok: 1 }, largo: 'a'.repeat(500), lista: Array.from({ length: 30 }, (_, i) => i) });
  assert.equal(l.contrasena, '(oculto)');
  assert.equal(l.anidado.password, '(oculto)');
  assert.equal(l.anidado.token, '(oculto)');
  assert.equal(l.anidado.ok, 1);
  assert.equal(l.largo.length, 201);
  assert.equal(l.lista.length, 21);
});

test('diferencias solo devuelve lo que cambió', () => {
  assert.deepEqual(diferencias({ a: 1, b: 2 }, { a: 1, b: 3 }), { b: [2, 3] });
  assert.deepEqual(diferencias({ a: 1 }, { a: 1 }), {});
});

test('un cambio de precio queda con quién, cuándo y antes → después', async () => {
  const p = esperar(await api('POST', '/productos', { token: admin.token, body: { nombre: 'Fernet', categoria: 'Tragos', precio: 4500, destino: 'barra' }, ahora: AHORA }), 201);
  esperar(await api('PATCH', `/productos/${p.id}/precio`, { token: admin.token, body: { precio: 5200 }, ahora: AHORA }), 200);
  const [fila] = await ultimas('producto.precio');
  assert.equal(fila.id_usuario, admin.usuario.id);
  assert.equal(fila.rol, 'administrador');
  assert.equal(fila.id_entidad, String(p.id));
  assert.equal(fila.resultado, 'ok');
  const detalle = JSON.parse(fila.detalle);
  assert.deepEqual(detalle.cambios.precio, [4500, 5200]);
  assert.equal(new Date(fila.fecha_hora).toISOString(), AHORA.toISOString());
});

test('el login registra el intento, no guarda la contraseña y distingue éxito de fallo', async () => {
  await api('POST', '/auth/login', { body: { email: 'nadie@nada.com', password: 'secreta-123' }, ahora: AHORA });
  const [fallo] = await ultimas('auth.login');
  assert.equal(fallo.resultado, 'fallido');
  assert.equal(fallo.id_usuario, null);
  assert.ok(!fallo.detalle.includes('secreta-123'));
  assert.equal(JSON.parse(fallo.detalle).email, 'nadie@nada.com');
});

test('un usuario sin permiso deja un acceso denegado; los GET comunes no se registran', async () => {
  esperar(await api('POST', '/productos', { token: cajero.token, body: { nombre: 'X', categoria: 'Y', precio: 1, destino: 'barra' }, ahora: AHORA }), 403);
  const [d] = await ultimas('sistema.acceso_denegado');
  assert.equal(d.resultado, 'denegado');
  assert.equal(d.id_usuario, cajero.usuario.id);
  const antes = (await db.query('SELECT COUNT(*) AS n FROM auditoria')).rows[0].n;
  esperar(await api('GET', '/productos', { token: admin.token, ahora: AHORA }), 200);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM auditoria')).rows[0].n, antes);
});

test('un dato inválido (400) no ensucia el registro', async () => {
  const antes = (await db.query('SELECT COUNT(*) AS n FROM auditoria')).rows[0].n;
  esperar(await api('POST', '/productos', { token: admin.token, body: { nombre: '' }, ahora: AHORA }), 400);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM auditoria')).rows[0].n, antes);
});

test('cambiar el rol de un usuario guarda el antes y el después, y la clave nunca se ve', async () => {
  const u = esperar(await api('POST', '/usuarios', { token: admin.token, body: { nombre: 'Lu', email: 'lu@x.com', password: 'una-clave-larga-1', rol: 'camarero' }, ahora: AHORA }), 201);
  const crear = (await ultimas('usuario.crear'))[0];
  assert.ok(!crear.detalle.includes('una-clave-larga-1'));
  esperar(await api('PATCH', `/usuarios/${u.id}`, { token: admin.token, body: { rol: 'cajero', password: 'otra-clave-larga-2' }, ahora: AHORA }), 200);
  const [fila] = await ultimas('usuario.editar');
  const d = JSON.parse(fila.detalle);
  assert.deepEqual(d.cambios.rol, ['camarero', 'cajero']);
  assert.ok(!fila.detalle.includes('otra-clave-larga-2'));
});

test('GET /auditoria: solo administrador, con filtros y paginación', async () => {
  esperar(await api('GET', '/auditoria', { token: cajero.token, ahora: AHORA }), 403);
  const todo = esperar(await api('GET', '/auditoria', { token: admin.token }), 200);
  assert.ok(todo.filas.length >= 5);
  assert.ok(todo.acciones.some((a) => a.codigo === 'producto.precio'));
  const solo = esperar(await api('GET', '/auditoria', { token: admin.token, query: { accion: 'producto.precio' } }), 200);
  assert.ok(solo.filas.every((f) => f.accion === 'producto.precio'));
  assert.equal(typeof solo.filas[0].detalle, 'object');
  const pag = esperar(await api('GET', '/auditoria', { token: admin.token, query: { limite: '2' } }), 200);
  assert.equal(pag.filas.length, 2);
  assert.equal(pag.hay_mas, true);
  const sig = esperar(await api('GET', '/auditoria', { token: admin.token, query: { limite: '2', antes_de_id: String(pag.filas[1].id) } }), 200);
  assert.ok(sig.filas[0].id < pag.filas[1].id);
  const porUsuario = esperar(await api('GET', '/auditoria', { token: admin.token, query: { id_usuario: String(cajero.usuario.id) } }), 200);
  assert.ok(porUsuario.filas.every((f) => f.id_usuario === cajero.usuario.id));
  esperar(await api('GET', '/auditoria', { token: admin.token, query: { desde: 'ayer' } }), 400);
  const hoy = esperar(await api('GET', '/auditoria', { token: admin.token, query: { desde: '2026-10-14', hasta: '2026-10-14' } }), 200);
  assert.ok(hoy.filas.length > 0);
  const futuro = esperar(await api('GET', '/auditoria', { token: admin.token, query: { desde: '2026-10-20' } }), 200);
  assert.equal(futuro.filas.length, 0);
});
