// CRUD completo (Crear, Leer, Actualizar, Eliminar) sobre el catálogo y el salón.
// Regla: un registro SIN historial se puede eliminar definitivamente; uno CON historial solo se da de baja.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

let admin;
let camarero;
const ids = {};
const llamar = (metodo, ruta, token, body) => api(metodo, ruta, { token, body, ahora: AHORA });

before(async () => {
  await iniciarBase();
  admin = (await conSesion('administrador')).token;
  camarero = (await conSesion('camarero')).token;
});

test('mesa: crear → leer → actualizar → eliminar definitivamente (sin historial)', async () => {
  const creada = esperar(await llamar('POST', '/mesas', admin, { nombre: 'Prueba 1', zona: 'interior', capacidad: 4 }), 201);
  assert.equal(creada.nombre, 'Prueba 1');
  assert.ok(esperar(await llamar('GET', '/mesas', admin), 200).mesas.some((m) => m.id === creada.id));

  const editada = esperar(await llamar('PATCH', `/mesas/${creada.id}`, admin, { capacidad: 6 }), 200);
  assert.equal(editada.capacidad, 6);

  const r = esperar(await llamar('DELETE', `/mesas/${creada.id}/definitivo`, admin), 200);
  assert.deepEqual([r.eliminado, r.nombre], [true, 'Prueba 1']);
  assert.ok(!esperar(await llamar('GET', '/mesas', admin), 200).mesas.some((m) => m.id === creada.id));
  assert.equal((await llamar('DELETE', `/mesas/${creada.id}/definitivo`, admin)).status, 404); // ya no existe
});

test('mesa: con pedidos en el historial no se elimina (409 con mensaje claro) pero sí se da de baja', async () => {
  ids.mesa = esperar(await llamar('POST', '/mesas', admin, { nombre: 'Con historial', zona: 'exterior', capacidad: 2 }), 201).id;
  ids.plato = esperar(await llamar('POST', '/productos', admin, { nombre: 'Tostado', categoria: 'Comida', destino: 'cocina', precio: 5000, receta: [] }), 201).id;
  esperar(await llamar('POST', '/pedidos', camarero, { canal: 'mesa', id_mesa: ids.mesa, items: [{ id_producto: ids.plato, cantidad: 1 }] }), 201);

  const r = await llamar('DELETE', `/mesas/${ids.mesa}/definitivo`, admin);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /No se puede eliminar la mesa «Con historial»: tiene 1 pedido en el historial/);
  esperar(await llamar('PATCH', `/mesas/${ids.mesa}`, admin, { activo: false }), 200); // la baja lógica sí
});

test('producto: sin ventas se elimina (con su receta); con ventas queda protegido', async () => {
  ids.insumo = esperar(await llamar('POST', '/insumos', admin, { nombre: 'Insumo de prueba', unidad: 'g' }), 201).id;
  const libre = esperar(await llamar('POST', '/productos', admin, { nombre: 'Plato nuevo', categoria: 'Comida', destino: 'cocina', precio: 3000, receta: [{ id_insumo: ids.insumo, cantidad: 50 }] }), 201);

  // el insumo está en una receta: no se puede eliminar mientras tanto
  const bloqueado = await llamar('DELETE', `/insumos/${ids.insumo}/definitivo`, admin);
  assert.equal(bloqueado.status, 409);
  assert.match(bloqueado.body.error, /forma parte de 1 receta/);

  esperar(await llamar('DELETE', `/productos/${libre.id}/definitivo`, admin), 200);
  assert.equal((await llamar('GET', `/productos/${libre.id}`, admin)).status, 404);

  // con la receta ya borrada, el insumo (sin compras ni movimientos) se puede eliminar
  esperar(await llamar('DELETE', `/insumos/${ids.insumo}/definitivo`, admin), 200);

  const vendido = await llamar('DELETE', `/productos/${ids.plato}/definitivo`, admin);
  assert.equal(vendido.status, 409);
  assert.match(vendido.body.error, /se vendió o pidió en 1 ocasión/);
  assert.equal(esperar(await llamar('GET', `/productos/${ids.plato}`, admin), 200).nombre, 'Tostado'); // sigue ahí
});

test('insumo con compras registradas y proveedor con insumos: protegidos', async () => {
  const prov = esperar(await llamar('POST', '/proveedores', admin, { nombre: 'Proveedor de prueba' }), 201);
  const ins = esperar(await llamar('POST', '/insumos', admin, { nombre: 'Ron', unidad: 'ml', id_proveedor: prov.id }), 201);
  esperar(await llamar('POST', '/stock/ingresos', admin, { id_insumo: ins.id, cantidad: 1000, costo_total: 9000, id_proveedor: prov.id }), 201);

  const a = await llamar('DELETE', `/insumos/${ins.id}/definitivo`, admin);
  assert.equal(a.status, 409);
  assert.match(a.body.error, /compra o lote/);
  const b = await llamar('DELETE', `/proveedores/${prov.id}/definitivo`, admin);
  assert.equal(b.status, 409);
  assert.match(b.body.error, /Proveedor de prueba/);

  const suelto = esperar(await llamar('POST', '/proveedores', admin, { nombre: 'Sin movimientos' }), 201);
  esperar(await llamar('DELETE', `/proveedores/${suelto.id}/definitivo`, admin), 200);
  assert.ok(!esperar(await llamar('GET', '/proveedores', admin), 200).some((p) => p.id === suelto.id));
});

test('eliminar definitivamente es solo del administrador y queda en la auditoría', async () => {
  const m = esperar(await llamar('POST', '/mesas', admin, { nombre: 'Auditada', zona: 'interior', capacidad: 2 }), 201);
  assert.equal((await llamar('DELETE', `/mesas/${m.id}/definitivo`, camarero)).status, 403);
  assert.equal((await llamar('DELETE', `/mesas/${m.id}/definitivo`, undefined)).status, 401);
  esperar(await llamar('DELETE', `/mesas/${m.id}/definitivo`, admin), 200);
  const log = esperar(await api('GET', '/auditoria', { token: admin, query: { accion: 'mesa.eliminar' }, ahora: AHORA }), 200);
  const fila = log.filas.find((f) => JSON.stringify(f.detalle).includes('Auditada'));
  assert.ok(fila, 'el evento guarda cómo era la mesa antes de borrarse');
  assert.equal(fila.accion, 'mesa.eliminar');
});
