// El escenario grande de datos de ejemplo tiene que quedar coherente: stock, lotes, ventas y caja cuadran entre sí.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { db } from '../src/db.js';
import { CLAVE_DEMO } from '../src/seed-demo.js';
import { sembrarCompleto, USUARIOS_COMPLETO } from '../src/seed-completo.js';
import { api, esperar, iniciarBase } from './ayuda.js';

const AHORA = new Date('2026-10-15T00:30:00Z'); // miércoles 14/10, 21:30 en Buenos Aires
let resumen;
let token;
const consulta = async (sql) => (await db.query(sql)).rows;

before(async () => {
  await iniciarBase();
  resumen = await sembrarCompleto({ ahora: AHORA, dias: 8 });
  token = esperar(await api('POST', '/auth/login', { body: { email: 'admin@radas.test', password: CLAVE_DEMO }, ahora: AHORA }), 200).token;
});

test('carga ventas, cierres de caja, ingresos y fichajes de varias noches', () => {
  assert.equal(resumen.hoy, '2026-10-14');
  assert.ok(resumen.cuentas > 80 && resumen.cierres >= 5 && resumen.ingresos > 20 && resumen.fichajes > 30);
});

test('es idempotente: con datos cargados no cambia nada', async () => {
  assert.equal(await sembrarCompleto({ ahora: AHORA, dias: 8 }), null);
});

test('todos los usuarios entran con la clave de ejemplo', async () => {
  for (const [, email, rol] of USUARIOS_COMPLETO) {
    const r = esperar(await api('POST', '/auth/login', { body: { email, password: CLAVE_DEMO }, ahora: AHORA }), 200);
    assert.equal(r.usuario.rol, rol);
  }
});

test('el stock de cada insumo es la suma de sus lotes y ninguno queda en negativo', async () => {
  const filas = await consulta(`SELECT i.nombre, i.stock_actual, COALESCE(SUM(l.cantidad_actual), 0) AS en_lotes
    FROM insumo i LEFT JOIN lote_insumo l ON l.id_insumo = i.id GROUP BY i.id, i.nombre, i.stock_actual`);
  for (const f of filas) {
    assert.ok(Number(f.stock_actual) >= 0, `${f.nombre} quedó en negativo`);
    assert.ok(Math.abs(Number(f.stock_actual) - Number(f.en_lotes)) < 0.01, `${f.nombre}: stock ${f.stock_actual} y lotes ${f.en_lotes}`);
  }
});

test('las noches anteriores tienen la caja cerrada y coincide con las cuentas cobradas', async () => {
  const cierres = await consulta('SELECT fecha_jornada, canal, cuentas, ventas_total FROM cierre_caja');
  assert.ok(cierres.length > 0);
  const total = cierres.reduce((s, c) => s + Number(c.ventas_total), 0);
  const [{ suma, n }] = await consulta("SELECT SUM(total) AS suma, COUNT(*) AS n FROM pedido WHERE estado = 'cerrado' AND cerrado_en < '2026-10-14T09:00:00Z'");
  assert.equal(total, Number(suma));
  assert.equal(cierres.reduce((s, c) => s + Number(c.cuentas), 0), Number(n));
  assert.ok(!cierres.some((c) => c.fecha_jornada === '2026-10-14'), 'la noche en curso no está cerrada');
});

test('hay cuentas abiertas y personal trabajando en este momento', async () => {
  const [{ n }] = await consulta("SELECT COUNT(*) AS n FROM pedido WHERE estado = 'abierto'");
  assert.ok(Number(n) >= 3);
  const [{ n: abiertos }] = await consulta('SELECT COUNT(*) AS n FROM fichaje WHERE egreso IS NULL');
  assert.ok(Number(abiertos) >= 3);
});

test('hay alertas de reposición, de vencimiento y el salón tiene aforo de 32', async () => {
  const a = esperar(await api('GET', '/stock/alertas', { token, ahora: AHORA }), 200);
  assert.ok(a.reponer.length > 0 && a.por_vencer.length > 0);
  const m = esperar(await api('GET', '/mesas', { token, ahora: AHORA }), 200);
  assert.equal(m.resumen.aforo, 32);
});

test('el historial queda con la fecha de cuando ocurrió, no la de la carga', async () => {
  const [{ minimo }] = await consulta('SELECT MIN(fecha_hora) AS minimo FROM movimiento_stock');
  assert.ok(new Date(minimo) < new Date('2026-10-08T12:00:00Z'));
  const [{ pasados }] = await consulta("SELECT COUNT(*) AS pasados FROM lote_insumo WHERE creado_en < '2026-10-10T00:00:00Z'");
  assert.ok(Number(pasados) > 0);
});
