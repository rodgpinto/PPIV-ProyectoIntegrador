// Pedidos, pantalla de cocina/barra (KDS) y cobro: estados, permisos, stock por receta y anulaciones.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

const T = {};     // tokens por rol
const ids = {};   // ids por nombre
const min = (n) => new Date(AHORA.getTime() + n * 60000);
const llamar = (metodo, ruta, rol, { body, query, ahora = AHORA } = {}) => api(metodo, ruta, { token: T[rol], body, query, ahora });

before(async () => {
  await iniciarBase();
  for (const rol of ['administrador', 'cajero', 'barra', 'camarero', 'host', 'cocina']) T[rol] = (await conSesion(rol)).token;
  const insumo = async (nombre, unidad, stock, costoTotal) => {
    ids[nombre] = esperar(await llamar('POST', '/insumos', 'administrador', { body: { nombre, unidad } }), 201).id;
    if (stock) esperar(await llamar('POST', '/stock/ingresos', 'administrador', { body: { id_insumo: ids[nombre], cantidad: stock, costo_total: costoTotal } }), 201);
  };
  await insumo('Gin', 'ml', 1000, 26000);      // $26 por ml
  await insumo('Tónica', 'ml', 2000, 3000);    // $1,5 por ml
  await insumo('Pan', 'unidad', 20, 6000);     // $300 c/u
  await insumo('Vacío', 'g', 0, 0);            // sin stock
  const producto = async (nombre, destino, precio, receta) => {
    ids[nombre] = esperar(await llamar('POST', '/productos', 'administrador', { body: { nombre, categoria: 'Prueba', destino, precio, receta } }), 201).id;
  };
  await producto('Gin tonic', 'barra', 8000, [{ id_insumo: ids.Gin, cantidad: 50 }, { id_insumo: ids.Tónica, cantidad: 150 }]);
  await producto('Tostada', 'cocina', 5000, [{ id_insumo: ids.Pan, cantidad: 2 }]);
  await producto('Agua', 'barra', 2000, []);
  await producto('Postre raro', 'cocina', 6000, [{ id_insumo: ids.Vacío, cantidad: 100 }]);
  for (const [n, z, c] of [['M1', 'interior', 4], ['M2', 'interior', 2], ['M3', 'exterior', 4], ['M4', 'exterior', 2], ['M5', 'interior', 2], ['M6', 'interior', 2]]) {
    ids[n] = esperar(await llamar('POST', '/mesas', 'administrador', { body: { nombre: n, zona: z, capacidad: c } }), 201).id;
  }
});

const stockDe = async (nombre) => esperar(await llamar('GET', '/insumos', 'administrador'), 200).find((i) => i.nombre === nombre).stock_actual;
const lotesSuman = async (nombre) => esperar(await llamar('GET', '/stock/lotes', 'administrador', { query: { id_insumo: String(ids[nombre]) } }), 200).reduce((s, l) => s + l.cantidad_actual, 0);
const mesaEstado = async (nombre) => esperar(await llamar('GET', '/mesas', 'administrador'), 200).mesas.find((m) => m.nombre === nombre).estado;
const abrir = async (mesa, items, rol = 'camarero', ahora = AHORA) =>
  esperar(await llamar('POST', '/pedidos', rol, { ahora, body: { canal: 'mesa', id_mesa: ids[mesa], items } }), 201);
const linea = (nombre, cantidad = 1, nota) => ({ id_producto: ids[nombre], cantidad, ...(nota ? { nota } : {}) });

test('una cuenta de mesa: total, mesa ocupada y stock descontado por receta', async () => {
  const antesGin = await stockDe('Gin');
  const p = await abrir('M1', [linea('Gin tonic', 2), linea('Tostada', 1, 'sin sal')]);
  assert.equal(p.estado, 'abierto');
  assert.equal(p.mesa, 'M1');
  assert.equal(p.total, 2 * 8000 + 5000);
  assert.equal(p.items.length, 2);
  assert.ok(p.items.every((i) => i.estado === 'pendiente'));
  assert.equal(p.items[1].nota, 'sin sal');
  assert.equal(await stockDe('Gin'), antesGin - 100);              // 2 × 50 ml
  assert.equal(await stockDe('Tónica'), 2000 - 300);
  assert.equal(await stockDe('Pan'), 20 - 2);
  assert.equal(await mesaEstado('M1'), 'ocupada');
  ids.pedidoM1 = p.id;
});

