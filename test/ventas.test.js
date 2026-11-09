// Reportes de ventas y cierre de caja: jornada comercial (06:00 a 06:00), márgenes, permisos y arqueo.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { AHORA, api, conSesion, esperar, iniciarBase } from './ayuda.js';

const T = {};
const ids = {};
const t = (iso) => new Date(iso);
const AHORA_NOCHE_B = t('2026-10-15T04:00:00Z'); // 01:00 del jueves 15: sigue la jornada del miércoles 14
const llamar = (metodo, ruta, rol, { body, query, ahora = AHORA_NOCHE_B } = {}) => api(metodo, ruta, { token: T[rol], body, query, ahora });
const linea = (nombre, cantidad = 1) => ({ id_producto: ids[nombre], cantidad });

before(async () => {
  await iniciarBase();
  for (const rol of ['administrador', 'cajero', 'barra', 'camarero', 'host', 'cocina']) T[rol] = (await conSesion(rol)).token;
  const insumo = async (nombre, unidad, stock, costoTotal) => {
    ids[nombre] = esperar(await llamar('POST', '/insumos', 'administrador', { body: { nombre, unidad } }), 201).id;
    esperar(await llamar('POST', '/stock/ingresos', 'administrador', { ahora: AHORA, body: { id_insumo: ids[nombre], cantidad: stock, costo_total: costoTotal } }), 201);
  };
  await insumo('Gin', 'ml', 5000, 130000);    // $26 por ml
  await insumo('Tónica', 'ml', 10000, 15000); // $1,5 por ml
  await insumo('Pan', 'unidad', 100, 30000);  // $300 c/u
  const producto = async (nombre, categoria, destino, precio, receta) => {
    ids[nombre] = esperar(await llamar('POST', '/productos', 'administrador', { body: { nombre, categoria, destino, precio, receta } }), 201).id;
  };
  await producto('Gin tonic', 'Coctelería', 'barra', 8000, [{ id_insumo: ids.Gin, cantidad: 50 }, { id_insumo: ids.Tónica, cantidad: 150 }]); // costo 1525
  await producto('Tostada', 'Para picar', 'cocina', 5000, [{ id_insumo: ids.Pan, cantidad: 2 }]);                                               // costo 600
  await producto('Agua', 'Sin alcohol', 'barra', 2000, []);                                                                                    // sin receta: costo desconocido
  for (const [n, z] of [['M1', 'interior'], ['M2', 'interior'], ['M3', 'exterior'], ['M4', 'exterior']]) {
    ids[n] = esperar(await llamar('POST', '/mesas', 'administrador', { body: { nombre: n, zona: z, capacidad: 4 } }), 201).id;
  }
});

/** Una venta completa: se pide a las `pedido`, se deja lista y se cobra a las `cobro`. */
async function vender({ mesa = null, etiqueta = '', items, medio, pedido, cobro, mozo = 'camarero', anular = null }) {
  const body = mesa ? { canal: 'mesa', id_mesa: ids[mesa], items } : { canal: 'barra', etiqueta, items };
  const p = esperar(await llamar('POST', '/pedidos', mozo, { body, ahora: t(pedido) }), 201);
  if (anular) {
    const extra = esperar(await llamar('POST', `/pedidos/${p.id}/items`, mozo, { body: { items: [linea(anular)] }, ahora: t(pedido) }), 201);
    const nuevo = extra.items.find((i) => i.nombre === anular && i.estado === 'pendiente' && !p.items.some((x) => x.id === i.id));
    esperar(await llamar('DELETE', `/pedido-items/${nuevo.id}`, mozo, { ahora: t(pedido) }), 200);
  }
  const vivos = esperar(await llamar('GET', `/pedidos/${p.id}`, mozo), 200).items.filter((i) => i.estado === 'pendiente').map((i) => i.id);
  if (vivos.length) esperar(await llamar('PATCH', '/pedido-items/estado', 'administrador', { body: { ids: vivos, estado: 'listo' }, ahora: t(pedido) }), 200);
  return esperar(await llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: medio }, ahora: t(cobro) }), 200);
}

