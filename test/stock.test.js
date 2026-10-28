import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

// "Hoy" en Buenos Aires es 2026-10-14 (AHORA = 12:00 locales)
let admin;
const ids = {};
const post = (ruta, body, token = admin) => api('POST', ruta, { token, body, ahora: AHORA });
const get = (ruta, query) => api('GET', ruta, { token: admin, query, ahora: AHORA });

before(async () => {
  await iniciarBase();
  admin = (await conSesion('administrador')).token;
});

async function crearInsumo(nombre, unidad = 'ml', extra = {}) {
  ids[nombre] = esperar(await post('/insumos', { nombre, unidad, ...extra }), 201).id;
}
const insumoActual = async (nombre) => esperar(await get('/insumos'), 200).find((i) => i.nombre === nombre);

test('ingreso: guarda lote con fecha de ingreso, vencimiento y costo; actualiza stock y costo del insumo', async () => {
  await crearInsumo('Leche', 'ml');
  const r = esperar(await post('/stock/ingresos', { id_insumo: ids.Leche, cantidad: 1000, costo_total: 1500, fecha_vencimiento: '2026-10-20' }), 201);
  assert.equal(r.costo_unitario, 1.5);
  assert.equal(r.stock_actual, 1000);
  const [lote] = esperar(await get('/stock/lotes', { id_insumo: String(ids.Leche) }), 200);
  assert.equal(lote.fecha_ingreso, '2026-10-14'); // por defecto, hoy en la zona del local
  assert.equal(lote.fecha_vencimiento, '2026-10-20');
  assert.equal(lote.cantidad_actual, 1000);
  assert.equal((await insumoActual('Leche')).costo_unitario, 1.5);
});

test('ingreso: validaciones', async () => {
  const base = { id_insumo: ids.Leche, cantidad: 10 };
  assert.equal((await post('/stock/ingresos', { ...base, cantidad: 0 })).status, 400);
  assert.equal((await post('/stock/ingresos', { ...base, costo_total: 10, costo_unitario: 1 })).status, 400);
  assert.equal((await post('/stock/ingresos', { ...base, fecha_ingreso: '2026-10-15' })).status, 400); // futuro
  assert.equal((await post('/stock/ingresos', { ...base, fecha_ingreso: '2026-10-10', fecha_vencimiento: '2026-10-09' })).status, 400);
  assert.equal((await post('/stock/ingresos', { ...base, fecha_ingreso: '14/10/2026' })).status, 400);
  assert.equal((await post('/stock/ingresos', { ...base, id_insumo: 9999 })).status, 404);
  assert.equal((await post('/stock/ingresos', { ...base, id_proveedor: 9999 })).status, 422);
  assert.equal((await insumoActual('Leche')).stock_actual, 1000); // nada de lo anterior sumó stock
});

test('ingreso sin costo: se registra y avisa que falta el costo', async () => {
  await crearInsumo('Sal', 'g');
  const r = esperar(await post('/stock/ingresos', { id_insumo: ids.Sal, cantidad: 500 }), 201);
  assert.equal(r.sin_costo, true);
  assert.equal((await insumoActual('Sal')).costo_unitario, 0);
});

test('FEFO: las mermas consumen primero el lote que vence antes, no el más viejo', async () => {
  await crearInsumo('Crema', 'ml');
  const ing = (cant, venc, desde) => post('/stock/ingresos', { id_insumo: ids.Crema, cantidad: cant, costo_total: cant, fecha_ingreso: desde, fecha_vencimiento: venc });
  esperar(await ing(100, '2026-11-30', '2026-10-09'), 201); // A: el más viejo, vence tarde
  esperar(await ing(100, '2026-10-24', '2026-10-13'), 201); // B: vence primero
  esperar(await ing(100, null, '2026-10-05'), 201); // C: no vence, va al final
  const r = esperar(await post('/stock/mermas', { id_insumo: ids.Crema, cantidad: 150, motivo: 'se_cayo' }), 201);
  assert.equal(r.faltante, 0);
  assert.equal(r.stock_actual, 150);
  const lotes = esperar(await get('/stock/lotes', { id_insumo: String(ids.Crema) }), 200);
  // quedan: A con 50 (B se agotó) y C con 100
  assert.deepEqual(lotes.map((l) => [l.fecha_vencimiento, l.cantidad_actual]).sort(), [[null, 100], ['2026-11-30', 50]]);
});