test('el precio y el costo quedan fijados: cambiar la carta después no altera lo pedido', async () => {
  esperar(await llamar('PATCH', `/productos/${ids['Gin tonic']}/precio`, 'administrador', { body: { precio: 9999 } }), 200);
  const p = esperar(await llamar('GET', `/pedidos/${ids.pedidoM1}`, 'camarero'), 200);
  assert.equal(p.items[0].precio_unitario, 8000);
  assert.equal(p.total, 21000);
  esperar(await llamar('PATCH', `/productos/${ids['Gin tonic']}/precio`, 'administrador', { body: { precio: 8000 } }), 200);
});

test('validaciones al abrir una cuenta', async () => {
  const crear = (body, rol = 'camarero') => llamar('POST', '/pedidos', rol, { body });
  const r = await crear({ canal: 'mesa', id_mesa: ids.M1, items: [linea('Agua')] });
  assert.equal(r.status, 409);                                      // ya tiene cuenta abierta
  assert.equal(r.body.detalles.id_pedido, ids.pedidoM1);
  assert.equal((await crear({ canal: 'mesa', id_mesa: 99999, items: [linea('Agua')] })).status, 404);
  assert.equal((await crear({ canal: 'mesa', items: [linea('Agua')] })).status, 400);
  assert.equal((await crear({ canal: 'barra', id_mesa: ids.M2, items: [linea('Agua')] })).status, 400);
  assert.equal((await crear({ canal: 'mesa', id_mesa: ids.M2, items: [] })).status, 400);
  assert.equal((await crear({ canal: 'mesa', id_mesa: ids.M2, items: [{ id_producto: ids.Agua, cantidad: 0 }] })).status, 400);
  assert.equal((await crear({ canal: 'mesa', id_mesa: ids.M2, items: [{ id_producto: 99999, cantidad: 1 }] })).status, 422);
  assert.equal(await mesaEstado('M2'), 'libre');                    // nada de lo anterior la ocupó
  esperar(await llamar('PATCH', `/productos/${ids.Agua}`, 'administrador', { body: { activo: false } }), 200);
  assert.equal((await crear({ canal: 'mesa', id_mesa: ids.M2, items: [linea('Agua')] })).status, 422);  // producto de baja
  esperar(await llamar('PATCH', `/productos/${ids.Agua}`, 'administrador', { body: { activo: true } }), 200);
});

test('permisos: host y cocina no toman pedidos; cajero y barra sí', async () => {
  const body = { canal: 'barra', etiqueta: 'Barra 1', items: [linea('Agua')] };
  assert.equal((await llamar('POST', '/pedidos', 'host', { body })).status, 403);
  assert.equal((await llamar('POST', '/pedidos', 'cocina', { body })).status, 403);
  assert.equal((await llamar('GET', '/pedidos', 'host')).status, 403);
  assert.equal((await api('GET', '/pedidos', { ahora: AHORA })).status, 401);
  const b = esperar(await llamar('POST', '/pedidos', 'barra', { body }), 201);
  assert.equal(b.canal, 'barra');
  assert.equal(b.id_mesa, null);
  esperar(await llamar('POST', `/pedidos/${b.id}/cancelar`, 'barra'), 409);   // tiene consumos
  esperar(await llamar('DELETE', `/pedido-items/${b.items[0].id}`, 'barra'), 200);
  assert.equal(esperar(await llamar('POST', `/pedidos/${b.id}/cancelar`, 'cajero'), 200).estado, 'cancelado');
  const c = esperar(await llamar('POST', '/pedidos', 'cajero', { body: { canal: 'mesa', id_mesa: ids.M5, items: [linea('Agua')] } }), 201);
  assert.equal(c.mozo, 'Usuario cajero');
  esperar(await llamar('DELETE', `/pedido-items/${c.items[0].id}`, 'cajero'), 200);
  esperar(await llamar('POST', `/pedidos/${c.id}/cancelar`, 'cajero'), 200);
  assert.equal(await mesaEstado('M5'), 'libre');                    // cancelar libera la mesa
});

