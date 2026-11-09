import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

let token;
const ids = {}; // nombre -> id

before(async () => {
  await iniciarBase();
  token = (await conSesion('administrador')).token;
});

const post = (ruta, body) => api('POST', ruta, { token, body, ahora: AHORA });
const get = (ruta, query) => api('GET', ruta, { token, query, ahora: AHORA });

async function insumo(nombre, unidad, extra = {}) {
  const r = esperar(await post('/insumos', { nombre, unidad, ...extra }), 201);
  ids[nombre] = r.id;
  return r;
}
async function comprar(nombre, cantidad, costo_total, extra = {}) {
  return esperar(await post('/stock/ingresos', { id_insumo: ids[nombre], cantidad, costo_total, ...extra }), 201);
}

test('proveedores: alta, duplicado y edición', async () => {
  const a = esperar(await post('/proveedores', { nombre: 'Distribuidora Río', contacto: 'Marcos' }), 201);
  ids.rio = a.id;
  ids.puerto = esperar(await post('/proveedores', { nombre: 'Mayorista del Puerto' }), 201).id;
  assert.equal((await post('/proveedores', { nombre: 'Distribuidora Río' })).status, 409);
  const e = esperar(await api('PATCH', `/proveedores/${a.id}`, { token, body: { telefono: '11 5555' } }), 200);
  assert.equal(e.telefono, '11 5555');
});

test('insumos: validaciones, duplicado y proveedor inexistente', async () => {
  const mal = await post('/insumos', { nombre: 'X', unidad: 'litros' });
  assert.equal(mal.status, 400);
  assert.equal(mal.body.detalles[0].campo, 'unidad');
  await insumo('Gin', 'ml', { stock_minimo: 1000, stock_maximo: 9000 });
  assert.equal((await post('/insumos', { nombre: 'Gin', unidad: 'ml' })).status, 409);
  assert.equal((await post('/insumos', { nombre: 'Raro', unidad: 'g', stock_minimo: 500, stock_maximo: 100 })).status, 400);
  assert.equal((await post('/insumos', { nombre: 'Raro', unidad: 'g', id_proveedor: 9999 })).status, 422);
  await insumo('Vermut', 'ml');
  await insumo('Tahini', 'g'); // sin costo cargado
  await insumo('Pan', 'unidad');
});

test('insumos: el máximo se valida contra el mínimo también al editar', async () => {
  const r = await api('PATCH', `/insumos/${ids.Gin}`, { token, body: { stock_maximo: 500 } }); // mínimo es 1000
  assert.equal(r.status, 400);
  esperar(await api('PATCH', `/insumos/${ids.Gin}`, { token, body: { stock_maximo: null } }), 200); // sin máximo
  esperar(await api('PATCH', `/insumos/${ids.Gin}`, { token, body: { stock_maximo: 9000 } }), 200);
});

test('costo por proveedor: cada compra fija el costo unitario y se pueden comparar proveedores', async () => {
  await comprar('Gin', 750, 18000, { id_proveedor: ids.rio, fecha_ingreso: '2026-10-01' }); // 24 por ml
  await comprar('Gin', 750, 19500, { id_proveedor: ids.puerto, fecha_ingreso: '2026-10-10' }); // 26 por ml
  await comprar('Gin', 750, 17250, { id_proveedor: ids.rio, fecha_ingreso: '2026-10-12' }); // 23 por ml
  await comprar('Vermut', 1000, 6000, { id_proveedor: ids.rio });
  await comprar('Pan', 20, 4000);

  const c = esperar(await get(`/insumos/${ids.Gin}/compras`), 200);
  assert.equal(c.compras.length, 3);
  // último precio de cada proveedor, del más barato al más caro
  assert.deepEqual(c.por_proveedor.map((p) => [p.proveedor, p.costo_unitario]), [['Distribuidora Río', 23], ['Mayorista del Puerto', 26]]);

  const lista = esperar(await get('/insumos'), 200);
  const gin = lista.find((i) => i.nombre === 'Gin');
  assert.equal(gin.costo_unitario, 23); // costeo por última compra
  assert.equal(gin.stock_actual, 2250);
  assert.equal(gin.proveedor, 'Distribuidora Río');
});

test('productos: costo de receta, margen y receta con costo por línea', async () => {
  const p = esperar(await post('/productos', {
    nombre: 'Negroni', descripcion: 'Clásico', categoria: 'Coctelería', precio: 9500, destino: 'barra',
    receta: [{ id_insumo: ids.Gin, cantidad: 30 }, { id_insumo: ids.Vermut, cantidad: 30 }],
  }), 201);
  ids.Negroni = p.id;
  assert.equal(p.costo, 30 * 23 + 30 * 6); // 870
  assert.equal(p.margen, 9500 - 870);
  assert.equal(p.margen_pct, 90.8);
  assert.equal(p.costo_incompleto, false);
  assert.deepEqual(p.receta.map((l) => [l.insumo, l.costo_linea]), [['Gin', 690], ['Vermut', 180]]);
});