test('se cargan dos noches de ventas, una de ellas con cobros pasada la medianoche', async () => {
  // Noche del martes 13 (cobros a las 20:00 y a la 01:30 del miércoles)
  await vender({ mesa: 'M1', items: [linea('Gin tonic', 2)], medio: 'efectivo', pedido: '2026-10-13T22:40:00Z', cobro: '2026-10-13T23:00:00Z' });
  await vender({ etiqueta: 'Juan', items: [linea('Tostada'), linea('Agua')], medio: 'tarjeta', pedido: '2026-10-14T04:10:00Z', cobro: '2026-10-14T04:30:00Z', mozo: 'barra' });
  // Noche del miércoles 14 (con una línea anulada en M2)
  await vender({ mesa: 'M2', items: [linea('Gin tonic'), linea('Agua')], medio: 'mercado_pago', pedido: '2026-10-14T21:40:00Z', cobro: '2026-10-14T22:00:00Z', anular: 'Tostada' });
  await vender({ mesa: 'M3', items: [linea('Tostada', 2)], medio: 'efectivo', pedido: '2026-10-15T03:10:00Z', cobro: '2026-10-15T03:30:00Z' });
});

test('reporte: la venta de la 01:30 cuenta en la noche anterior, no en el día calendario siguiente', async () => {
  const r = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-10-13', hasta: '2026-10-14' } }), 200);
  assert.deepEqual(r.por_jornada.map((j) => [j.fecha, j.cuentas, j.ventas]), [['2026-10-13', 2, 23000], ['2026-10-14', 2, 20000]]);
  assert.equal(r.por_jornada[0].ticket_promedio, 11500);
  // y si se pide solo la primera noche, entra también la venta de la madrugada
  const solo = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-10-13', hasta: '2026-10-13' } }), 200);
  assert.equal(solo.resumen.cuentas, 2);
  assert.equal(solo.resumen.ventas, 23000);
});

test('reporte: totales, ticket promedio, canal y medio de pago', async () => {
  const r = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-10-13', hasta: '2026-10-14' } }), 200);
  assert.equal(r.resumen.ventas, 43000);
  assert.equal(r.resumen.cuentas, 4);
  assert.equal(r.resumen.ticket_promedio, 10750);
  assert.equal(r.resumen.unidades, 8);
  assert.deepEqual(r.por_canal.map((c) => [c.canal, c.cuentas, c.ventas]), [['mesa', 3, 36000], ['barra', 1, 7000]]);
  assert.deepEqual(r.por_medio.map((m) => [m.medio_pago, m.cuentas, m.ventas]), [['efectivo', 2, 26000], ['tarjeta', 1, 7000], ['mercado_pago', 1, 10000], ['transferencia', 0, 0]]);
  assert.deepEqual(r.por_usuario.map((u) => [u.nombre, u.ventas]), [['Usuario camarero', 36000], ['Usuario barra', 7000]]);
});

test('reporte: productos, categorías y márgenes con el costo de cada momento; lo sin receta avisa que el margen es incompleto', async () => {
  const r = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-10-13', hasta: '2026-10-14' } }), 200);
  const gt = r.por_producto.find((p) => p.nombre === 'Gin tonic');
  assert.deepEqual([gt.unidades, gt.ventas, gt.costo, gt.margen], [3, 24000, 4575, 19425]);
  assert.deepEqual(r.por_producto.map((p) => p.nombre), ['Gin tonic', 'Tostada', 'Agua']);
  assert.equal(r.por_producto.find((p) => p.nombre === 'Agua').sin_costo, true);
  assert.equal(r.por_categoria.find((c) => c.categoria === 'Coctelería').ventas, 24000);
  // margen total solo sobre lo que tiene costo: (24000 + 15000 − 6375) / 39000
  assert.equal(r.resumen.costo, 6375);
  assert.equal(r.resumen.margen, 32625);
  assert.equal(r.resumen.margen_pct, 83.65);
  assert.equal(r.resumen.margen_incompleto, true);
  assert.equal(r.resumen.lineas_sin_costo, 2);
});