test('agregar líneas a una cuenta abierta descuenta stock de nuevo', async () => {
  const antes = await stockDe('Pan');
  const p = esperar(await llamar('POST', `/pedidos/${ids.pedidoM1}/items`, 'camarero', { body: { items: [linea('Tostada', 2)] } }), 201);
  assert.equal(p.items.length, 3);
  assert.equal(p.total, 21000 + 10000);
  assert.equal(await stockDe('Pan'), antes - 4);
  assert.equal((await llamar('POST', '/pedidos/99999/items', 'camarero', { body: { items: [linea('Agua')] } })).status, 404);
});

test('KDS: cada destino ve solo lo suyo, en orden, y el camarero no entra', async () => {
  const cocina = esperar(await llamar('GET', '/kds', 'cocina'), 200);
  assert.equal(cocina.destino, 'cocina');
  assert.ok(cocina.items.length >= 2 && cocina.items.every((i) => i.destino === 'cocina'));
  assert.deepEqual(cocina.items.map((i) => i.id), [...cocina.items.map((i) => i.id)].sort((a, b) => a - b));
  assert.equal(cocina.items[0].mesa, 'M1');
  const barra = esperar(await llamar('GET', '/kds', 'barra', { query: { destino: 'cocina' } }), 200);
  assert.equal(barra.destino, 'barra');                              // barra no puede espiar cocina con la query
  assert.ok(barra.items.every((i) => i.destino === 'barra'));
  assert.equal(esperar(await llamar('GET', '/kds', 'administrador', { query: { destino: 'barra' } }), 200).destino, 'barra');
  assert.equal((await llamar('GET', '/kds', 'administrador', { query: { destino: 'otro' } })).status, 400);
  assert.equal((await llamar('GET', '/kds', 'camarero')).status, 403);
});

test('estados: quién puede cada paso, atomicidad y deshacer', async () => {
  const p = await abrir('M3', [linea('Gin tonic', 1), linea('Tostada', 1)]);
  const [gin, tostada] = p.items.map((i) => i.id);
  const estado = (rol, ids_, a, ahora = AHORA) => llamar('PATCH', '/pedido-items/estado', rol, { body: { ids: ids_, estado: a }, ahora });

  assert.equal((await estado('camarero', [gin], 'preparando')).status, 403);   // el camarero no prepara
  assert.equal((await estado('cocina', [gin], 'preparando')).status, 403);     // cocina no toca la barra
  assert.equal((await estado('barra', [tostada], 'preparando')).status, 403);  // ni barra la cocina
  assert.equal((await estado('barra', [gin], 'entregado')).status, 409);       // no se salta pasos
  assert.equal((await estado('administrador', [99999], 'listo')).status, 404);

  // todo o nada: una línea sin permiso impide cambiar las demás
  assert.equal((await estado('cocina', [tostada, gin], 'preparando')).status, 403);
  assert.equal(esperar(await llamar('GET', `/pedidos/${p.id}`, 'camarero'), 200).items.every((i) => i.estado === 'pendiente'), true);

  esperar(await estado('cocina', [tostada], 'preparando', min(1)), 200);
  esperar(await estado('barra', [gin], 'listo', min(2)), 200);                 // la barra puede saltar a listo
  let cuenta = esperar(await llamar('GET', `/pedidos/${p.id}`, 'camarero'), 200);
  const t = cuenta.items.find((i) => i.id === tostada);
  assert.equal(t.estado, 'preparando');
  assert.equal(new Date(t.preparando_en).toISOString(), min(1).toISOString());
  assert.equal(cuenta.items.find((i) => i.id === gin).listo_en !== null, true);

  esperar(await estado('cocina', [tostada], 'pendiente'), 200);               // deshacer
  cuenta = esperar(await llamar('GET', `/pedidos/${p.id}`, 'camarero'), 200);
  assert.equal(cuenta.items.find((i) => i.id === tostada).preparando_en, null);
  esperar(await estado('cocina', [tostada], 'listo', min(3)), 200);

  // en la pantalla de cocina ya no aparece lo entregado
  esperar(await estado('camarero', [gin, tostada], 'entregado', min(4)), 200);
  const cola = esperar(await llamar('GET', '/kds', 'administrador', { query: { destino: 'cocina' } }), 200);
  assert.ok(!cola.items.some((i) => i.id === tostada));
  assert.equal((await estado('administrador', [gin], 'listo')).status, 409);   // entregado no vuelve atrás
  ids.pedidoM3 = p.id;
});

