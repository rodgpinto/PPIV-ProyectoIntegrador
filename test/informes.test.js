import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprasSugeridas, compararPeriodos, consumoRealVsTeorico, rentabilidad, resumenMermas, textoDePedido, valorizarStock } from '../src/domain/informes.js';

const gin = { id: 1, nombre: 'Gin', unidad: 'ml', costo_unitario: 26 };
const pan = { id: 2, nombre: 'Pan', unidad: 'unidad', costo_unitario: 300 };

test('consumo real vs teórico: ventas, anulaciones, mermas y conteo, en cantidades y pesos', () => {
  const r = consumoRealVsTeorico([
    { id_insumo: 1, tipo: 'venta', motivo: null, costo_unitario: 26, cantidad: -1000 },
    { id_insumo: 1, tipo: 'reversion', motivo: null, costo_unitario: 26, cantidad: 100 }, // se anuló una venta
    { id_insumo: 1, tipo: 'merma', motivo: 'se_cayo', costo_unitario: 26, cantidad: -50 },
    { id_insumo: 1, tipo: 'ajuste', motivo: null, costo_unitario: 26, cantidad: -150 }, // el conteo encontró 150 de menos
    { id_insumo: 1, tipo: 'ingreso', motivo: null, costo_unitario: 26, cantidad: 5000 }, // no cuenta
    { id_insumo: 2, tipo: 'venta', motivo: null, costo_unitario: null, cantidad: -20 }, // sin costo en el movimiento: usa el del insumo
    { id_insumo: 2, tipo: 'ajuste', motivo: null, costo_unitario: 300, cantidad: 2 }, // sobraron 2
  ], [gin, pan]);
  const g = r.filas.find((f) => f.id_insumo === 1);
  assert.deepEqual([g.teorico, g.merma, g.conteo, g.real, g.diferencia, g.diferencia_pct], [900, 50, 150, 1100, 200, 22.22]);
  assert.deepEqual([g.valor_teorico, g.valor_merma, g.valor_conteo, g.valor_real, g.valor_diferencia], [23400, 1300, 3900, 28600, 5200]);
  const p = r.filas.find((f) => f.id_insumo === 2);
  assert.deepEqual([p.teorico, p.conteo, p.diferencia, p.valor_diferencia], [20, -2, -2, -600]); // sobrante: diferencia negativa
  assert.equal(r.filas[0].id_insumo, 1); // primero lo que más plata se llevó
  assert.equal(r.resumen.valor_diferencia, 4600);
  assert.equal(r.resumen.valor_teorico, 29400);
});

test('consumo: un insumo sin costo cargado se avisa y no inventa valores', () => {
  const r = consumoRealVsTeorico([{ id_insumo: 9, tipo: 'venta', costo_unitario: null, cantidad: -5 }], [{ id: 9, nombre: 'X', unidad: 'g', costo_unitario: 0 }]);
  assert.equal(r.filas[0].sin_costo, true);
  assert.equal(r.filas[0].valor_teorico, 0);
  assert.equal(r.resumen.insumos_sin_costo, 1);
  assert.deepEqual(consumoRealVsTeorico([], []).filas, []);
});

test('stock valorizado: por lote, con faltante de carga aparte y sin contar lo que no hay', () => {
  const r = valorizarStock(
    [
      { id: 1, nombre: 'Gin', unidad: 'ml', costo_unitario: 30, stock_actual: 1500 },
      { id: 2, nombre: 'Pan', unidad: 'unidad', costo_unitario: 300, stock_actual: 10 },
      { id: 3, nombre: 'Hielo', unidad: 'g', costo_unitario: 0, stock_actual: 5000 },
      { id: 4, nombre: 'Lima', unidad: 'unidad', costo_unitario: 100, stock_actual: -12 },
      { id: 5, nombre: 'Vacío', unidad: 'g', costo_unitario: 1, stock_actual: 0 },
    ],
    [{ id_insumo: 1, cantidad_actual: 1000, costo_unitario: 26 }, { id_insumo: 1, cantidad_actual: 500, costo_unitario: 30 }],
  );
  // Gin: 1000×26 + 500×30 = 41.000 · Pan: 10 sueltos (sin lotes) a 300 = 3.000 · Hielo sin costo = 0
  assert.equal(r.total, 44000);
  assert.deepEqual(r.filas.map((f) => [f.nombre, f.valor]), [['Gin', 41000], ['Pan', 3000], ['Hielo', 0]]);
  assert.equal(r.filas[0].participacion_pct, 93.18);
  assert.equal(r.filas[1].acumulado_pct, 100);
  assert.equal(r.sin_costo, 1);
  assert.deepEqual(r.negativos.map((n) => n.nombre), ['Lima']);
});