test('merma: queda registrada con motivo, cantidad, usuario y fecha', async () => {
  const cocina = (await conSesion('cocina')).token;
  esperar(await post('/stock/mermas', { id_insumo: ids.Crema, cantidad: 10, motivo: 'consumo_interno', nota: 'prueba del chef' }, cocina), 201);
  const movs = esperar(await get('/stock/movimientos', { id_insumo: String(ids.Crema) }), 200);
  const m = movs.find((x) => x.motivo === 'consumo_interno');
  assert.equal(m.tipo, 'merma');
  assert.equal(m.cantidad, -10);
  assert.equal(m.usuario, 'Usuario cocina');
  assert.equal(m.nota, 'prueba del chef');
  assert.ok(m.fecha_hora);
});

test('merma: solo roles de operación; motivos válidos; cajero y host no', async () => {
  const body = { id_insumo: ids.Crema, cantidad: 1, motivo: 'vencido' };
  for (const rol of ['camarero', 'barra', 'cocina', 'administrador']) {
    assert.equal((await post('/stock/mermas', body, (await conSesion(rol)).token)).status, 201, rol);
  }
  for (const rol of ['cajero', 'host']) assert.equal((await post('/stock/mermas', body, (await conSesion(rol)).token)).status, 403, rol);
  assert.equal((await post('/stock/mermas', { ...body, motivo: 'robo' })).status, 400);
  assert.equal((await post('/stock/mermas', { ...body, cantidad: -1 })).status, 400);
});

test('sin stock suficiente se puede seguir (S-16): queda negativo y el próximo ingreso cubre el hueco', async () => {
  await crearInsumo('Hielo', 'g');
  esperar(await post('/stock/ingresos', { id_insumo: ids.Hielo, cantidad: 10, costo_total: 10 }), 201);
  const r = esperar(await post('/stock/mermas', { id_insumo: ids.Hielo, cantidad: 25, motivo: 'se_cayo' }), 201);
  assert.equal(r.faltante, 15);
  assert.equal(r.stock_actual, -15);
  assert.equal((await insumoActual('Hielo')).stock_actual, -15);

  esperar(await post('/stock/ingresos', { id_insumo: ids.Hielo, cantidad: 100, costo_total: 100 }), 201);
  assert.equal((await insumoActual('Hielo')).stock_actual, 85);
  // el stock coincide con la suma de los lotes: lo que ya se había "vendido" no se cuenta dos veces
  const lotes = esperar(await get('/stock/lotes', { id_insumo: String(ids.Hielo) }), 200);
  assert.equal(lotes.reduce((s, l) => s + l.cantidad_actual, 0), 85);
});

test('merma de un lote puntual (por ejemplo, el vencido) y control de su cantidad', async () => {
  await crearInsumo('Queso', 'g');
  esperar(await post('/stock/ingresos', { id_insumo: ids.Queso, cantidad: 300, costo_total: 300, fecha_ingreso: '2026-10-01', fecha_vencimiento: '2026-10-10' }), 201); // ya vencido
  esperar(await post('/stock/ingresos', { id_insumo: ids.Queso, cantidad: 300, costo_total: 300, fecha_ingreso: '2026-10-12', fecha_vencimiento: '2026-11-10' }), 201);
  const lotes = esperar(await get('/stock/lotes', { id_insumo: String(ids.Queso) }), 200);
  const vencido = lotes.find((l) => l.fecha_vencimiento === '2026-10-10');
  assert.equal((await post('/stock/mermas', { id_insumo: ids.Queso, cantidad: 400, motivo: 'vencido', id_lote: vencido.id })).status, 400);
  esperar(await post('/stock/mermas', { id_insumo: ids.Queso, cantidad: 300, motivo: 'vencido', id_lote: vencido.id }), 201);
  const quedan = esperar(await get('/stock/lotes', { id_insumo: String(ids.Queso) }), 200);
  assert.deepEqual(quedan.map((l) => l.cantidad_actual), [300]);
  assert.equal((await insumoActual('Queso')).stock_actual, 300);
});

