// Los datos de ejemplo deben cargarse una sola vez, ser coherentes y permitir iniciar sesión.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { CLAVE_DEMO, sembrarDemo, USUARIOS_DEMO } from '../src/seed-demo.js';
import { AHORA, api, esperar, iniciarBase } from './ayuda.js';

let token;
before(async () => {
  await iniciarBase();
  assert.equal(await sembrarDemo(AHORA), true);
  const r = esperar(await api('POST', '/auth/login', { body: { email: 'admin@radas.test', password: CLAVE_DEMO }, ahora: AHORA }), 200);
  token = r.token;
});

test('es idempotente: la segunda vez no cambia nada', async () => {
  assert.equal(await sembrarDemo(AHORA), false);
  const u = esperar(await api('GET', '/usuarios', { token, ahora: AHORA }), 200);
  assert.equal((u.usuarios ?? u).length, USUARIOS_DEMO.length);
});

test('los seis perfiles de ejemplo pueden entrar', async () => {
  for (const [, email, rol] of USUARIOS_DEMO) {
    const r = esperar(await api('POST', '/auth/login', { body: { email, password: CLAVE_DEMO }, ahora: AHORA }), 200);
    assert.equal(r.usuario.rol, rol);
  }
});

test('hay alertas de todos los tipos y el salón suma el aforo de 32', async () => {
  const a = esperar(await api('GET', '/stock/alertas', { token, ahora: AHORA }), 200);
  assert.ok(a.reponer.length > 0 && a.por_vencer.length > 0 && a.vencidos.length > 0 && a.sobrestock.length > 0);
  const m = esperar(await api('GET', '/mesas', { token, ahora: AHORA }), 200);
  assert.equal(m.resumen.aforo, 32);
});

test('los productos de ejemplo tienen costo y margen calculados', async () => {
  const p = esperar(await api('GET', '/productos', { token, ahora: AHORA }), 200);
  const lista = p.productos ?? p;
  const negroni = lista.find((x) => x.nombre === 'Negroni');
  assert.ok(negroni && negroni.costo > 0 && negroni.margen_pct > 0);
});

test('hay cuentas abiertas con pedidos en distintos estados y la pantalla de cocina no arranca vacía', async () => {
  const cuentas = esperar(await api('GET', '/pedidos', { token, ahora: AHORA }), 200);
  assert.equal(cuentas.length, 4);
  const estados = new Set(cuentas.flatMap((c) => c.items.map((i) => i.estado)));
  assert.ok(['pendiente', 'preparando', 'listo', 'entregado'].every((e) => estados.has(e)));
  const barra = esperar(await api('GET', '/kds', { token, query: { destino: 'barra' }, ahora: AHORA }), 200);
  const cocina = esperar(await api('GET', '/kds', { token, query: { destino: 'cocina' }, ahora: AHORA }), 200);
  assert.ok(barra.items.length > 0 && cocina.items.length > 0);
  const mesas = esperar(await api('GET', '/mesas', { token, ahora: AHORA }), 200);
  assert.equal(mesas.resumen.ocupadas, 3);   // Mesa 1, Mesa 3 y Living A tienen cuenta
});

test('hay ventas de noches anteriores: el reporte tiene datos, no hay lunes y los márgenes salen de las recetas', async () => {
  const r = esperar(await api('GET', '/reportes/ventas', { token, query: { desde: '2026-10-01', hasta: '2026-10-14' }, ahora: AHORA }), 200);
  assert.ok(r.resumen.cuentas >= 30 && r.resumen.ventas > 0 && r.resumen.margen_pct > 40);
  assert.ok(r.por_jornada.length >= 5 && r.por_jornada.every((j) => new Date(`${j.fecha}T12:00:00Z`).getUTCDay() !== 1));
  assert.deepEqual(r.por_medio.map((m) => m.medio_pago), ['efectivo', 'tarjeta', 'mercado_pago', 'transferencia']);
  const hoy = esperar(await api('GET', '/caja/jornada', { token, ahora: AHORA }), 200);
  assert.equal(hoy.cierre, null);
  assert.equal(hoy.abiertas.length, 4); // las cuentas abiertas de ejemplo impedirían cerrar la caja
});