test('cobro: total, medio de pago, cuenta cerrada y mesa liberada', async () => {
  const cerrar = (rol, id, medio) => llamar('POST', `/pedidos/${id}/cerrar`, rol, { body: { medio_pago: medio }, ahora: min(10) });
  assert.equal((await cerrar('camarero', ids.pedidoM3, 'bitcoin')).status, 400);
  const c = esperar(await cerrar('cajero', ids.pedidoM3, 'tarjeta'), 200);
  assert.equal(c.estado, 'cerrado');
  assert.equal(c.total, 13000);
  assert.equal(c.medio_pago, 'tarjeta');
  assert.equal(await mesaEstado('M3'), 'libre');
  assert.equal((await cerrar('cajero', ids.pedidoM3, 'efectivo')).status, 409);   // ya cerrada
  assert.equal((await llamar('POST', `/pedidos/${ids.pedidoM3}/items`, 'camarero', { body: { items: [linea('Agua')] } })).status, 409);
  const cerrados = esperar(await llamar('GET', '/pedidos', 'cajero', { query: { estado: 'cerrado' } }), 200);
  assert.ok(cerrados.some((p) => p.id === ids.pedidoM3));
  const abiertos = esperar(await llamar('GET', '/pedidos', 'cajero'), 200);
  assert.ok(!abiertos.some((p) => p.id === ids.pedidoM3));
});

test('no se cobra con pedidos sin terminar; lo que está listo se da por entregado al cobrar', async () => {
  const p = await abrir('M4', [linea('Tostada', 1), linea('Agua', 1)]);
  const [tostada, agua] = p.items.map((i) => i.id);
  const r = await llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: 'efectivo' } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.detalles.items.sort(), [tostada, agua].sort());
  esperar(await llamar('PATCH', '/pedido-items/estado', 'cocina', { body: { ids: [tostada], estado: 'listo' } }), 200);
  esperar(await llamar('PATCH', '/pedido-items/estado', 'barra', { body: { ids: [agua], estado: 'listo' } }), 200);
  const c = esperar(await llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: 'mercado_pago' } }), 200);
  assert.ok(c.items.every((i) => i.estado === 'entregado'));
  assert.equal(c.total, 7000);
});

test('anular: pendiente devuelve el stock exacto; preparando solo el administrador y sin devolver', async () => {
  const gin0 = await stockDe('Gin');
  const p = await abrir('M6', [linea('Gin tonic', 3), linea('Tostada', 2)]);
  const [gin, tostada] = p.items.map((i) => i.id);
  assert.equal(await stockDe('Gin'), gin0 - 150);

  const anulada = esperar(await llamar('DELETE', `/pedido-items/${gin}`, 'camarero'), 200);
  assert.equal(anulada.items.find((i) => i.id === gin).estado, 'anulado');
  assert.equal(anulada.total, 10000);                                   // el total ya no cuenta la línea anulada
  assert.equal(await stockDe('Gin'), gin0);
  assert.equal(await lotesSuman('Gin'), gin0);                          // el stock vuelve a su lote
  const mov = esperar(await llamar('GET', '/stock/movimientos', 'administrador', { query: { id_insumo: String(ids.Gin), limite: '5' } }), 200);
  assert.equal(mov[0].tipo, 'reversion');
  assert.equal(mov[0].cantidad, 150);
  assert.equal((await llamar('DELETE', `/pedido-items/${gin}`, 'camarero')).status, 409);   // doble anulación

  const pan0 = await stockDe('Pan');
  esperar(await llamar('PATCH', '/pedido-items/estado', 'cocina', { body: { ids: [tostada], estado: 'preparando' } }), 200);
  assert.equal((await llamar('DELETE', `/pedido-items/${tostada}`, 'camarero')).status, 403);
  esperar(await llamar('DELETE', `/pedido-items/${tostada}`, 'administrador'), 200);
  assert.equal(await stockDe('Pan'), pan0);                              // ya se usó: no vuelve
  esperar(await llamar('POST', `/pedidos/${p.id}/cancelar`, 'camarero'), 200);   // todo anulado: se puede cancelar
  assert.equal(await mesaEstado('M6'), 'libre');
});