test('ajuste por conteo físico: baja con FEFO, sube con un lote de ajuste y rechaza el que no cambia nada', async () => {
  const antes = (await insumoActual('Crema')).stock_actual;
  assert.equal((await post('/stock/ajustes', { id_insumo: ids.Crema, cantidad_real: antes })).status, 400);
  const baja = esperar(await post('/stock/ajustes', { id_insumo: ids.Crema, cantidad_real: antes - 30, nota: 'conteo del lunes' }), 201);
  assert.equal(baja.diferencia, -30);
  const sube = esperar(await post('/stock/ajustes', { id_insumo: ids.Crema, cantidad_real: 200 }), 201);
  assert.equal(sube.diferencia, 200 - (antes - 30));
  assert.equal((await insumoActual('Crema')).stock_actual, 200);
  const lotes = esperar(await get('/stock/lotes', { id_insumo: String(ids.Crema) }), 200);
  assert.equal(lotes.reduce((s, l) => s + l.cantidad_actual, 0), 200);
  assert.ok(lotes.some((l) => l.origen === 'ajuste'));
  const tipos = esperar(await get('/stock/movimientos', { id_insumo: String(ids.Crema) }), 200).filter((m) => m.tipo === 'ajuste');
  assert.equal(tipos.length, 2);
});

test('alertas: reponer, por vencer, vencidos y sobrestock con su antigüedad', async () => {
  await crearInsumo('Vino', 'ml', { stock_minimo: 1000, stock_maximo: 3000, dias_aviso_vencimiento: 10 });
  esperar(await post('/stock/ingresos', { id_insumo: ids.Vino, cantidad: 400, costo_total: 400, fecha_ingreso: '2026-10-01', fecha_vencimiento: '2026-10-12' }), 201); // vencido hace 2 días
  esperar(await post('/stock/ingresos', { id_insumo: ids.Vino, cantidad: 200, costo_total: 200, fecha_ingreso: '2026-10-10', fecha_vencimiento: '2026-10-20' }), 201); // vence en 6 días
  let a = esperar(await get('/stock/alertas'), 200);
  const reponer = a.reponer.find((x) => x.nombre === 'Vino');
  assert.deepEqual([reponer.stock_actual, reponer.faltante], [600, 400]);
  assert.deepEqual(a.vencidos.find((x) => x.nombre === 'Vino').dias_vencido, 2);
  assert.equal(a.por_vencer.find((x) => x.nombre === 'Vino').dias_restantes, 6);

  esperar(await post('/stock/ingresos', { id_insumo: ids.Vino, cantidad: 5000, costo_total: 5000, fecha_ingreso: '2026-09-24' }), 201); // exceso viejo
  a = esperar(await get('/stock/alertas'), 200);
  assert.ok(!a.reponer.some((x) => x.nombre === 'Vino')); // ya no está bajo el mínimo
  const sobre = a.sobrestock.find((x) => x.nombre === 'Vino');
  assert.equal(sobre.exceso, 5600 - 3000);
  assert.equal(sobre.dias_en_stock, 20); // el lote más viejo con stock entró el 24/09
  assert.equal(a.total, a.reponer.length + a.sobrestock.length + a.por_vencer.length + a.vencidos.length);
});

test('alertas: el mismo stock cambia de estado con el paso del tiempo', async () => {
  const dentroDe10Dias = new Date(AHORA.getTime() + 10 * 86400_000);
  const a = esperar(await api('GET', '/stock/alertas', { token: admin, ahora: dentroDe10Dias }), 200);
  // el lote que vencía el 20/10 ya está vencido el 24/10
  assert.ok(a.vencidos.some((x) => x.nombre === 'Vino' && x.fecha_vencimiento === '2026-10-20'));
});

import { db } from '../src/db.js';
import { consumirInsumo, revertirVenta } from '../src/modules/stock/stock.servicio.js';

const sumaLotes = async (id) => Number((await db.query('SELECT COALESCE(SUM(cantidad_actual), 0) AS s FROM lote_insumo WHERE id_insumo = $1', [id])).rows[0].s);

