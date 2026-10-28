import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularAlertas } from '../src/domain/alertas.js';
import { aplicarPorcentaje, calcularMargen, costoDeReceta, costoUnitarioDeCompra, precioParaMargen } from '../src/domain/costos.js';
import { diasEntre, esFecha, fechaEn, inicioDeDia, sumarDias } from '../src/domain/fechas.js';
import { esOlvidoEgreso, formatoHoras, minutosTrabajados, resumirHoras } from '../src/domain/horas.js';
import { asignarFefo } from '../src/domain/stock-fefo.js';

const BA = 'America/Argentina/Buenos_Aires';

test('fechas: día local, inicio de día y aritmética', () => {
  assert.equal(fechaEn(BA, new Date('2026-10-14T02:30:00Z')), '2026-10-13');
  assert.equal(inicioDeDia('2026-10-14', BA).toISOString(), '2026-10-14T03:00:00.000Z');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(diasEntre('2026-10-14', '2026-10-21'), 7);
  assert.equal(diasEntre('2026-10-14', '2026-10-10'), -4);
  assert.ok(esFecha('2026-02-28') && !esFecha('2026-02-30') && !esFecha('14/10/2026') && !esFecha(null));
});

test('horas: jornada nocturna que cruza la medianoche', () => {
  const f = { ingreso: '2026-10-09T22:00:00Z', egreso: '2026-10-10T05:30:00Z' };
  assert.equal(minutosTrabajados(f, new Date()), 450);
  assert.equal(formatoHoras(450), '7 h 30 min');
  assert.equal(formatoHoras(45), '45 min');
  assert.equal(formatoHoras(120), '2 h');
});

test('horas: fichaje abierto cuenta hasta ahora y detecta olvido de egreso', () => {
  const ahora = new Date('2026-10-14T20:00:00Z');
  const abierto = { ingreso: '2026-10-14T18:00:00Z', egreso: null };
  assert.equal(minutosTrabajados(abierto, ahora), 120);
  assert.equal(esOlvidoEgreso(abierto, ahora), false);
  assert.equal(esOlvidoEgreso({ ingreso: '2026-10-13T20:00:00Z', egreso: null }, ahora), true);
});

test('horas: resumen por empleado, turno y día de inicio', () => {
  const ahora = new Date('2026-10-14T12:00:00Z');
  const r = resumirHoras([
    { id_usuario: 2, nombre: 'Bruno', rol: 'barra', turno: 'servicio', ingreso: '2026-10-09T22:00:00Z', egreso: '2026-10-10T05:30:00Z' },
    { id_usuario: 1, nombre: 'Ana', rol: 'cocina', turno: 'produccion', ingreso: '2026-10-10T12:00:00Z', egreso: '2026-10-10T16:00:00Z' },
    { id_usuario: 1, nombre: 'Ana', rol: 'cocina', turno: 'servicio', ingreso: '2026-10-11T22:00:00Z', egreso: '2026-10-12T02:00:00Z' },
  ], ahora, BA);
  assert.deepEqual(r.map((x) => x.nombre), ['Ana', 'Bruno']);
  assert.equal(r[0].minutos, 480);
  assert.deepEqual(r[0].por_turno, { produccion: 240, servicio: 240 });
  assert.equal(r[1].por_dia['2026-10-09'], 450);
});

test('FEFO: sale primero lo que vence antes y lo que no vence va último', () => {
  const lotes = [
    { id: 1, cantidad_actual: 100, fecha_vencimiento: null, fecha_ingreso: '2026-10-01', costo_unitario: 1 },
    { id: 2, cantidad_actual: 50, fecha_vencimiento: '2026-10-20', fecha_ingreso: '2026-10-05', costo_unitario: 2 },
    { id: 3, cantidad_actual: 50, fecha_vencimiento: '2026-10-18', fecha_ingreso: '2026-10-06', costo_unitario: 3 },
  ];
  const { asignaciones, faltante } = asignarFefo(lotes, 120);
  assert.deepEqual(asignaciones.map((a) => [a.id_lote, a.cantidad]), [[3, 50], [2, 50], [1, 20]]);
  assert.equal(faltante, 0);
});