test('mermas en pesos: por motivo y por insumo, y qué parte de las ventas representan', () => {
  const r = resumenMermas([
    { id_insumo: 1, motivo: 'se_cayo', costo_unitario: 26, cantidad: -100 },
    { id_insumo: 1, motivo: 'vencido', costo_unitario: 26, cantidad: -200 },
    { id_insumo: 2, motivo: 'vencido', costo_unitario: null, cantidad: -4 },
  ], [gin, pan], 100000);
  assert.equal(r.total, 2600 + 5200 + 1200);
  assert.deepEqual(r.por_motivo.map((m) => [m.motivo, m.valor]), [['vencido', 6400], ['se_cayo', 2600]]);
  assert.deepEqual(r.por_insumo.map((m) => [m.nombre, m.valor, m.cantidad]), [['Gin', 7800, 300], ['Pan', 1200, 4]]);
  assert.equal(r.pct_de_ventas, 9);
  assert.equal(resumenMermas([], [], 0).pct_de_ventas, null);
});

const insumoCompra = (o) => ({ id: 1, nombre: 'Gin', unidad: 'ml', stock_actual: 500, stock_minimo: 1000, stock_maximo: null, costo_unitario: 26, id_proveedor: 1, presentaciones: [], ...o });
const provs = [{ id: 1, nombre: 'Distribuidora Sur', contacto: 'Marta', telefono: '11-5555-0000' }, { id: 2, nombre: 'Verdulería', contacto: '', telefono: '' }];

test('compras: lo que está bajo el mínimo se pide hasta el máximo y se agrupa por proveedor', () => {
  const r = comprasSugeridas({
    insumos: [
      insumoCompra({ stock_maximo: 3000 }),
      insumoCompra({ id: 2, nombre: 'Limón', unidad: 'unidad', stock_actual: 0, stock_minimo: 20, id_proveedor: 2, costo_unitario: 100 }),
      insumoCompra({ id: 3, nombre: 'Sal', stock_actual: 5000, stock_minimo: 1000 }), // sobra
      insumoCompra({ id: 4, nombre: 'Sin dato', stock_actual: 0, stock_minimo: 0 }), // sin mínimo ni consumo: no se puede decidir
    ],
    consumos: new Map(), proveedores: provs,
  });
  assert.equal(r.total_items, 2);
  const sur = r.proveedores.find((p) => p.id_proveedor === 1);
  assert.equal(sur.items[0].sugerida, 2500); // hasta el máximo
  assert.equal(sur.items[0].costo_estimado, 65000);
  assert.equal(sur.items[0].motivo, 'bajo_minimo');
  const verd = r.proveedores.find((p) => p.id_proveedor === 2);
  assert.deepEqual([verd.items[0].sugerida, verd.items[0].motivo, verd.items[0].urgente], [40, 'sin_stock', true]); // sin máximo: el doble del mínimo
  assert.equal(r.proveedores[0].id_proveedor, 2); // lo urgente primero
  assert.equal(r.costo_estimado, 69000);
});

test('compras: redondea a envases enteros y usa el ritmo de consumo para avisar antes de llegar al mínimo', () => {
  const r = comprasSugeridas({
    insumos: [insumoCompra({ stock_actual: 1200, stock_minimo: 500, presentaciones: [{ nombre: 'Botella 750 ml', cantidad: 750, principal: true }] })],
    consumos: { 1: 14000 }, // 1000 ml por día: le quedan 1,2 días
    proveedores: provs, dias: 14, diasCobertura: 7,
  });
  const it = r.proveedores[0].items[0];
  assert.equal(it.motivo, 'se_agota');
  assert.equal(it.dias_de_stock, 1.2);
  // objetivo = 7 días × 1000 = 7000; faltan 5800 → 8 botellas (6000 ml)
  assert.deepEqual([it.presentacion.envases, it.sugerida], [8, 6000]);
  assert.equal(it.urgente, false);
});

test('compras: sin proveedor queda al final y sin costo se avisa; el texto para WhatsApp sale armado', () => {
  const r = comprasSugeridas({
    insumos: [insumoCompra({ id_proveedor: null, costo_unitario: 0, presentaciones: [{ nombre: 'Caja x 12', cantidad: 12, principal: true }], stock_actual: 0, stock_minimo: 24, unidad: 'unidad' }), insumoCompra({ id: 2, nombre: 'Tónica', id_proveedor: 1 })],
    consumos: {}, proveedores: provs,
  });
  assert.equal(r.proveedores.at(-1).nombre, 'Sin proveedor asignado');
  assert.equal(r.proveedores.at(-1).sin_costo, 1);
  const texto = textoDePedido(r.proveedores.find((p) => p.id_proveedor === 1), (n) => String(n));
  assert.match(texto, /^Hola Marta, necesitamos para RADAS:\n• Tónica: 1500 ml\n¡Gracias!$/);
});