test('un entregado no se anula', async () => {
  const p = await abrir('M2', [linea('Agua')]);
  esperar(await llamar('PATCH', '/pedido-items/estado', 'barra', { body: { ids: [p.items[0].id], estado: 'listo' } }), 200);
  esperar(await llamar('PATCH', '/pedido-items/estado', 'barra', { body: { ids: [p.items[0].id], estado: 'entregado' } }), 200);
  assert.equal((await llamar('DELETE', `/pedido-items/${p.items[0].id}`, 'administrador')).status, 409);
  esperar(await llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: 'efectivo' } }), 200);
});

test('sin stock se puede vender (S-16): avisa el faltante y la anulación mantiene lotes = stock', async () => {
  const p = await abrir('M5', [linea('Postre raro', 2)]);
  assert.deepEqual(p.sin_stock.map((s) => [s.nombre, s.faltante]), [['Vacío', 200]]);
  assert.equal(await stockDe('Vacío'), -200);
  // llega mercadería: cubre primero el hueco
  esperar(await llamar('POST', '/stock/ingresos', 'administrador', { body: { id_insumo: ids.Vacío, cantidad: 500, costo_total: 1000 } }), 201);
  assert.equal(await stockDe('Vacío'), 300);
  assert.equal(await lotesSuman('Vacío'), 300);
  // se anula lo pedido: vuelven los 200 y el stock sigue coincidiendo con los lotes
  esperar(await llamar('DELETE', `/pedido-items/${p.items[0].id}`, 'camarero'), 200);
  assert.equal(await stockDe('Vacío'), 500);
  assert.equal(await lotesSuman('Vacío'), 500);
  esperar(await llamar('POST', `/pedidos/${p.id}/cancelar`, 'camarero'), 200);
});

test('pedidos simultáneos no pierden stock', async () => {
  const antes = await stockDe('Pan');
  const mesas = ['M1', 'M2', 'M4'];
  // M1 ya tiene cuenta: se agregan líneas a ella; en M2 y M4 se abren cuentas nuevas, todo a la vez
  const respuestas = await Promise.all([
    llamar('POST', `/pedidos/${ids.pedidoM1}/items`, 'camarero', { body: { items: [linea('Tostada', 1)] } }),
    llamar('POST', '/pedidos', 'camarero', { body: { canal: 'mesa', id_mesa: ids.M2, items: [linea('Tostada', 1)] } }),
    llamar('POST', '/pedidos', 'barra', { body: { canal: 'mesa', id_mesa: ids.M4, items: [linea('Tostada', 1)] } }),
  ]);
  assert.deepEqual(respuestas.map((r) => r.status), [201, 201, 201]);
  assert.equal(await stockDe('Pan'), antes - 6);
  assert.equal(await lotesSuman('Pan'), antes - 6);
  void mesas;
});

test('dos cuentas abiertas a la vez en la misma mesa: gana una sola', async () => {
  const [a, b] = await Promise.all([
    llamar('POST', '/pedidos', 'camarero', { body: { canal: 'mesa', id_mesa: ids.M6, items: [linea('Agua')] } }),
    llamar('POST', '/pedidos', 'cajero', { body: { canal: 'mesa', id_mesa: ids.M6, items: [linea('Agua')] } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
});

test('una mesa con cuenta abierta no se puede liberar a mano', async () => {
  const r = await llamar('PATCH', `/mesas/${ids.M1}/estado`, 'host', { body: { estado: 'libre' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.detalles.id_pedido, ids.pedidoM1);
  assert.equal(await mesaEstado('M1'), 'ocupada');
  esperar(await llamar('PATCH', `/mesas/${ids.M1}/estado`, 'host', { body: { estado: 'ocupada' } }), 200);   // lo demás sigue igual
});