test('FEFO: informa el faltante cuando no alcanza y evita errores de coma flotante', () => {
  const lotes = [{ id: 1, cantidad_actual: 0.3, fecha_vencimiento: null, fecha_ingreso: '2026-10-01', costo_unitario: 1 }];
  assert.equal(asignarFefo(lotes, 0.1 + 0.2).faltante, 0);
  const r = asignarFefo(lotes, 1);
  assert.equal(r.asignaciones[0].cantidad, 0.3);
  assert.equal(r.faltante, 0.7);
  assert.deepEqual(asignarFefo([], 5), { asignaciones: [], faltante: 5 });
});

test('alertas: reponer, por vencer, vencidos y sobrestock', () => {
  const insumos = [
    { id: 1, nombre: 'Gin', unidad: 'ml', stock_actual: 500, stock_minimo: 1000, stock_maximo: null, dias_aviso_vencimiento: 7 },
    { id: 2, nombre: 'Prosecco', unidad: 'ml', stock_actual: 3000, stock_minimo: 0, stock_maximo: null, dias_aviso_vencimiento: 7 },
    { id: 3, nombre: 'Croquetas', unidad: 'unidad', stock_actual: 200, stock_minimo: 10, stock_maximo: 80, dias_aviso_vencimiento: 3 },
    { id: 4, nombre: 'Sal', unidad: 'g', stock_actual: 0, stock_minimo: 0, stock_maximo: null, dias_aviso_vencimiento: 7 },
  ];
  const lotes = [
    { id: 10, id_insumo: 2, cantidad_actual: 3000, fecha_ingreso: '2026-10-01', fecha_vencimiento: '2026-10-17' },
    { id: 11, id_insumo: 2, cantidad_actual: 100, fecha_ingreso: '2026-09-01', fecha_vencimiento: '2026-10-10' },
    { id: 12, id_insumo: 3, cantidad_actual: 200, fecha_ingreso: '2026-09-24', fecha_vencimiento: '2026-12-01' },
  ];
  const a = calcularAlertas({ insumos, lotes, hoy: '2026-10-14' });
  assert.deepEqual(a.reponer.map((x) => x.nombre), ['Gin']);
  assert.equal(a.reponer[0].faltante, 500);
  assert.deepEqual(a.por_vencer.map((x) => [x.id_lote, x.dias_restantes]), [[10, 3]]);
  assert.deepEqual(a.vencidos.map((x) => [x.id_lote, x.dias_vencido]), [[11, 4]]);
  assert.equal(a.sobrestock[0].nombre, 'Croquetas');
  assert.equal(a.sobrestock[0].dias_en_stock, 20);
  assert.equal(a.total, 4);
});

test('costos: costo de receta, margen y precios', () => {
  assert.equal(costoUnitarioDeCompra(18000, 750), 24);
  assert.equal(costoUnitarioDeCompra(100, 0), 0);
  const r = costoDeReceta([{ cantidad: 30, costo_unitario: 24 }, { cantidad: 30, costo_unitario: 10 }]);
  assert.deepEqual(r, { costo: 1020, incompleto: false });
  assert.equal(costoDeReceta([{ cantidad: 30, costo_unitario: 24 }, { cantidad: 5, costo_unitario: 0 }]).incompleto, true);
  assert.deepEqual(calcularMargen(4000, 1000), { margen: 3000, margen_pct: 75 });
  assert.equal(calcularMargen(0, 100).margen_pct, null);
  assert.equal(precioParaMargen(1000, 75), 4000);
  assert.equal(precioParaMargen(1020, 70), 3400);
  assert.equal(precioParaMargen(1000, 100), null);
  assert.equal(aplicarPorcentaje(7800, 10), 8580);
  assert.equal(aplicarPorcentaje(8200, -5), 7790);
});

import { agruparPorProducto, nivelDeEspera, puedeCambiar, totalDe, transicionValida } from '../src/domain/pedidos.js';

test('pedidos: pasos válidos entre estados', () => {
  assert.ok(transicionValida('pendiente', 'preparando') && transicionValida('pendiente', 'listo'));
  assert.ok(transicionValida('listo', 'entregado') && transicionValida('preparando', 'pendiente'));
  assert.ok(!transicionValida('pendiente', 'entregado') && !transicionValida('entregado', 'listo') && !transicionValida('anulado', 'pendiente'));
});