test('reporte: lo anulado no suma a las ventas pero queda para control', async () => {
  const r = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-10-14', hasta: '2026-10-14' } }), 200);
  assert.equal(r.resumen.ventas, 20000);
  assert.deepEqual(r.resumen.anulado, { lineas: 1, monto: 5000 });
});

test('reporte: los pedidos por hora salen en el orden de la noche (18, 19 … 0, 1)', async () => {
  const r = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-10-13', hasta: '2026-10-14' } }), 200);
  assert.deepEqual(r.por_hora.map((h) => h.hora), [18, 19, 0, 1]);
});

test('reporte: período por defecto, validaciones y permisos', async () => {
  const sin = esperar(await llamar('GET', '/reportes/ventas', 'administrador'), 200); // últimas 7 jornadas hasta la actual (14/10)
  assert.equal(sin.hasta, '2026-10-14');
  assert.equal(sin.desde, '2026-10-08');
  assert.equal(sin.resumen.cuentas, 4);
  const vacio = esperar(await llamar('GET', '/reportes/ventas', 'administrador', { query: { desde: '2026-01-01', hasta: '2026-01-02' } }), 200);
  assert.deepEqual([vacio.resumen.ventas, vacio.resumen.ticket_promedio, vacio.resumen.margen_pct, vacio.por_producto.length], [0, 0, null, 0]);
  const mal = (query) => llamar('GET', '/reportes/ventas', 'administrador', { query });
  assert.equal((await mal({ desde: '2026-10-14', hasta: '2026-10-13' })).status, 400);
  assert.equal((await mal({ desde: '14/10/2026' })).status, 400);
  assert.equal((await mal({ desde: '2025-01-01', hasta: '2026-10-14' })).status, 400);
  for (const rol of ['cajero', 'camarero', 'barra', 'cocina', 'host']) assert.equal((await llamar('GET', '/reportes/ventas', rol)).status, 403, rol);
  assert.equal((await api('GET', '/reportes/ventas', { ahora: AHORA })).status, 401);
});

test('caja: la jornada en curso muestra lo cobrado por medio de pago, sin costos', async () => {
  const j = esperar(await llamar('GET', '/caja/jornada', 'cajero'), 200);
  assert.equal(j.fecha, '2026-10-14');
  assert.equal(j.es_actual, true);
  assert.equal(j.ventas_total, 20000);
  assert.equal(j.ventas_efectivo, 10000);
  assert.deepEqual(j.por_medio.map((m) => [m.medio_pago, m.ventas]), [['efectivo', 10000], ['tarjeta', 0], ['mercado_pago', 10000], ['transferencia', 0]]);
  assert.equal(j.cierre, null);
  assert.equal(JSON.stringify(j).includes('costo'), false); // el cajero no ve costos ni márgenes
  const ayer = esperar(await llamar('GET', '/caja/jornada', 'administrador', { query: { fecha: '2026-10-13' } }), 200);
  assert.deepEqual([ayer.es_actual, ayer.ventas_total, ayer.ventas_efectivo], [false, 23000, 16000]);
  assert.equal((await llamar('GET', '/caja/jornada', 'camarero')).status, 403);
  assert.equal((await llamar('GET', '/caja/jornada', 'cajero', { query: { fecha: 'ayer' } })).status, 400);
});

