// Cierre de caja por caja: el salón y la barra se cuentan y se cierran por separado (o todo junto).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { db } from '../src/db.js';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

const T = {};
const ids = {};
const llamar = (metodo, ruta, rol, { body, query, ahora = AHORA } = {}) => api(metodo, ruta, { token: T[rol], body, query, ahora });

before(async () => {
  await iniciarBase();
  for (const rol of ['administrador', 'cajero', 'barra', 'camarero']) T[rol] = (await conSesion(rol)).token;
  ids.Tostada = esperar(await llamar('POST', '/productos', 'administrador', { body: { nombre: 'Tostada', categoria: 'P', destino: 'cocina', precio: 5000, receta: [] } }), 201).id;
  ids.Trago = esperar(await llamar('POST', '/productos', 'administrador', { body: { nombre: 'Trago', categoria: 'P', destino: 'barra', precio: 4000, receta: [] } }), 201).id;
  for (const n of ['M1', 'M2', 'M3']) ids[n] = esperar(await llamar('POST', '/mesas', 'administrador', { body: { nombre: n, zona: 'interior', capacidad: 4 } }), 201).id;
});

const abrir = async (cuerpo, items) => {
  const p = esperar(await llamar('POST', '/pedidos', 'camarero', { body: { ...cuerpo, items } }), 201);
  return p;
};
const entregar = async (p) => {
  for (const [desde, estado] of [['pendiente', 'listo'], ['listo', 'entregado']]) {
    const ids_ = p.items.filter((i) => i.estado === desde).map((i) => i.id);
    if (ids_.length) esperar(await llamar('PATCH', '/pedido-items/estado', 'administrador', { body: { ids: ids_, estado } }), 200);
    for (const i of p.items) if (i.estado === desde) i.estado = estado;
  }
};
const cobrar = (p, medio) => llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: medio } });
const venta = async (cuerpo, items, medio) => {
  const p = await abrir(cuerpo, items);
  await entregar(p);
  esperar(await cobrar(p, medio), 200);
  return p;
};
const jornada = async () => esperar(await llamar('GET', '/caja/jornada', 'cajero'), 200);
const cerrar = (canal, extra = {}) => llamar('POST', '/caja/cierres', 'cajero', { body: { canal, efectivo_contado: 0, ...extra } });
const L = (id, cantidad = 1) => ({ id_producto: id, cantidad });

test('la jornada separa lo cobrado en el salón y en la barra', async () => {
  await venta({ canal: 'mesa', id_mesa: ids.M1 }, [L(ids.Tostada, 2)], 'efectivo'); // salón 10.000 efectivo
  await venta({ canal: 'barra', etiqueta: 'Ana' }, [L(ids.Trago, 2)], 'tarjeta'); // barra 8.000 tarjeta
  await venta({ canal: 'barra', etiqueta: 'Beto' }, [L(ids.Tostada)], 'efectivo'); // barra 5.000 efectivo
  const j = await jornada();
  assert.deepEqual([j.por_caja.mesa.ventas_total, j.por_caja.mesa.ventas_efectivo, j.por_caja.mesa.cuentas], [10000, 10000, 1]);
  assert.deepEqual([j.por_caja.barra.ventas_total, j.por_caja.barra.ventas_efectivo, j.por_caja.barra.cuentas], [13000, 5000, 2]);
  assert.deepEqual([j.por_caja.todos.ventas_total, j.por_caja.todos.ventas_efectivo], [23000, 15000]);
  assert.equal(j.ventas_efectivo, 15000);
  assert.equal(j.cerrada, false);
  assert.equal(j.por_caja.barra.por_medio.find((m) => m.medio_pago === 'tarjeta').ventas, 8000);
});

test('una cuenta abierta de la barra frena el cierre de la barra, pero no el del salón', async () => {
  const abierta = await abrir({ canal: 'barra', etiqueta: 'Caro' }, [L(ids.Trago)]);
  const j = await jornada();
  assert.equal(j.por_caja.barra.abiertas.length, 1);
  assert.equal(j.por_caja.mesa.abiertas.length, 0);
  const rechazo = await cerrar('barra', { efectivo_contado: 5000 });
  assert.equal(rechazo.status, 409);
  assert.match(rechazo.body.error, /cuenta abierta/);
  const ok = esperar(await cerrar('mesa', { fondo_inicial: 1000, retiros: 500, efectivo_contado: 10400 }), 201);
  assert.equal(ok.canal, 'mesa');
  assert.deepEqual([ok.ventas_total, ok.ventas_efectivo, ok.efectivo_esperado, ok.diferencia, ok.cuentas], [10000, 10000, 10500, -100, 1]);
  await entregar(abierta);
  esperar(await cobrar(abierta, 'efectivo'), 200); // la barra sigue abierta: se puede cobrar
});