test('pedidos: quién puede cada cambio', () => {
  assert.ok(puedeCambiar({ rol: 'cocina', destino: 'cocina', a: 'listo' }));
  assert.ok(!puedeCambiar({ rol: 'cocina', destino: 'barra', a: 'listo' }));
  assert.ok(puedeCambiar({ rol: 'administrador', destino: 'barra', a: 'preparando' }));
  assert.ok(!puedeCambiar({ rol: 'camarero', destino: 'cocina', a: 'preparando' }));
  assert.ok(puedeCambiar({ rol: 'camarero', destino: 'cocina', a: 'entregado' }));
  assert.ok(!puedeCambiar({ rol: 'cocina', destino: 'cocina', a: 'entregado' }));
  assert.ok(!puedeCambiar({ rol: 'host', destino: 'barra', a: 'entregado' }));
});

test('pedidos: total ignora lo anulado; los redondeos no acumulan centavos', () => {
  assert.equal(totalDe([{ precio_unitario: 8000, cantidad: 2, estado: 'pendiente' }, { precio_unitario: 5000, cantidad: 1, estado: 'anulado' }]), 16000);
  assert.equal(totalDe([{ precio_unitario: 0.1, cantidad: 3, estado: 'listo' }]), 0.3);
});

test('pantalla de cocina: agrupa lo igual, separa por nota y por estado, y ordena por antigüedad', () => {
  const it = (id, id_producto, cantidad, creado_en, extra = {}) => ({ id, id_producto, nombre: `P${id_producto}`, cantidad, creado_en, nota: '', estado: 'pendiente', ...extra });
  const g = agruparPorProducto([
    it(1, 7, 2, '2026-10-14T20:05:00Z'),
    it(2, 8, 1, '2026-10-14T20:01:00Z'),
    it(3, 7, 3, '2026-10-14T20:00:00Z'),
    it(4, 7, 1, '2026-10-14T20:02:00Z', { nota: 'sin hielo' }),
    it(5, 7, 1, '2026-10-14T20:03:00Z', { estado: 'preparando' }),
  ]);
  assert.equal(g.length, 4);
  assert.deepEqual([g[0].id_producto, g[0].cantidad, g[0].items.length], [7, 5, 2]);  // 3 + 2 juntos, desde la más vieja
  assert.equal(g[0].desde, '2026-10-14T20:00:00Z');
  assert.deepEqual(g.map((x) => x.nota || x.estado), ['pendiente', 'pendiente', 'sin hielo', 'preparando']);
});

test('pantalla de cocina: la espera pasa a amarillo y rojo según el destino', () => {
  assert.equal(nivelDeEspera(3, 'barra'), 'normal');
  assert.equal(nivelDeEspera(6, 'barra'), 'aviso');
  assert.equal(nivelDeEspera(12, 'barra'), 'urgente');
  assert.equal(nivelDeEspera(11, 'cocina'), 'normal');
  assert.equal(nivelDeEspera(20, 'cocina'), 'urgente');
});

import { calcularArqueo, jornadaDe, rangoDeJornadas, resumirVentas } from '../src/domain/ventas.js';

test('jornada comercial: de 06:00 a 06:00, así lo vendido de madrugada va a la noche anterior', () => {
  assert.equal(jornadaDe('2026-10-14T22:00:00Z', BA), '2026-10-14');  // 19:00 del miércoles
  assert.equal(jornadaDe('2026-10-15T04:59:00Z', BA), '2026-10-14');  // 01:59 del jueves
  assert.equal(jornadaDe('2026-10-15T08:59:00Z', BA), '2026-10-14');  // 05:59
  assert.equal(jornadaDe('2026-10-15T09:00:00Z', BA), '2026-10-15');  // 06:00 empieza otra
  assert.deepEqual(rangoDeJornadas('2026-10-14', '2026-10-15', BA), { inicio: '2026-10-14T09:00:00.000Z', fin: '2026-10-16T09:00:00.000Z' });
});

test('arqueo: efectivo esperado = fondo + ventas en efectivo − retiros', () => {
  assert.deepEqual(calcularArqueo({ ventas_efectivo: 10000, fondo_inicial: 5000, retiros: 2000, efectivo_contado: 12500 }), { efectivo_esperado: 13000, diferencia: -500 });
  assert.deepEqual(calcularArqueo({ ventas_efectivo: 0.1 + 0.2, efectivo_contado: 0.3 }), { efectivo_esperado: 0.3, diferencia: 0 });
  assert.equal(calcularArqueo({ ventas_efectivo: 100 }).diferencia, null);
});

