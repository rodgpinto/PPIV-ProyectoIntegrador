// Pasar cuentas y líneas entre mesas: estados de mesa, KDS, stock, auditoría y permisos.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { db } from '../src/db.js';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

const T = {};
const ids = {};
const llamar = (metodo, ruta, rol, { body, query, ahora = AHORA } = {}) => api(metodo, ruta, { token: T[rol], body, query, ahora });

before(async () => {
  await iniciarBase();
  for (const rol of ['administrador', 'cajero', 'barra', 'camarero', 'host', 'cocina']) T[rol] = (await conSesion(rol)).token;
  ids.Gin = esperar(await llamar('POST', '/insumos', 'administrador', { body: { nombre: 'Gin', unidad: 'ml' } }), 201).id;
  esperar(await llamar('POST', '/stock/ingresos', 'administrador', { body: { id_insumo: ids.Gin, cantidad: 1000, costo_total: 26000 } }), 201);
  const prod = async (nombre, destino, precio, receta) => {
    ids[nombre] = esperar(await llamar('POST', '/productos', 'administrador', { body: { nombre, categoria: 'P', destino, precio, receta } }), 201).id;
  };
  await prod('Gin tonic', 'barra', 8000, [{ id_insumo: ids.Gin, cantidad: 50 }]);
  await prod('Tostada', 'cocina', 5000, []);
  for (const [n, z] of [['M1', 'interior'], ['M2', 'interior'], ['M3', 'exterior'], ['M4', 'exterior']]) {
    ids[n] = esperar(await llamar('POST', '/mesas', 'administrador', { body: { nombre: n, zona: z, capacidad: 4 } }), 201).id;
  }
});

const abrir = async (mesa, items) => esperar(await llamar('POST', '/pedidos', 'camarero', { body: { canal: 'mesa', id_mesa: ids[mesa], items } }), 201);
const linea = (nombre, cantidad = 1) => ({ id_producto: ids[nombre], cantidad });
const estadoMesa = async (n) => esperar(await llamar('GET', '/mesas', 'administrador'), 200).mesas.find((m) => m.nombre === n).estado;
const abiertas = async () => esperar(await llamar('GET', '/pedidos', 'camarero'), 200);

test('pasar la cuenta a una mesa libre: cambia de mesa, la anterior se libera y la nueva se ocupa', async () => {
  const p = await abrir('M1', [linea('Gin tonic', 2), linea('Tostada')]);
  assert.equal(await estadoMesa('M1'), 'ocupada');
  const r = esperar(await llamar('POST', `/pedidos/${p.id}/mover`, 'camarero', { body: { id_mesa: ids.M2 } }), 200);
  assert.equal(r.pedido.id, p.id);
  assert.equal(r.pedido.mesa, 'M2');
  assert.equal(r.pedido.items.length, 2);
  assert.equal(r.desde, 'M1');
  assert.equal(await estadoMesa('M1'), 'libre');
  assert.equal(await estadoMesa('M2'), 'ocupada');
  // la pantalla de la barra muestra ahora la mesa nueva
  const kds = esperar(await llamar('GET', '/kds', 'barra'), 200);
  assert.ok(kds.items.filter((i) => i.id_pedido === p.id).every((i) => i.mesa === 'M2'));
  // se puede volver a abrir una cuenta en la mesa que quedó libre
  const otra = await abrir('M1', [linea('Tostada')]);
  assert.equal(otra.mesa, 'M1');
  esperar(await llamar('POST', `/pedidos/${otra.id}/cancelar`, 'camarero'), 409); // tiene consumos
});

test('si la mesa de destino ya tiene cuenta, pide confirmar la unión; al unir se suman las líneas', async () => {
  const a = (await abiertas()).find((p) => p.mesa === 'M2');
  const b = (await abiertas()).find((p) => p.mesa === 'M1');
  const sin = await llamar('POST', `/pedidos/${b.id}/mover`, 'camarero', { body: { id_mesa: ids.M2 } });
  assert.equal(sin.status, 409);
  assert.equal(sin.body.detalles.puede_unir, true);
  assert.equal(sin.body.detalles.id_pedido, a.id);
  const r = esperar(await llamar('POST', `/pedidos/${b.id}/mover`, 'camarero', { body: { id_mesa: ids.M2, unir: true } }), 200);
  assert.equal(r.unida, true);
  assert.equal(r.pedido.id, a.id);
  assert.equal(r.pedido.items.length, 3);
  assert.equal(r.pedido.total, 8000 * 2 + 5000 + 5000);
  assert.equal(await estadoMesa('M1'), 'libre');
  const origen = esperar(await llamar('GET', `/pedidos/${b.id}`, 'camarero'), 200);
  assert.equal(origen.estado, 'cancelado');
  assert.equal(origen.items.length, 0);
});

test('validaciones: misma mesa, mesa inexistente, cuenta cerrada, rol sin permiso', async () => {
  const p = (await abiertas()).find((x) => x.mesa === 'M2');
  esperar(await llamar('POST', `/pedidos/${p.id}/mover`, 'camarero', { body: { id_mesa: ids.M2 } }), 400);
  esperar(await llamar('POST', `/pedidos/${p.id}/mover`, 'camarero', { body: { id_mesa: 9999 } }), 404);
  esperar(await llamar('POST', `/pedidos/${p.id}/mover`, 'host', { body: { id_mesa: ids.M3 } }), 403);
  esperar(await llamar('POST', `/pedidos/${p.id}/mover`, 'camarero', { body: {} }), 400);
  const nueva = await abrir('M4', [linea('Tostada')]);
  await db.query("UPDATE item_pedido SET estado = 'entregado' WHERE id_pedido = $1", [nueva.id]);
  esperar(await llamar('POST', `/pedidos/${nueva.id}/cerrar`, 'cajero', { body: { medio_pago: 'efectivo' } }), 200);
  esperar(await llamar('POST', `/pedidos/${nueva.id}/mover`, 'camarero', { body: { id_mesa: ids.M3 } }), 409);
  esperar(await llamar('POST', '/pedidos/99999/mover', 'camarero', { body: { id_mesa: ids.M3 } }), 404);
});