test('cierre: con una cuenta abierta no se puede cerrar; al cancelarla, sí aparece como cancelada', async () => {
  const abierta = esperar(await llamar('POST', '/pedidos', 'camarero', { body: { canal: 'mesa', id_mesa: ids.M4, items: [linea('Agua')] } }), 201);
  const r = await llamar('POST', '/caja/cierres', 'cajero', { body: { efectivo_contado: 10000 } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.detalles.abiertas, [abierta.id]);
  assert.equal(esperar(await llamar('GET', '/caja/jornada', 'cajero'), 200).abiertas[0].mesa, 'M4');
  esperar(await llamar('DELETE', `/pedido-items/${abierta.items[0].id}`, 'camarero'), 200);
  esperar(await llamar('POST', `/pedidos/${abierta.id}/cancelar`, 'camarero'), 200);
  assert.equal(esperar(await llamar('GET', '/caja/jornada', 'cajero'), 200).canceladas, 1);
});

test('cierre: arqueo con fondo, retiros y diferencia (falta plata)', async () => {
  const c = esperar(await llamar('POST', '/caja/cierres', 'cajero', { body: { fondo_inicial: 5000, retiros: 2000, efectivo_contado: 12500, nota: 'faltan $500' } }), 201);
  assert.equal(c.fecha_jornada, '2026-10-14');
  assert.deepEqual([c.cuentas, c.ventas_total, c.ventas_efectivo, c.ventas_mercado_pago, c.ventas_tarjeta], [2, 20000, 10000, 10000, 0]);
  assert.deepEqual([c.efectivo_esperado, c.efectivo_contado, c.diferencia], [13000, 12500, -500]); // 5000 + 10000 − 2000
  assert.equal(c.usuario, 'Usuario cajero');
  assert.equal(c.nota, 'faltan $500');
  ids.cierre = c.id;
  const j = esperar(await llamar('GET', '/caja/jornada', 'cajero'), 200);
  assert.equal(j.cierre.id, c.id);
});

test('cierre: una sola vez por jornada, no se cierra el futuro y se validan los montos', async () => {
  const cerrar = (body, rol = 'cajero') => llamar('POST', '/caja/cierres', rol, { body });
  assert.equal((await cerrar({ efectivo_contado: 1 })).status, 409);
  assert.equal((await cerrar({ fecha: '2026-10-16', efectivo_contado: 1 })).status, 400);
  assert.equal((await cerrar({ fecha: '2026-10-13', efectivo_contado: -1 })).status, 400);
  assert.equal((await cerrar({ fecha: '2026-10-13' })).status, 400);
  assert.equal((await cerrar({ fecha: '2026-10-13', efectivo_contado: 1, retiros: -5 })).status, 400);
  for (const rol of ['camarero', 'barra', 'host', 'cocina']) assert.equal((await cerrar({ fecha: '2026-10-13', efectivo_contado: 1 }, rol)).status, 403, rol);
  // una jornada anterior también se puede cerrar (sobrante)
  const ayer = esperar(await cerrar({ fecha: '2026-10-13', efectivo_contado: 17000 }, 'administrador'), 201);
  assert.deepEqual([ayer.efectivo_esperado, ayer.diferencia], [16000, 1000]);
});

test('cierre: con la caja cerrada no se cobra; el administrador la reabre y el cierre queda para repetirse', async () => {
  const p = esperar(await llamar('POST', '/pedidos', 'camarero', { body: { canal: 'mesa', id_mesa: ids.M4, items: [linea('Agua')] } }), 201);
  esperar(await llamar('PATCH', '/pedido-items/estado', 'administrador', { body: { ids: [p.items[0].id], estado: 'listo' } }), 200);
  const rechazo = await llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: 'efectivo' } });
  assert.equal(rechazo.status, 409);
  assert.match(rechazo.body.error ?? rechazo.body.mensaje ?? JSON.stringify(rechazo.body), /caja/);
  assert.equal((await llamar('DELETE', `/caja/cierres/${ids.cierre}`, 'cajero')).status, 403);
  assert.equal((await llamar('DELETE', '/caja/cierres/9999', 'administrador')).status, 404);
  esperar(await llamar('DELETE', `/caja/cierres/${ids.cierre}`, 'administrador'), 204);
  esperar(await llamar('POST', `/pedidos/${p.id}/cerrar`, 'cajero', { body: { medio_pago: 'efectivo' } }), 200);
  const nuevo = esperar(await llamar('POST', '/caja/cierres', 'cajero', { body: { fondo_inicial: 5000, retiros: 2000, efectivo_contado: 15000 } }), 201);
  assert.deepEqual([nuevo.ventas_efectivo, nuevo.efectivo_esperado, nuevo.diferencia], [12000, 15000, 0]);
});

test('historial de cierres: del más reciente al más antiguo', async () => {
  const h = esperar(await llamar('GET', '/caja/cierres', 'cajero'), 200);
  assert.deepEqual(h.map((c) => c.fecha_jornada), ['2026-10-14', '2026-10-13']);
  assert.equal((await llamar('GET', '/caja/cierres', 'camarero')).status, 403);
});