test('resumen de ventas: sin ventas no divide por cero; un producto sin costo no inventa margen', () => {
  const vacio = resumirVentas({ cuentas: [], items: [] }, BA);
  assert.deepEqual([vacio.resumen.ventas, vacio.resumen.ticket_promedio, vacio.resumen.margen_pct], [0, 0, null]);
  const r = resumirVentas({
    cuentas: [{ id: 1, canal: 'mesa', medio_pago: 'efectivo', total: 300, cerrado_en: '2026-10-14T23:00:00Z', id_usuario: 1, usuario: 'Ana' }],
    items: [{ id_pedido: 1, id_producto: 9, nombre: 'Agua', categoria: 'Sin alcohol', cantidad: 3, precio_unitario: 100, costo_unitario: null, estado: 'entregado', creado_en: '2026-10-14T22:30:00Z' }],
  }, BA);
  assert.deepEqual([r.resumen.margen_pct, r.resumen.margen_incompleto, r.por_producto[0].margen_pct], [null, true, null]);
  assert.equal(r.por_hora[0].hora, 19);
});

import { aNumero, numeroDe } from '../web/src/fmt.js';

test('números escritos a la argentina: el punto separa miles y la coma los decimales', () => {
  assert.equal(aNumero('5.000'), 5000);
  assert.equal(aNumero('1.500,50'), 1500.5);
  assert.equal(aNumero('1500,5'), 1500.5);
  assert.equal(aNumero('1500.5'), 1500.5);   // estilo inglés con decimales
  assert.equal(aNumero('0.500'), 0.5);       // empieza con cero: es un decimal
  assert.equal(aNumero('1.234.567'), 1234567);
  assert.equal(aNumero('12.5'), 12.5);
  assert.equal(aNumero('abc'), null);
  assert.equal(aNumero(''), null);
  assert.ok(Number.isNaN(numeroDe('1,2,3')) && numeroDe('') === 0 && numeroDe(' 7.000 ') === 7000);
});

import { aBase, costoDeEnvase, desglosar, equivalencia, normalizarPresentaciones, principalDe } from '../src/domain/presentaciones.js';

const BOTELLA = { nombre: 'Botella 750 ml', cantidad: 750, principal: true };

test('presentaciones: de envases a la unidad base y de vuelta', () => {
  assert.equal(aBase(12, { cantidad: 1500 }), 18000);
  assert.equal(aBase(0.5, { cantidad: 750 }), 375);
  assert.deepEqual(desglosar(2250, BOTELLA), { envases: 3, resto: 0 });
  assert.deepEqual(desglosar(2450, BOTELLA), { envases: 3, resto: 200 });
  assert.deepEqual(desglosar(300, BOTELLA), { envases: 0, resto: 300 });
  assert.deepEqual(desglosar(-100, BOTELLA), { envases: 0, resto: -100 }); // stock en negativo: no se parte
  assert.equal(costoDeEnvase(26, BOTELLA), 19500);
});

test('presentaciones: el texto de equivalencia solo aparece cuando hay al menos un envase entero', () => {
  assert.equal(equivalencia(2450, 'ml', [BOTELLA]), '3 × Botella 750 ml + 200 ml');
  assert.equal(equivalencia(1500, 'ml', [BOTELLA]), '2 × Botella 750 ml');
  assert.equal(equivalencia(500, 'ml', [BOTELLA]), null);
  assert.equal(equivalencia(2450, 'ml', []), null);
  assert.equal(equivalencia(50, 'unidad', [{ nombre: 'Caja x 24', cantidad: 24, principal: true }]), '2 × Caja x 24 + 2 u.');
  assert.equal(principalDe([{ nombre: 'A', cantidad: 1 }, { nombre: 'B', cantidad: 2, principal: true }]).nombre, 'B');
  assert.equal(principalDe([{ nombre: 'A', cantidad: 1 }]).nombre, 'A');
});

test('presentaciones: se normalizan los nombres y siempre hay una sola principal', () => {
  const ok = normalizarPresentaciones([{ nombre: ' Botella ', cantidad: 500 }, { nombre: 'Lata', cantidad: 330 }]);
  assert.deepEqual(ok.lista.map((p) => [p.nombre, p.principal]), [['Botella', true], ['Lata', false]]);
  assert.match(normalizarPresentaciones([{ nombre: 'A', cantidad: 1 }, { nombre: 'a', cantidad: 2 }]).error, /repetida/);
  assert.match(normalizarPresentaciones([{ nombre: 'A', cantidad: 1, principal: true }, { nombre: 'B', cantidad: 2, principal: true }]).error, /principal/);
  assert.deepEqual(normalizarPresentaciones([]).lista, []);
});