test('una cuenta de la barra se puede pasar a una mesa', async () => {
  const b = esperar(await llamar('POST', '/pedidos', 'barra', { body: { canal: 'barra', etiqueta: 'Juan', items: [linea('Gin tonic')] } }), 201);
  const r = esperar(await llamar('POST', `/pedidos/${b.id}/mover`, 'barra', { body: { id_mesa: ids.M3 } }), 200);
  assert.equal(r.pedido.canal, 'mesa');
  assert.equal(r.pedido.mesa, 'M3');
  assert.match(r.desde, /Barra/);
  assert.equal(await estadoMesa('M3'), 'ocupada');
});

test('dividir: pasar líneas a una mesa libre abre una cuenta nueva; la de origen sigue con el resto', async () => {
  const p = await abrir('M1', [linea('Gin tonic'), linea('Tostada'), linea('Tostada')]);
  const [g, t1, t2] = p.items;
  const r = esperar(await llamar('POST', `/pedidos/${p.id}/mover-items`, 'camarero', { body: { ids: [t1.id, t2.id], id_mesa: ids.M4 } }), 200);
  assert.equal(r.nueva, true);
  assert.equal(r.origen.items.length, 1);
  assert.equal(r.origen.items[0].id, g.id);
  assert.equal(r.pedido.mesa, 'M4');
  assert.equal(r.pedido.items.length, 2);
  assert.equal(r.origen_cancelada, false);
  assert.equal(await estadoMesa('M4'), 'ocupada');
  assert.equal(r.pedido.id !== p.id, true);
});

test('pasar líneas a la cuenta que ya tiene otra mesa las suma; si el origen se queda vacío se cancela y se libera', async () => {
  const cuentas = await abiertas();
  const origen = cuentas.find((c) => c.mesa === 'M4');
  const destino = cuentas.find((c) => c.mesa === 'M1');
  const r = esperar(await llamar('POST', `/pedidos/${origen.id}/mover-items`, 'camarero', { body: { ids: origen.items.map((i) => i.id), id_mesa: ids.M1 } }), 200);
  assert.equal(r.pedido.id, destino.id);
  assert.equal(r.pedido.items.length, 3);
  assert.equal(r.origen_cancelada, true);
  assert.equal(r.origen, null);
  assert.equal(await estadoMesa('M4'), 'libre');
});

test('el stock y las anulaciones siguen funcionando con las líneas movidas', async () => {
  let cuenta = (await abiertas()).find((c) => c.mesa === 'M2');
  esperar(await llamar('POST', `/pedidos/${cuenta.id}/items`, 'camarero', { body: { items: [linea('Gin tonic')] } }), 201);
  cuenta = (await abiertas()).find((c) => c.mesa === 'M2');
  const gin = cuenta.items.filter((i) => i.nombre === 'Gin tonic').at(-1);
  const stock = async () => esperar(await llamar('GET', '/insumos', 'administrador'), 200).find((i) => i.nombre === 'Gin').stock_actual;
  const antes = await stock();
  const m = esperar(await llamar('POST', `/pedidos/${cuenta.id}/mover-items`, 'camarero', { body: { ids: [gin.id], id_mesa: ids.M4 } }), 200);
  assert.equal(await stock(), antes); // mover no toca el stock
  esperar(await llamar('DELETE', `/pedido-items/${gin.id}`, 'camarero'), 200); // anular la línea movida devuelve el stock
  assert.equal(await stock(), antes + 50);
  const { rows } = await db.query("SELECT estado FROM item_pedido WHERE id = $1", [gin.id]);
  assert.equal(rows[0].estado, 'anulado');
  assert.ok(m.pedido.id);
});

test('mover-items: validaciones', async () => {
  const cuentas = await abiertas();
  const a = cuentas.find((c) => c.mesa === 'M1');
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'camarero', { body: { ids: [a.items[0].id] } }), 400); // sin destino
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'camarero', { body: { ids: [999999], id_mesa: ids.M3 } }), 404);
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'camarero', { body: { ids: [a.items[0].id], id_pedido: a.id } }), 400); // mismo pedido
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'camarero', { body: { ids: [], id_mesa: ids.M3 } }), 400);
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'cocina', { body: { ids: [a.items[0].id], id_mesa: ids.M3 } }), 403);
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'camarero', { body: { ids: [a.items[0].id], id_mesa: 9999 } }), 404);
  // líneas de otra cuenta
  const otra = cuentas.find((c) => c.mesa === 'M2');
  esperar(await llamar('POST', `/pedidos/${a.id}/mover-items`, 'camarero', { body: { ids: [otra.items[0].id], id_mesa: ids.M3 } }), 404);
});

test('queda constancia en la auditoría', async () => {
  const { rows } = await db.query("SELECT accion, detalle FROM auditoria WHERE accion IN ('pedido.mover', 'pedido.mover_items') ORDER BY id");
  assert.ok(rows.some((r) => r.accion === 'pedido.mover' && JSON.parse(r.detalle).hacia === 'M2'));
  assert.ok(rows.some((r) => r.accion === 'pedido.mover_items' && JSON.parse(r.detalle).lineas?.length));
});
