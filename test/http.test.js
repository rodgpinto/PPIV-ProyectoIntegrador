// Pruebas del servidor HTTP real (puerto efímero): cabeceras, compresión, caché, límites y rutas estáticas.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { despachar } from '../src/api.js';
import { crearServidor } from '../src/http/servidor.js';
import { crearUsuario, CLAVE, iniciarBase } from './ayuda.js';

let servidor; let base; let publico;

before(async () => {
  await iniciarBase();
  await crearUsuario('administrador', 'Admin HTTP', 'admin-http@test.local', CLAVE);
  publico = mkdtempSync(path.join(tmpdir(), 'radas-pub-'));
  mkdirSync(path.join(publico, 'assets'));
  writeFileSync(path.join(publico, 'index.html'), '<!doctype html><title>RADAS</title>');
  writeFileSync(path.join(publico, 'assets', 'app-abc123.js'), 'console.log("x");'.repeat(200));
  writeFileSync(path.join(path.dirname(publico), 'secreto-radas.txt'), 'no debe salir');
  servidor = crearServidor({ despachar, publicDir: publico });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => new Promise((r) => servidor.close(r)));

const pedir = (ruta, opciones = {}) => fetch(base + ruta, { redirect: 'manual', ...opciones });

test('salud y cabeceras de seguridad', async () => {
  const r = await pedir('/api/salud');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('login por HTTP, sesión y rechazo sin token', async () => {
  const mal = await pedir('/api/auth/me');
  assert.equal(mal.status, 401);
  const login = await pedir('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin-http@test.local', password: CLAVE }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const yo = await pedir('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(yo.status, 200);
  assert.equal((await yo.json()).usuario.rol, 'administrador');
});

test('JSON inválido da 400 y un cuerpo enorme da 413', async () => {
  const roto = await pedir('/api/auth/login', { method: 'POST', body: '{no es json' });
  assert.equal(roto.status, 400);
  const grande = await pedir('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'x'.repeat(200 * 1024) }) }).catch(() => null);
  // el servidor corta la conexión al pasar el límite: puede verse como 413 o como conexión cerrada
  if (grande) assert.equal(grande.status, 413);
});

test('la carta es pública, se comprime y revalida con ETag', async () => {
  const r = await pedir('/api/carta', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.status, 200);
  const etag = r.headers.get('etag');
  assert.ok(etag);
  const otra = await pedir('/api/carta', { headers: { 'if-none-match': etag } });
  assert.equal(otra.status, 304);
});

test('estáticos: index sin caché, assets inmutables, gzip y 404 de archivos inexistentes', async () => {
  const index = await pedir('/');
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('cache-control'), 'no-cache');
  const js = await pedir('/assets/app-abc123.js', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.equal(js.headers.get('content-encoding'), 'gzip');
  assert.match(await js.text(), /console\.log/); // fetch descomprime solo
  assert.equal((await pedir('/assets/no-existe.js')).status, 404);
});

test('no se puede salir de la carpeta pública (path traversal)', async () => {
  for (const ruta of ['/../secreto-radas.txt', '/%2e%2e/secreto-radas.txt', '/..%2fsecreto-radas.txt']) {
    const r = await pedir(ruta);
    const texto = await r.text();
    assert.ok(!texto.includes('no debe salir'), ruta);
  }
});

test('métodos no permitidos fuera de /api', async () => {
  assert.equal((await pedir('/', { method: 'POST' })).status, 405);
});
