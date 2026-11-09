// Informes del dueño de punta a punta: ventas reales, mermas, conteo y compras armados por la API.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { jornadaDe } from '../src/domain/ventas.js';
import { config } from '../src/config.js';
import { api, conSesion, esperar, iniciarBase } from './ayuda.js';

const T = {};
const ids = {};
const AHORA = new Date(); // los movimientos de stock se fechan con el reloj real
const HOY = jornadaDe(AHORA, config.zonaHoraria, config.jornadaInicioHora);
const llamar = (metodo, ruta, rol, { body, query } = {}) => api(metodo, ruta, { token: T[rol], body, query, ahora: AHORA });

before(async () => {
  await iniciarBase();
  for (const rol of ['administrador', 'cajero', 'camarero']) T[rol] = (await conSesion(rol)).token;
  ids.prov = esperar(await llamar('POST', '/proveedores', 'administrador', { body: { nombre: 'Distribuidora Sur', contacto: 'Marta', telefono: '11-5555-0000' } }), 201).id;
  ids.Gin = esperar(await llamar('POST', '/insumos', 'administrador', { body: { nombre: 'Gin', unidad: 'ml', id_proveedor: ids.prov } }), 201).id;
  ids.Pan = esperar(await llamar('POST', '/insumos', 'administrador', { body: { nombre: 'Pan', unidad: 'unidad' } }), 201).id;
  esperar(await llamar('PUT', `/insumos/${ids.Gin}/presentaciones`, 'administrador', { body: { presentaciones: [{ nombre: 'Botella 750 ml', cantidad: 750, principal: true }] } }), 200);
  esperar(await llamar('POST', '/stock/ingresos', 'administrador', { body: { id_insumo: ids.Gin, id_proveedor: ids.prov, cantidad: 3000, costo_total: 78000 } }), 201);
  esperar(await llamar('POST', '/stock/ingresos', 'administrador', { body: { id_insumo: ids.Pan, cantidad: 20, costo_total: 6000 } }), 201);
  const producto = async (nombre, destino, precio, receta) => {
    ids[nombre] = esperar(await llamar('POST', '/productos', 'administrador', { body: { nombre, categoria: nombre === 'Tostada' ? 'Comidas' : 'Tragos', destino, precio, receta } }), 201).id;
  };
  await producto('Gin tonic', 'barra', 8000, [{ id_insumo: ids.Gin, cantidad: 50 }]);
  await producto('Tostada', 'cocina', 5000, [{ id_insumo: ids.Pan, cantidad: 2 }]);
  await producto('Agua', 'barra', 2000, []);
  ids.M1 = esperar(await llamar('POST', '/mesas', 'administrador', { body: { nombre: 'M1', zona: 'interior', capacidad: 4 } }), 201).id;

  const cobrar = async (items, medio = 'efectivo') => {
    const p = esperar(await llamar('POST', '/pedidos', 'camarero', { body: { canal: 'mesa', id_mesa: ids.M1, items } }), 201);
    return p;
  };
  // 10 gin tonic en una cuenta, uno se anula antes de prepararlo (vuelve el gin); 5 tostadas en otra
  const a = await cobrar([{ id_producto: ids['Gin tonic'], cantidad: 5 }, { id_producto: ids['Gin tonic'], cantidad: 5 }]);
  esperar(await llamar('DELETE', `/pedido-items/${a.items[1].id}`, 'camarero'), 200);
  const resto = a.items[0];
  const cuenta = esperar(await llamar('POST', `/pedidos/${a.id}/items`, 'camarero', { body: { items: [{ id_producto: ids['Gin tonic'], cantidad: 4 }] } }), 201);
  void resto; void cuenta;
  for (const estado of ['listo', 'entregado']) {
    const actual = esperar(await llamar('GET', `/pedidos/${a.id}`, 'camarero'), 200);
    const pend = actual.items.filter((i) => i.estado !== 'anulado' && i.estado !== 'entregado' && (estado === 'listo' ? i.estado === 'pendiente' : i.estado === 'listo')).map((i) => i.id);
    if (pend.length) esperar(await llamar('PATCH', '/pedido-items/estado', 'administrador', { body: { ids: pend, estado } }), 200);
  }
  esperar(await llamar('POST', `/pedidos/${a.id}/cerrar`, 'cajero', { body: { medio_pago: 'efectivo' } }), 200);
  const b = await cobrar([{ id_producto: ids.Tostada, cantidad: 5 }]);
  for (const estado of ['listo', 'entregado']) esperar(await llamar('PATCH', '/pedido-items/estado', 'administrador', { body: { ids: b.items.map((i) => i.id), estado } }), 200);
  esperar(await llamar('POST', `/pedidos/${b.id}/cerrar`, 'cajero', { body: { medio_pago: 'tarjeta' } }), 200);
  // merma de 100 ml y conteo que encuentra 150 ml de menos
  esperar(await llamar('POST', '/stock/mermas', 'administrador', { body: { id_insumo: ids.Gin, cantidad: 100, motivo: 'se_cayo' } }), 201);
  const stockGin = esperar(await llamar('GET', '/insumos', 'administrador'), 200).find((i) => i.id === ids.Gin).stock_actual;
  esperar(await llamar('POST', '/stock/ajustes', 'administrador', { body: { id_insumo: ids.Gin, cantidad_real: stockGin - 150 } }), 201);
});

const q = (extra = {}) => ({ desde: HOY, hasta: HOY, ...extra });