test('anular una venta que dejó el stock en negativo devuelve todo a su lugar: stock y lotes siguen iguales', async () => {
  await crearInsumo('Jugo', 'ml');
  esperar(await post('/stock/ingresos', { id_insumo: ids.Jugo, cantidad: 85, costo_total: 170 }), 201);
  const usuario = (await conSesion('administrador')).usuario;
  // se venden 100 con solo 85 en el depósito: 15 quedan "sin lote" y el stock en −15
  await db.transaction((tx) => consumirInsumo(tx, { id_insumo: ids.Jugo, cantidad: 100, tipo: 'venta', referencia: 'item:9001', id_usuario: usuario.id }));
  assert.equal((await insumoActual('Jugo')).stock_actual, -15);
  assert.equal(await sumaLotes(ids.Jugo), 0);
  await db.transaction((tx) => revertirVenta(tx, { referencia: 'item:9001', id_usuario: usuario.id, hoy: '2026-10-14' }));
  assert.equal((await insumoActual('Jugo')).stock_actual, 85);
  assert.equal(await sumaLotes(ids.Jugo), 85); // antes quedaban 100 en lotes con 85 de stock
});

test('anular una venta cuando ya hubo otra venta sin ingreso: lo devuelto cubre primero el hueco', async () => {
  await crearInsumo('Soda', 'ml');
  esperar(await post('/stock/ingresos', { id_insumo: ids.Soda, cantidad: 85, costo_total: 85 }), 201);
  const usuario = (await conSesion('administrador')).usuario;
  const vender = (cantidad, referencia) => db.transaction((tx) => consumirInsumo(tx, { id_insumo: ids.Soda, cantidad, tipo: 'venta', referencia, id_usuario: usuario.id }));
  await vender(100, 'item:9002'); // stock −15
  await vender(30, 'item:9003');  // stock −45
  await db.transaction((tx) => revertirVenta(tx, { referencia: 'item:9002', id_usuario: usuario.id, hoy: '2026-10-14' }));
  const i = await insumoActual('Soda');
  assert.equal(i.stock_actual, 55);          // −45 + 100
  assert.equal(await sumaLotes(ids.Soda), 55);
  const suma = Number((await db.query('SELECT SUM(cantidad) AS s FROM movimiento_stock WHERE id_insumo = $1', [ids.Soda])).rows[0].s);
  assert.equal(suma, 55);                    // el historial de movimientos suma lo mismo que el stock
});

test('conteo físico: si los lotes estaban descuadrados con el stock, el conteo los corrige', async () => {
  await crearInsumo('Almíbar', 'ml');
  esperar(await post('/stock/ingresos', { id_insumo: ids.Almíbar, cantidad: 22, costo_total: 44 }), 201);
  // descuadre como el que dejaba la anulación de ventas en versiones anteriores: stock −100 pero 22 en lotes
  await db.query('UPDATE insumo SET stock_actual = -100 WHERE id = $1', [ids.Almíbar]);
  const r = esperar(await post('/stock/ajustes', { id_insumo: ids.Almíbar, cantidad_real: 0, nota: 'conteo' }), 201);
  assert.equal(r.stock_actual, 0);
  assert.equal(await sumaLotes(ids.Almíbar), 0);                 // los 22 de más desaparecen de Lotes
  assert.equal((await insumoActual('Almíbar')).stock_actual, 0);
  // y subirlo funciona normalmente
  esperar(await post('/stock/ajustes', { id_insumo: ids.Almíbar, cantidad_real: 40 }), 201);
  assert.equal(await sumaLotes(ids.Almíbar), 40);
  assert.equal((await insumoActual('Almíbar')).stock_actual, 40);
});

test('conteo físico con el stock en negativo: lo contado manda y el lote queda con lo que hay', async () => {
  await crearInsumo('Menta', 'g');
  const usuario = (await conSesion('administrador')).usuario;
  await db.transaction((tx) => consumirInsumo(tx, { id_insumo: ids.Menta, cantidad: 30, tipo: 'venta', referencia: 'item:9004', id_usuario: usuario.id }));
  assert.equal((await insumoActual('Menta')).stock_actual, -30);
  esperar(await post('/stock/ajustes', { id_insumo: ids.Menta, cantidad_real: 50 }), 201);
  assert.equal((await insumoActual('Menta')).stock_actual, 50);
  assert.equal(await sumaLotes(ids.Menta), 50);
  const suma = Number((await db.query('SELECT SUM(cantidad) AS s FROM movimiento_stock WHERE id_insumo = $1', [ids.Menta])).rows[0].s);
  assert.equal(suma, 50);
});