test('con el salón cerrado, no se cobra en una mesa; en la barra sí', async () => {
  const mesa = await abrir({ canal: 'mesa', id_mesa: ids.M2 }, [L(ids.Tostada)]);
  await entregar(mesa);
  const r = await cobrar(mesa, 'efectivo');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /salón/);
  await venta({ canal: 'barra', etiqueta: 'Dani' }, [L(ids.Trago)], 'efectivo');
  esperar(await llamar('POST', `/pedidos/${mesa.id}/cancelar`, 'camarero'), 409); // tiene consumos
});

test('no se mezclan: con el salón cerrado no se cierra «todo junto», y al cerrar la barra la noche queda cerrada', async () => {
  const todo = await cerrar('todos', { efectivo_contado: 1 });
  assert.equal(todo.status, 409);
  assert.match(todo.body.error, /salón o de la barra/);
  const repetido = await cerrar('mesa');
  assert.equal(repetido.status, 409);
  assert.match(repetido.body.error, /ya está cerrada/);
  // la barra cobró 13.000 + 4.000 + 4.000 (Caro y Dani): efectivo 5.000 + 4.000 + 4.000
  const barra = esperar(await cerrar('barra', { efectivo_contado: 13000 }), 201);
  assert.equal(barra.ventas_efectivo, 13000);
  assert.equal(barra.diferencia, 0);
  const j = await jornada();
  assert.equal(j.cerrada, true);
  assert.deepEqual(j.cierres.map((c) => c.canal).sort(), ['barra', 'mesa']);
  assert.equal(j.cierre, null); // no hay cierre «todo junto»
  const h = esperar(await llamar('GET', '/caja/cierres', 'cajero'), 200);
  assert.deepEqual(h.map((c) => c.canal), ['barra', 'mesa']);
});

test('reabrir una caja deja cobrar de nuevo solo en ese canal', async () => {
  const j = await jornada();
  const cierreMesa = j.cierres.find((c) => c.canal === 'mesa');
  esperar(await llamar('DELETE', `/caja/cierres/${cierreMesa.id}`, 'administrador'), 204);
  const mesa = (await llamar('GET', '/pedidos', 'camarero')).body.find((p) => p.mesa === 'M2');
  esperar(await cobrar(mesa, 'efectivo'), 200);
  const barra = await abrir({ canal: 'barra', etiqueta: 'Eli' }, [L(ids.Trago)]);
  await entregar(barra);
  assert.equal((await cobrar(barra, 'efectivo')).status, 409); // la barra sigue cerrada
});

test('cerrar «todo junto» sigue funcionando y bloquea los cierres por caja', async () => {
  const j = await jornada();
  for (const c of j.cierres) esperar(await llamar('DELETE', `/caja/cierres/${c.id}`, 'administrador'), 204);
  const abiertas = (await llamar('GET', '/pedidos', 'camarero')).body;
  for (const p of abiertas) { await entregar(p); esperar(await cobrar(p, 'efectivo'), 200); }
  const todo = esperar(await cerrar('todos', { efectivo_contado: 0 }), 201);
  assert.equal(todo.canal, 'todos');
  assert.equal(todo.ventas_total, (await jornada()).ventas_total);
  const m = await cerrar('mesa');
  assert.equal(m.status, 409);
  assert.match(m.body.error, /todo junto/);
  const j2 = await jornada();
  assert.equal(j2.cerrada, true);
  assert.equal(j2.cierre.id, todo.id);
  // sin indicar caja se asume «todo junto» (compatibilidad)
  assert.equal((await llamar('POST', '/caja/cierres', 'cajero', { body: { efectivo_contado: 1 } })).status, 409);
});

test('validaciones y la base garantiza una sola caja por jornada y canal', async () => {
  assert.equal((await cerrar('cocina')).status, 400);
  await assert.rejects(db.query("INSERT INTO cierre_caja (fecha_jornada, canal, id_usuario, cuentas, ventas_total, ventas_efectivo, ventas_tarjeta, ventas_mercado_pago, ventas_transferencia, efectivo_esperado, efectivo_contado, diferencia) VALUES ('2026-10-14', 'todos', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0)"));
});
