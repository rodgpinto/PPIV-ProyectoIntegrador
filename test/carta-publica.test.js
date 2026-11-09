// La carta de los clientes (QR): página aparte, sin sesión, sin enlaces ni scripts del sistema del personal.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { despachar } from '../src/api.js';
import { crearServidor } from '../src/http/servidor.js';
import { pesosCarta, renderCarta } from '../src/http/carta-publica.js';
import { api, AHORA, conSesion, esperar, iniciarBase } from './ayuda.js';

let servidor; let base;
before(async () => {
  await iniciarBase();
  const admin = await conSesion('administrador');
  const nuevo = async (nombre, categoria, precio, descripcion = '') =>
    esperar(await api('POST', '/productos', { token: admin.token, ahora: AHORA, body: { nombre, categoria, precio, destino: 'barra', descripcion } }), 201);
  await nuevo('Negroni', 'Tragos', 9500.5, 'Gin, vermut y bitter');
  await nuevo('Fernet con coca', 'Tragos', 8000);
  await nuevo('Tabla de fiambres', 'Para picar', 18000);
  await nuevo('<img src=x onerror=alert(1)>', 'Tragos & más', 100, '<script>alert("x")</script>');
  const baja = await nuevo('Producto de baja', 'Tragos', 1);
  esperar(await api('DELETE', `/productos/${baja.id}`, { token: admin.token, ahora: AHORA }), 200);
  servidor = crearServidor({ despachar, publicDir: null });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => new Promise((r) => servidor.close(r)));

test('/carta devuelve la carta completa en HTML, sin iniciar sesión', async () => {
  const r = await fetch(`${base}/carta`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('cache-control'), /max-age=60/);
  const html = await r.text();
  assert.match(html, /<html lang="es-AR">/);
  for (const t of ['Negroni', 'Gin, vermut y bitter', '$ 9.500,50', '$ 8.000', 'Tabla de fiambres', '$ 18.000', 'Para picar']) assert.ok(html.includes(t), t);
  assert.ok(!html.includes('Producto de baja'), 'los productos dados de baja no se muestran');
  assert.match(html, /<nav class="secciones"/);
  assert.ok(html.indexOf('Para picar') < html.indexOf('Tragos'), 'categorías en orden alfabético'); // Para picar < Tragos
});

test('la carta de clientes no tiene nada del sistema del personal', async () => {
  const html = await (await fetch(`${base}/carta/`)).text();
  assert.ok(!/<script/i.test(html), 'sin JavaScript');
  assert.ok(!/login|iniciar sesi|ingresar|#\/|\/api\/|administrador/i.test(html));
  assert.ok(!/<a [^>]*href="(?!#)/.test(html), 'solo enlaces internos a las categorías');
});

test('escapa HTML: un nombre o una descripción con etiquetas no se ejecuta', async () => {
  const html = await (await fetch(`${base}/carta`)).text();
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Tragos &amp; más'));
});

test('hoja de estilos propia, y cualquier otra ruta bajo /carta/ da 404', async () => {
  const css = await fetch(`${base}/carta/estilos.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.headers.get('content-security-policy'), /style-src 'self'/);
  assert.equal((await fetch(`${base}/carta/otra`)).status, 404);
  assert.equal((await fetch(`${base}/carta/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/carta`, { method: 'POST' })).status, 405);
});

test('formato de precios y carta vacía', () => {
  assert.equal(pesosCarta(1234567.5), '$ 1.234.567,50');
  assert.equal(pesosCarta(0), '$ 0');
  assert.equal(pesosCarta(950), '$ 950');
  const vacia = renderCarta([]);
  assert.match(vacia, /se está actualizando/);
  assert.ok(!vacia.includes('<nav'));
});