test('consumo real vs teórico del gin: ventas netas de anulaciones + merma + conteo', async () => {
  const r = esperar(await llamar('GET', '/informes/consumo', 'administrador', { query: q() }), 200);
  const gin = r.filas.find((f) => f.nombre === 'Gin');
  // vendido: 5 + 4 gin tonic = 9 × 50 ml = 450 (el anulado devolvió sus 250)
  assert.deepEqual([gin.teorico, gin.merma, gin.conteo, gin.real, gin.diferencia], [450, 100, 150, 700, 250]);
  assert.deepEqual([gin.valor_teorico, gin.valor_merma, gin.valor_conteo, gin.valor_diferencia], [11700, 2600, 3900, 6500]);
  assert.equal(gin.diferencia_pct, 55.56);
  const pan = r.filas.find((f) => f.nombre === 'Pan');
  assert.deepEqual([pan.teorico, pan.diferencia, pan.valor_teorico], [10, 0, 3000]);
  assert.equal(r.filas[0].nombre, 'Gin'); // lo que más plata se llevó, primero
});

test('stock valorizado y mermas en pesos', async () => {
  const r = esperar(await llamar('GET', '/informes/stock', 'administrador', { query: q() }), 200);
  // gin: 3000 − 450 − 100 − 150 = 2300 ml a $26 · pan: 10 a $300
  assert.equal(r.stock.total, 2300 * 26 + 3000);
  assert.deepEqual(r.stock.filas.map((f) => f.nombre), ['Gin', 'Pan']);
  assert.equal(r.mermas.total, 2600);
  assert.equal(r.mermas.por_motivo[0].motivo, 'se_cayo');
  assert.equal(r.ventas, 9 * 8000 + 5 * 5000);
  assert.equal(r.mermas.pct_de_ventas, 2.68);
});

test('compras sugeridas: bajo el mínimo, por proveedor y en botellas enteras', async () => {
  let r = esperar(await llamar('GET', '/informes/compras', 'administrador'), 200);
  assert.equal(r.total_items, 0); // mínimo en 0 y consumo bajo: no hace falta nada
  esperar(await llamar('PATCH', `/insumos/${ids.Gin}`, 'administrador', { body: { stock_minimo: 3000, stock_maximo: 4000 } }), 200);
  r = esperar(await llamar('GET', '/informes/compras', 'administrador'), 200);
  assert.equal(r.total_items, 1);
  const g = r.proveedores[0];
  assert.equal(g.nombre, 'Distribuidora Sur');
  assert.equal(g.contacto, 'Marta');
  const it = g.items[0];
  // faltan 4000 − 2300 = 1700 ml → 3 botellas de 750 = 2250 ml
  assert.deepEqual([it.nombre, it.motivo, it.presentacion.envases, it.sugerida, it.costo_estimado], ['Gin', 'bajo_minimo', 3, 2250, 58500]);
  assert.equal(r.costo_estimado, 58500);
  assert.equal((await llamar('GET', '/informes/compras', 'administrador', { query: { dias: '1' } })).status, 400);
  assert.equal((await llamar('GET', '/informes/compras', 'administrador', { query: { dias: '30', cobertura: '14' } })).status, 200);
});

test('rentabilidad: aporte de cada producto y cuadrante', async () => {
  const r = esperar(await llamar('GET', '/informes/rentabilidad', 'administrador', { query: q() }), 200);
  const por = Object.fromEntries(r.filas.map((f) => [f.nombre, f]));
  assert.deepEqual([por['Gin tonic'].ventas, por['Gin tonic'].costo, por['Gin tonic'].margen], [72000, 11700, 60300]);
  assert.deepEqual([por.Tostada.margen, r.margen_total], [22000, 82300]);
  assert.equal(por['Gin tonic'].aporte_pct, 73.27);
  assert.equal(por['Gin tonic'].abc, 'A');
  assert.equal(por['Gin tonic'].clase_menu, 'estrella');
  assert.equal(por.Tostada.clase_menu, 'caballo');
  assert.ok(!r.filas.some((f) => f.nombre === 'Agua')); // no se vendió
});

test('comparar períodos: contra el anterior de la misma duración, y con fechas propias', async () => {
  const r = esperar(await llamar('GET', '/informes/comparar', 'administrador', { query: q() }), 200);
  assert.equal(r.actual.desde, HOY);
  assert.notEqual(r.previo.hasta, HOY);
  assert.equal(r.metricas.ventas.actual, 97000);
  assert.equal(r.metricas.ventas.previo, 0);
  assert.equal(r.metricas.ventas.diferencia_pct, null);
  assert.ok(r.productos.every((p) => p.estado === 'nuevo'));
  const solapa = await llamar('GET', '/informes/comparar', 'administrador', { query: { desde: HOY, hasta: HOY, desde_ant: HOY, hasta_ant: HOY } });
  assert.equal(solapa.status, 400);
  const raro = await llamar('GET', '/informes/comparar', 'administrador', { query: { desde: HOY, hasta: HOY, desde_ant: 'x', hasta_ant: HOY } });
  assert.equal(raro.status, 400);
});

test('solo el administrador ve los informes; fechas inválidas dan 400', async () => {
  for (const ruta of ['rentabilidad', 'comparar', 'consumo', 'stock', 'compras']) {
    for (const rol of ['cajero', 'camarero']) assert.equal((await llamar('GET', `/informes/${ruta}`, rol)).status, 403, `${rol} ${ruta}`);
    assert.equal((await api('GET', `/informes/${ruta}`, { ahora: AHORA })).status, 401);
  }
  assert.equal((await llamar('GET', '/informes/consumo', 'administrador', { query: { desde: 'ayer' } })).status, 400);
  assert.equal((await llamar('GET', '/informes/consumo', 'administrador', { query: { desde: '2026-10-14', hasta: '2026-10-01' } })).status, 400);
});