test('productos: un insumo sin costo marca el costo como incompleto; sin receta no hay margen', async () => {
  const p = esperar(await post('/productos', {
    nombre: 'Hummus', categoria: 'Tapeo', precio: 7800, destino: 'cocina',
    receta: [{ id_insumo: ids.Pan, cantidad: 1 }, { id_insumo: ids.Tahini, cantidad: 20 }],
  }), 201);
  ids.Hummus = p.id;
  assert.equal(p.costo_incompleto, true);
  const agua = esperar(await post('/productos', { nombre: 'Agua', categoria: 'Sin alcohol', precio: 3000, destino: 'barra' }), 201);
  ids.Agua = agua.id;
  assert.equal(agua.tiene_receta, false);
  assert.equal(agua.margen_pct, null);
});

test('productos: validaciones de receta y nombre duplicado', async () => {
  const base = { nombre: 'Otro', categoria: 'X', precio: 100, destino: 'barra' };
  assert.equal((await post('/productos', { ...base, receta: [{ id_insumo: ids.Gin, cantidad: 10 }, { id_insumo: ids.Gin, cantidad: 5 }] })).status, 400);
  assert.equal((await post('/productos', { ...base, receta: [{ id_insumo: 9999, cantidad: 10 }] })).status, 422);
  assert.equal((await post('/productos', { ...base, receta: [{ id_insumo: ids.Gin, cantidad: 0 }] })).status, 400);
  assert.equal((await post('/productos', { ...base, precio: -1 })).status, 400);
  assert.equal((await post('/productos', { ...base, destino: 'terraza' })).status, 400);
  assert.equal((await post('/productos', { ...base, nombre: 'Negroni' })).status, 409);
  // el producto fallido no dejó nada a medias
  assert.equal(esperar(await get('/productos'), 200).filter((p) => p.nombre === 'Otro').length, 0);
});

test('receta: se puede reemplazar y el costo se recalcula', async () => {
  const p = esperar(await api('PUT', `/productos/${ids.Negroni}/receta`, { token, body: { receta: [{ id_insumo: ids.Gin, cantidad: 40 }] } }), 200);
  assert.equal(p.costo, 920);
  esperar(await api('PUT', `/productos/${ids.Negroni}/receta`, { token, body: { receta: [{ id_insumo: ids.Gin, cantidad: 30 }, { id_insumo: ids.Vermut, cantidad: 30 }] } }), 200);
});

test('editar un producto no cambia su precio: el precio tiene su propio camino', async () => {
  const p = esperar(await api('PATCH', `/productos/${ids.Negroni}`, { token, body: { descripcion: 'Gin, vermut y Campari', precio: 1 } }), 200);
  assert.equal(p.descripcion, 'Gin, vermut y Campari');
  assert.equal(p.precio, 9500);
});

test('precio: cambio individual y valores inválidos', async () => {
  const p = esperar(await api('PATCH', `/productos/${ids.Negroni}/precio`, { token, body: { precio: 10000 } }), 200);
  assert.equal(p.precio, 10000);
  assert.equal((await api('PATCH', `/productos/${ids.Negroni}/precio`, { token, body: { precio: -5 } })).status, 400);
  assert.equal((await api('PATCH', `/productos/${ids.Negroni}/precio`, { token, body: { precio: '100' } })).status, 400);
  assert.equal((await api('PATCH', '/productos/99999/precio', { token, body: { precio: 5 } })).status, 404);
});

test('precios finales de varios platos: todo o nada', async () => {
  const mal = await api('PUT', '/productos/precios', { token, body: { precios: [{ id: ids.Negroni, precio: 11111 }, { id: 99999, precio: 1 }] } });
  assert.equal(mal.status, 404);
  const sigue = esperar(await get('/productos'), 200).find((p) => p.id === ids.Negroni);
  assert.equal(sigue.precio, 10000); // el primero no se aplicó
  const ok = esperar(await api('PUT', '/productos/precios', { token, body: { precios: [{ id: ids.Negroni, precio: 9500 }, { id: ids.Hummus, precio: 8000 }] } }), 200);
  assert.deepEqual(ok.map((p) => p.precio), [9500, 8000]);
  assert.equal((await api('PUT', '/productos/precios', { token, body: { precios: [{ id: 1, precio: 1 }, { id: 1, precio: 2 }] } })).status, 400); // repetido
});

