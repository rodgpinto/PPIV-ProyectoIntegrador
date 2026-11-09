// Presentaciones (envases) de los insumos: se cargan por el administrador y las ve todo el personal que registra mermas.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

const T = {};
const ids = {};
const llamar = (metodo, ruta, rol, body, query) => api(metodo, ruta, { token: T[rol], body, query, ahora: AHORA });
const poner = (id, presentaciones, rol = 'administrador') => llamar('PUT', `/insumos/${id}/presentaciones`, rol, { presentaciones });

before(async () => {
  await iniciarBase();
  for (const rol of ['administrador', 'cajero', 'barra', 'camarero', 'cocina']) T[rol] = (await conSesion(rol)).token;
  ids.coca = esperar(await llamar('POST', '/insumos', 'administrador', { nombre: 'Coca Cola', unidad: 'ml' }), 201).id;
  ids.gin = esperar(await llamar('POST', '/insumos', 'administrador', { nombre: 'Gin', unidad: 'ml' }), 201).id;
});

test('un insumo recién creado no tiene presentaciones', async () => {
  const lista = esperar(await llamar('GET', '/insumos', 'administrador'), 200);
  assert.deepEqual(lista.find((i) => i.id === ids.coca).presentaciones, []);
});

test('se cargan varias presentaciones; la primera queda como principal si nadie marca otra', async () => {
  const r = esperar(await poner(ids.coca, [{ nombre: 'Botella 500 cc', cantidad: 500 }, { nombre: 'Botella 1 L', cantidad: 1000 }, { nombre: 'Botella 1,5 L', cantidad: 1500 }]), 200);
  assert.deepEqual(r.presentaciones.map((p) => [p.nombre, p.cantidad, p.principal]), [['Botella 500 cc', 500, true], ['Botella 1 L', 1000, false], ['Botella 1,5 L', 1500, false]]);
  const lista = esperar(await llamar('GET', '/insumos', 'administrador'), 200);
  assert.equal(lista.find((i) => i.id === ids.coca).presentaciones.length, 3);
  assert.deepEqual(lista.find((i) => i.id === ids.gin).presentaciones, []); // no se mezclan entre insumos
});

test('se puede elegir la principal, y reemplazar o vaciar la lista', async () => {
  const r = esperar(await poner(ids.coca, [{ nombre: 'Botella 500 cc', cantidad: 500 }, { nombre: 'Botella 2,25 L', cantidad: 2250, principal: true }]), 200);
  assert.deepEqual(r.presentaciones.map((p) => [p.nombre, p.principal]), [['Botella 500 cc', false], ['Botella 2,25 L', true]]);
  assert.deepEqual(esperar(await poner(ids.coca, []), 200).presentaciones, []);
});

test('el mismo nombre se puede usar en insumos distintos, pero no repetir dentro de uno', async () => {
  esperar(await poner(ids.gin, [{ nombre: 'Botella 750 ml', cantidad: 750 }]), 200);
  esperar(await poner(ids.coca, [{ nombre: 'Botella 750 ml', cantidad: 750 }]), 200);
  const r = await poner(ids.coca, [{ nombre: 'Lata', cantidad: 354 }, { nombre: ' lata ', cantidad: 330 }]);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /repetida/);
});

test('validaciones: cantidades, nombres, dos principales, demasiadas y insumo inexistente', async () => {
  esperar(await poner(ids.coca, [{ nombre: 'Botella 500 cc', cantidad: 500 }]), 200);
  const malos = [
    [{ nombre: 'Botella', cantidad: 0 }],
    [{ nombre: 'Botella', cantidad: -5 }],
    [{ nombre: '', cantidad: 500 }],
    [{ nombre: 'A', cantidad: 1, principal: true }, { nombre: 'B', cantidad: 2, principal: true }],
    Array.from({ length: 11 }, (_, i) => ({ nombre: `P${i}`, cantidad: i + 1 })),
  ];
  for (const lista of malos) assert.equal((await poner(ids.coca, lista)).status, 400, JSON.stringify(lista).slice(0, 60));
  assert.equal((await llamar('PUT', `/insumos/${ids.coca}/presentaciones`, 'administrador', {})).status, 400);
  assert.equal((await poner(99999, [{ nombre: 'X', cantidad: 1 }])).status, 404);
  // los pedidos rechazados no tocaron lo que ya había (todo o nada)
  const lista = esperar(await llamar('GET', '/insumos', 'administrador'), 200);
  assert.deepEqual(lista.find((i) => i.id === ids.coca).presentaciones.map((p) => p.nombre), ['Botella 500 cc']);
});

test('permisos: solo el administrador las cambia; el personal de barra y cocina las ve sin costos ni stock', async () => {
  for (const rol of ['cajero', 'barra', 'camarero', 'cocina']) assert.equal((await poner(ids.coca, [{ nombre: 'X', cantidad: 1 }], rol)).status, 403, rol);
  const vista = esperar(await llamar('GET', '/insumos', 'barra'), 200).find((i) => i.id === ids.coca);
  assert.deepEqual(Object.keys(vista).sort(), ['id', 'nombre', 'presentaciones', 'unidad']);
  assert.equal(vista.presentaciones[0].nombre, 'Botella 500 cc');
});