const prod = (id, nombre, unidades, ventas, costo, sin = false) => ({ id_producto: id, nombre, categoria: 'X', unidades, ventas, costo, margen: ventas - costo, margen_pct: ventas ? ((ventas - costo) / ventas) * 100 : null, sin_costo: sin });

test('rentabilidad: aporte a la ganancia, clases A/B/C y cuadrante de ingeniería de menú', () => {
  const r = rentabilidad([
    prod(1, 'Negroni', 100, 100000, 30000), // margen 70.000 · cm 700
    prod(2, 'Cerveza', 200, 80000, 60000), // margen 20.000 · cm 100  (muy vendida, poco margen)
    prod(3, 'Tabla', 10, 30000, 6000), // margen 24.000 · cm 2.400 (poco vendida, gran margen)
    prod(4, 'Agua', 5, 2000, 1500), // margen 500 · cm 100
    prod(5, 'Mojito', 50, 40000, 0, true), // sin receta
  ]);
  const por = Object.fromEntries(r.filas.map((f) => [f.nombre, f]));
  assert.equal(r.margen_total, 114500);
  assert.equal(por.Negroni.aporte_pct, 61.14);
  assert.equal(por.Negroni.abc, 'A');
  assert.equal(por.Tabla.abc, 'A'); // 61,14 + 20,96 = 82,1: el que cruza el 80 % todavía es A
  assert.equal(por.Cerveza.abc, 'B');
  assert.equal(por.Agua.abc, 'C');
  // umbral de popularidad = 70 % de 1/4 = 17,5 % de las unidades; cm promedio = 114.500 / 315
  assert.equal(r.umbrales.popularidad_pct, 17.5);
  assert.equal(por.Negroni.clase_menu, 'estrella');
  assert.equal(por.Cerveza.clase_menu, 'caballo');
  assert.equal(por.Tabla.clase_menu, 'rompecabezas');
  assert.equal(por.Agua.clase_menu, 'perro');
  assert.equal(por.Mojito.clase_menu, null);
  assert.deepEqual(r.sin_costo, ['Mojito']);
  assert.equal(r.filas.at(-1).nombre, 'Mojito'); // lo que no tiene dato va al final
});

test('rentabilidad sin ventas no rompe', () => {
  const r = rentabilidad([]);
  assert.deepEqual([r.filas, r.margen_total], [[], 0]);
});

const periodo = (ventas, cuentas, unidades, margen, margen_pct, noches, productos = [], categorias = []) => ({
  resumen: { ventas, cuentas, ticket_promedio: cuentas ? ventas / cuentas : 0, unidades, margen, margen_pct },
  por_jornada: Array.from({ length: noches }, (_, i) => ({ fecha: `2026-10-${10 + i}` })),
  por_producto: productos, por_categoria: categorias,
});

test('comparar períodos: variaciones, venta por noche aunque duren distinto, y productos nuevos o sin ventas', () => {
  const a = periodo(300000, 30, 150, 120000, 40, 3, [{ id_producto: 1, nombre: 'Negroni', unidades: 100, ventas: 200000 }, { id_producto: 3, nombre: 'Nuevo', unidades: 10, ventas: 20000 }], [{ categoria: 'Tragos', unidades: 110, ventas: 220000 }]);
  const b = periodo(200000, 25, 120, 70000, 35, 2, [{ id_producto: 1, nombre: 'Negroni', unidades: 50, ventas: 100000 }, { id_producto: 2, nombre: 'Viejo', unidades: 20, ventas: 40000 }], [{ categoria: 'Tragos', unidades: 70, ventas: 140000 }]);
  const c = compararPeriodos(a, b);
  assert.deepEqual([c.metricas.ventas.diferencia, c.metricas.ventas.diferencia_pct], [100000, 50]);
  assert.deepEqual([c.metricas.ventas_por_noche.actual, c.metricas.ventas_por_noche.previo, c.metricas.ventas_por_noche.diferencia_pct], [100000, 100000, 0]);
  assert.equal(c.metricas.margen_pct.diferencia, 5);
  assert.deepEqual(c.productos.map((p) => [p.nombre, p.estado, p.diferencia]), [['Negroni', 'comparable', 100000], ['Viejo', 'sin_ventas', -40000], ['Nuevo', 'nuevo', 20000]]);
  assert.equal(c.productos[0].diferencia_pct, 100);
  assert.equal(c.categorias[0].nombre, 'Tragos');
  assert.deepEqual(c.noches, { actual: 3, previo: 2 });
});

test('comparar con un período sin datos no divide por cero', () => {
  const c = compararPeriodos(periodo(1000, 1, 2, 500, 50, 1), periodo(0, 0, 0, 0, null, 0));
  assert.equal(c.metricas.ventas.diferencia_pct, null);
  assert.equal(c.metricas.margen_pct.diferencia, null);
  assert.equal(c.metricas.ventas_por_noche.previo, 0);
});