test('ajuste por porcentaje: la vista previa no cambia nada y aplicar sí', async () => {
  const antes = esperar(await get('/productos'), 200).map((p) => [p.id, p.precio]);
  const previa = esperar(await post('/productos/ajuste-precios', { modo: 'porcentaje', valor: 10 }), 200);
  assert.equal(previa.aplicado, false);
  assert.equal(previa.cambios.find((c) => c.nombre === 'Negroni').precio_nuevo, 10450);
  assert.deepEqual(esperar(await get('/productos'), 200).map((p) => [p.id, p.precio]), antes);

  const hecho = esperar(await post('/productos/ajuste-precios', { modo: 'porcentaje', valor: 10, categoria: 'Tapeo', paso: 50, aplicar: true }), 200);
  assert.equal(hecho.aplicado, true);
  assert.deepEqual(hecho.cambios.map((c) => [c.nombre, c.precio_nuevo]), [['Hummus', 8800]]); // 8000 + 10% = 8800, a múltiplos de 50
  const prods = esperar(await get('/productos'), 200);
  assert.equal(prods.find((p) => p.nombre === 'Hummus').precio, 8800);
  assert.equal(prods.find((p) => p.nombre === 'Negroni').precio, 9500); // otra categoría: sin tocar

  esperar(await post('/productos/ajuste-precios', { modo: 'porcentaje', valor: -10, ids: [ids.Hummus], aplicar: true }), 200);
  assert.equal(esperar(await get('/productos'), 200).find((p) => p.nombre === 'Hummus').precio, 7920);
});

test('ajuste por margen: fija el precio para llegar al margen pedido y avisa lo que no puede calcular', async () => {
  const r = esperar(await post('/productos/ajuste-precios', { modo: 'margen', valor: 80, aplicar: true, paso: 10 }), 200);
  const negroni = r.cambios.find((c) => c.nombre === 'Negroni');
  assert.equal(negroni.precio_nuevo, 4350); // costo 870 / (1 - 0,80)
  assert.equal(negroni.margen_pct_nuevo, 80);
  assert.deepEqual(r.omitidos.map((o) => [o.nombre, o.motivo]).sort(), [
    ['Agua', 'No tiene receta'],
    ['Hummus', 'Faltan costos de algún insumo de la receta'],
  ]);
  assert.equal(esperar(await get('/productos'), 200).find((p) => p.nombre === 'Negroni').precio, 4350);
  assert.equal((await post('/productos/ajuste-precios', { modo: 'margen', valor: 100 })).status, 400);
  assert.equal((await post('/productos/ajuste-precios', { modo: 'margen', valor: 50, paso: 0 })).status, 400);
  assert.equal((await post('/productos/ajuste-precios', { modo: 'porcentaje', valor: -100 })).status, 400);
  esperar(await post('/productos/ajuste-precios', { modo: 'porcentaje', valor: 0 }), 200); // 0% es válido y no cambia nada
});

test('el personal no ve costos ni márgenes; el administrador sí', async () => {
  const cam = await conSesion('camarero');
  const vista = esperar(await api('GET', '/productos', { token: cam.token }), 200);
  assert.ok(vista.every((p) => !('costo' in p) && !('margen' in p) && !('margen_pct' in p)));
  assert.equal((await api('GET', `/productos/${ids.Negroni}`, { token: cam.token })).status, 403);
  const insumos = esperar(await api('GET', '/insumos', { token: cam.token }), 200);
  assert.deepEqual(Object.keys(insumos[0]).sort(), ['id', 'nombre', 'presentaciones', 'unidad']);
  const admin = esperar(await get('/productos'), 200);
  assert.ok(admin.every((p) => 'margen_pct' in p));
});

test('dar de baja: un insumo en uso no se puede; un producto sale de la carta pero se conserva', async () => {
  const r = await api('DELETE', `/insumos/${ids.Gin}`, { token });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.detalles.productos, ['Negroni']);

  const carta1 = esperar(await api('GET', '/carta'), 200);
  assert.ok(carta1.flatMap((g) => g.items).some((i) => i.nombre === 'Negroni'));
  assert.ok(carta1.flatMap((g) => g.items).every((i) => !('costo' in i) && !('destino' in i)));

  esperar(await api('DELETE', `/productos/${ids.Negroni}`, { token }), 200);
  const carta2 = esperar(await api('GET', '/carta'), 200);
  assert.ok(!carta2.flatMap((g) => g.items).some((i) => i.nombre === 'Negroni'));
  assert.ok(esperar(await get('/productos', { incluir_inactivos: 'true' }), 200).some((p) => p.nombre === 'Negroni' && !p.activo));

  // un producto de baja ya no cuenta como "uso activo": ahora el insumo se puede dar de baja
  esperar(await api('DELETE', `/insumos/${ids.Vermut}`, { token }), 200);
  esperar(await api('PATCH', `/productos/${ids.Negroni}`, { token, body: { activo: true } }), 200);
});

test('la carta agrupa por categoría', async () => {
  const carta = esperar(await api('GET', '/carta'), 200);
  assert.ok(carta.length >= 2);
  for (const g of carta) assert.ok(g.items.length > 0 && g.categoria);
});
