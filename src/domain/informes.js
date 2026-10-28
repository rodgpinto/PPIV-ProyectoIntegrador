// Informes para el dueño. Todo son funciones puras (sin base ni reloj): se prueban solas con datos chicos a mano.
import { principalDe } from './presentaciones.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const pct = (parte, total) => (total > 0 ? r2((parte / total) * 100) : null);

/* ---------------------------------------------------------------------------------------------------------------------
 * 1) Consumo real vs. teórico
 *    Teórico = lo que las recetas dicen que se gastó con lo vendido (ventas menos lo devuelto por anulaciones).
 *    Real    = teórico + lo registrado como merma + lo que el conteo físico encontró de menos (o de más).
 *    La diferencia es lo que se fue sin ser vendido. Se mide en la unidad del insumo y en pesos.
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * movimientos: [{ id_insumo, tipo, motivo, costo_unitario, cantidad }] ya sumados por (insumo, tipo, motivo, costo).
 * insumos: [{ id, nombre, unidad, costo_unitario }]
 */
export function consumoRealVsTeorico(movimientos, insumos) {
  const porInsumo = new Map(insumos.map((i) => [i.id, i]));
  const filas = new Map();
  const fila = (id) => {
    if (!filas.has(id)) {
      const i = porInsumo.get(id);
      filas.set(id, {
        id_insumo: id, nombre: i?.nombre ?? `Insumo ${id}`, unidad: i?.unidad ?? '', teorico: 0, merma: 0, conteo: 0,
        valor_teorico: 0, valor_merma: 0, valor_conteo: 0, sin_costo: false,
      });
    }
    return filas.get(id);
  };
  for (const m of movimientos) {
    if (!['venta', 'reversion', 'merma', 'ajuste'].includes(m.tipo)) continue;
    const f = fila(m.id_insumo);
    const costo = m.costo_unitario ?? porInsumo.get(m.id_insumo)?.costo_unitario ?? 0;
    if (!(costo > 0)) f.sin_costo = true;
    const perdida = -m.cantidad; // positivo = salió stock
    if (m.tipo === 'venta' || m.tipo === 'reversion') { f.teorico += perdida; f.valor_teorico += perdida * costo; }
    else if (m.tipo === 'merma') { f.merma += perdida; f.valor_merma += perdida * costo; }
    else { f.conteo += perdida; f.valor_conteo += perdida * costo; }
  }
  const salida = [...filas.values()].map((f) => {
    const real = f.teorico + f.merma + f.conteo;
    const diferencia = f.merma + f.conteo;
    const valor_diferencia = f.valor_merma + f.valor_conteo;
    return {
      ...f, teorico: r3(f.teorico), merma: r3(f.merma), conteo: r3(f.conteo), real: r3(real), diferencia: r3(diferencia),
      diferencia_pct: f.teorico > 0 ? r2((diferencia / f.teorico) * 100) : null,
      valor_teorico: r2(f.valor_teorico), valor_merma: r2(f.valor_merma), valor_conteo: r2(f.valor_conteo),
      valor_real: r2(f.valor_teorico + f.valor_merma + f.valor_conteo), valor_diferencia: r2(valor_diferencia),
    };
  }).sort((a, b) => b.valor_diferencia - a.valor_diferencia || a.nombre.localeCompare(b.nombre, 'es'));
  const suma = (campo) => r2(salida.reduce((s, f) => s + f[campo], 0));
  return {
    filas: salida,
    resumen: {
      valor_teorico: suma('valor_teorico'), valor_merma: suma('valor_merma'), valor_conteo: suma('valor_conteo'),
      valor_real: suma('valor_real'), valor_diferencia: suma('valor_diferencia'),
      diferencia_pct: suma('valor_teorico') > 0 ? r2((suma('valor_diferencia') / suma('valor_teorico')) * 100) : null,
      insumos_sin_costo: salida.filter((f) => f.sin_costo).length,
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * 2) Stock valorizado y mermas en pesos
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Cuánto vale hoy lo que hay en el depósito. Se valoriza lote por lote (a lo que costó cada compra); si algún insumo tiene stock
 * sin lotes que lo respalden, ese tramo se valoriza al último costo. El stock negativo (ventas sin ingreso cargado) no suma:
 * se informa aparte como faltante de carga.
 * insumos: [{ id, nombre, unidad, costo_unitario, stock_actual }]   lotes: [{ id_insumo, cantidad_actual, costo_unitario }]
 */
export function valorizarStock(insumos, lotes) {
  const lotesDe = new Map();
  for (const l of lotes) lotesDe.set(l.id_insumo, [...(lotesDe.get(l.id_insumo) ?? []), l]);
  let total = 0;
  const filas = [];
  const negativos = [];
  for (const i of insumos) {
    if (i.stock_actual < 0) { negativos.push({ id_insumo: i.id, nombre: i.nombre, unidad: i.unidad, stock_actual: i.stock_actual }); continue; }
    if (!(i.stock_actual > 0)) continue;
    const mios = lotesDe.get(i.id) ?? [];
    const enLotes = mios.reduce((s, l) => s + l.cantidad_actual, 0);
    const valorLotes = mios.reduce((s, l) => s + l.cantidad_actual * (l.costo_unitario > 0 ? l.costo_unitario : i.costo_unitario), 0);
    const suelto = Math.max(0, i.stock_actual - enLotes);
    const valor = r2(valorLotes + suelto * i.costo_unitario);
    total += valor;
    filas.push({ id_insumo: i.id, nombre: i.nombre, unidad: i.unidad, stock_actual: i.stock_actual, costo_unitario: i.costo_unitario, valor, sin_costo: !(i.costo_unitario > 0) && valorLotes === 0 });
  }
  filas.sort((a, b) => b.valor - a.valor);
  let acumulado = 0;
  for (const f of filas) { acumulado += f.valor; f.participacion_pct = pct(f.valor, total); f.acumulado_pct = pct(acumulado, total); }
  return { total: r2(total), filas, sin_costo: filas.filter((f) => f.sin_costo).length, negativos };
}

/**
 * Mermas del período en pesos, por motivo y por insumo.
 * movimientos: [{ id_insumo, motivo, costo_unitario, cantidad }] (solo tipo merma)
 */
export function resumenMermas(movimientos, insumos, ventasTotal = 0) {
  const porInsumo = new Map(insumos.map((i) => [i.id, i]));
  const motivos = new Map();
  const insumosMap = new Map();
  let total = 0;
  for (const m of movimientos) {
    const i = porInsumo.get(m.id_insumo);
    const costo = m.costo_unitario ?? i?.costo_unitario ?? 0;
    const cant = -m.cantidad;
    const valor = cant * costo;
    total += valor;
    const mo = motivos.get(m.motivo ?? 'sin_motivo') ?? { motivo: m.motivo ?? 'sin_motivo', valor: 0, movimientos: 0 };
    mo.valor += valor; mo.movimientos += 1; motivos.set(mo.motivo, mo);
    const ins = insumosMap.get(m.id_insumo) ?? { id_insumo: m.id_insumo, nombre: i?.nombre ?? `Insumo ${m.id_insumo}`, unidad: i?.unidad ?? '', cantidad: 0, valor: 0 };
    ins.cantidad += cant; ins.valor += valor; insumosMap.set(m.id_insumo, ins);
  }
  const lista = (mapa) => [...mapa.values()].map((x) => ({ ...x, valor: r2(x.valor), ...(x.cantidad !== undefined ? { cantidad: r3(x.cantidad) } : {}), participacion_pct: pct(x.valor, total) })).sort((a, b) => b.valor - a.valor);
  return { total: r2(total), pct_de_ventas: pct(total, ventasTotal), por_motivo: lista(motivos), por_insumo: lista(insumosMap) };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * 3) Lista de compra sugerida
 * ------------------------------------------------------------------------------------------------------------------ */

/**
 * Qué comprar y a quién. Un insumo entra en la lista si está en o por debajo de su mínimo, o si al ritmo de consumo reciente
 * le queda stock para menos de `diasAviso` días. Se pide hasta el máximo cargado (o, si no hay, lo que cubra `diasCobertura`
 * días o el doble del mínimo) y se redondea hacia arriba a envases enteros cuando el insumo tiene presentación.
 *
 * insumos: [{ id, nombre, unidad, stock_actual, stock_minimo, stock_maximo, costo_unitario, id_proveedor, presentaciones }]
 * consumos: Map o objeto id_insumo -> cantidad consumida en la ventana     proveedores: [{ id, nombre, contacto, telefono }]
 */
export function comprasSugeridas({ insumos, consumos, proveedores, dias = 14, diasCobertura = 7, diasAviso = 3 }) {
  const consumo = (id) => (consumos instanceof Map ? consumos.get(id) : consumos?.[id]) ?? 0;
  const items = [];
  for (const i of insumos) {
    const diario = consumo(i.id) / dias;
    if (!(i.stock_minimo > 0) && !(diario > 0)) continue;
    const diasDeStock = diario > 0 ? Math.max(i.stock_actual, 0) / diario : null;
    const bajoMinimo = i.stock_minimo > 0 && i.stock_actual <= i.stock_minimo;
    const porAgotarse = diasDeStock !== null && diasDeStock < diasAviso;
    if (!bajoMinimo && !porAgotarse) continue;
    const objetivo = Math.max(i.stock_maximo ?? Math.max(i.stock_minimo * 2, diario * diasCobertura), i.stock_minimo);
    const faltante = objetivo - i.stock_actual;
    if (!(faltante > 0)) continue;
    const p = principalDe(i.presentaciones ?? []);
    const envases = p ? Math.ceil(r3(faltante / p.cantidad)) : null;
    const sugerida = r3(p ? envases * p.cantidad : faltante);
    items.push({
      id_insumo: i.id, nombre: i.nombre, unidad: i.unidad, id_proveedor: i.id_proveedor ?? null,
      stock_actual: i.stock_actual, stock_minimo: i.stock_minimo, consumo_diario: r3(diario),
      dias_de_stock: diasDeStock === null ? null : r2(diasDeStock),
      motivo: i.stock_actual <= 0 ? 'sin_stock' : bajoMinimo ? 'bajo_minimo' : 'se_agota',
      sugerida, presentacion: p ? { nombre: p.nombre, cantidad: p.cantidad, envases } : null,
      costo_unitario: i.costo_unitario, costo_estimado: i.costo_unitario > 0 ? r2(sugerida * i.costo_unitario) : null,
      urgente: i.stock_actual <= 0 || (diasDeStock !== null && diasDeStock < 1),
    });
  }
  const orden = (a, b) => Number(b.urgente) - Number(a.urgente) || a.nombre.localeCompare(b.nombre, 'es');
  const grupos = new Map();
  for (const it of items) {
    const clave = it.id_proveedor ?? 0;
    const prov = proveedores.find((p) => p.id === it.id_proveedor);
    if (!grupos.has(clave)) grupos.set(clave, { id_proveedor: it.id_proveedor, nombre: prov?.nombre ?? 'Sin proveedor asignado', contacto: prov?.contacto ?? '', telefono: prov?.telefono ?? '', items: [] });
    grupos.get(clave).items.push(it);
  }
  const lista = [...grupos.values()].map((g) => ({
    ...g, items: g.items.sort(orden),
    costo_estimado: r2(g.items.reduce((s, x) => s + (x.costo_estimado ?? 0), 0)),
    sin_costo: g.items.filter((x) => x.costo_estimado === null).length,
    urgentes: g.items.filter((x) => x.urgente).length,
  })).sort((a, b) => (a.id_proveedor === null) - (b.id_proveedor === null) || b.urgentes - a.urgentes || a.nombre.localeCompare(b.nombre, 'es'));
  return { proveedores: lista, total_items: items.length, costo_estimado: r2(lista.reduce((s, g) => s + g.costo_estimado, 0)), dias, dias_cobertura: diasCobertura };
}

/** Texto para mandar por WhatsApp a un proveedor. */
export function textoDePedido(grupo, formatoNumero = (n) => String(n)) {
  const lineas = grupo.items.map((it) => {
    const cant = it.presentacion ? `${it.presentacion.envases} × ${it.presentacion.nombre}` : `${formatoNumero(it.sugerida)} ${it.unidad === 'unidad' ? 'u.' : it.unidad}`;
    return `• ${it.nombre}: ${cant}`;
  });
  return `Hola${grupo.contacto ? ` ${grupo.contacto}` : ''}, necesitamos para RADAS:\n${lineas.join('\n')}\n¡Gracias!`;
}

/* ---------------------------------------------------------------------------------------------------------------------
 * 4) Rentabilidad: cuánto aporta cada producto a la ganancia + ingeniería de menú
 * ------------------------------------------------------------------------------------------------------------------ */

export const CLASES_MENU = {
  estrella: 'Estrella: se vende mucho y deja buen margen. Cuidarlo.',
  caballo: 'Caballo de batalla: se vende mucho pero deja poco. Probar subir el precio o bajar el costo.',
  rompecabezas: 'Rompecabezas: deja buen margen pero se vende poco. Mostrarlo, sugerirlo.',
  perro: 'Perro: se vende poco y deja poco. Candidato a sacar de la carta o rehacer.',
};

/**
 * productos: por_producto de resumirVentas ({ id_producto, nombre, categoria, unidades, ventas, costo, margen, margen_pct, sin_costo }).
 * Aporte = parte de la ganancia total (clase A: los que juntan el 80 %; B: hasta el 95 %; C: el resto).
 * Menú (Kasavana y Smith): popularidad contra 70 % de la venta pareja, y margen por unidad contra el promedio ponderado.
 */
export function rentabilidad(productos) {
  const conCosto = productos.filter((p) => !p.sin_costo && p.unidades > 0);
  const margenTotal = conCosto.reduce((s, p) => s + p.margen, 0);
  const unidadesTotal = conCosto.reduce((s, p) => s + p.unidades, 0);
  const umbralPop = conCosto.length ? (0.7 / conCosto.length) * 100 : 0;
  const cmPromedio = unidadesTotal > 0 ? margenTotal / unidadesTotal : 0;

  const ordenados = [...conCosto].sort((a, b) => b.margen - a.margen);
  let acumulado = 0;
  const detalle = new Map();
  for (const p of ordenados) {
    const antes = acumulado;
    acumulado += p.margen;
    const cm = p.margen / p.unidades;
    const popularidad = (p.unidades / unidadesTotal) * 100;
    const popular = popularidad >= umbralPop;
    const rinde = cm >= cmPromedio;
    detalle.set(p.id_producto, {
      aporte_pct: margenTotal > 0 ? r2((p.margen / margenTotal) * 100) : null,
      acumulado_pct: margenTotal > 0 ? r2((acumulado / margenTotal) * 100) : null,
      abc: margenTotal > 0 ? (antes / margenTotal < 0.8 ? 'A' : antes / margenTotal < 0.95 ? 'B' : 'C') : null,
      cm_unitario: r2(cm), popularidad_pct: r2(popularidad),
      clase_menu: popular ? (rinde ? 'estrella' : 'caballo') : (rinde ? 'rompecabezas' : 'perro'),
    });
  }
  const filas = productos
    .map((p) => ({ ...p, ...(detalle.get(p.id_producto) ?? { aporte_pct: null, acumulado_pct: null, abc: null, cm_unitario: null, popularidad_pct: null, clase_menu: null }) }))
    .sort((a, b) => Number(b.clase_menu !== null) - Number(a.clase_menu !== null) || b.margen - a.margen);
  return {
    filas,
    umbrales: { popularidad_pct: r2(umbralPop), cm_promedio: r2(cmPromedio) },
    margen_total: r2(margenTotal),
    sin_costo: productos.filter((p) => p.sin_costo).map((p) => p.nombre),
  };
}

/* ---------------------------------------------------------------------------------------------------------------------
 * 5) Comparar dos períodos
 * ------------------------------------------------------------------------------------------------------------------ */

const variacion = (actual, previo) => ({
  actual, previo, diferencia: r2(actual - previo),
  diferencia_pct: previo > 0 ? r2(((actual - previo) / previo) * 100) : null,
});

/**
 * a y b son resultados de resumirVentas (a = período actual, b = el anterior). Como los períodos pueden tener distinta cantidad
 * de noches, también se compara la venta promedio por noche.
 */
export function compararPeriodos(a, b) {
  const noches = (x) => Math.max(x.por_jornada.length, 1);
  const metrica = (campo) => variacion(a.resumen[campo] ?? 0, b.resumen[campo] ?? 0);
  const unir = (clave, campos) => {
    const mapa = new Map();
    for (const [lado, fuente] of [['actual', a], ['previo', b]]) {
      for (const x of fuente[campos.lista]) {
        const id = x[clave];
        const e = mapa.get(id) ?? { [clave]: id, nombre: x[campos.nombre], actual: { unidades: 0, ventas: 0 }, previo: { unidades: 0, ventas: 0 } };
        e[lado] = { unidades: x.unidades ?? 0, ventas: x.ventas };
        mapa.set(id, e);
      }
    }
    return [...mapa.values()].map((e) => ({
      ...e, diferencia: r2(e.actual.ventas - e.previo.ventas),
      diferencia_pct: e.previo.ventas > 0 ? r2(((e.actual.ventas - e.previo.ventas) / e.previo.ventas) * 100) : null,
      estado: e.previo.ventas === 0 ? 'nuevo' : e.actual.ventas === 0 ? 'sin_ventas' : 'comparable',
    })).sort((x, y) => Math.abs(y.diferencia) - Math.abs(x.diferencia));
  };
  return {
    noches: { actual: a.por_jornada.length, previo: b.por_jornada.length },
    metricas: {
      ventas: metrica('ventas'), cuentas: metrica('cuentas'), ticket_promedio: metrica('ticket_promedio'), unidades: metrica('unidades'),
      margen: metrica('margen'),
      margen_pct: { actual: a.resumen.margen_pct, previo: b.resumen.margen_pct, diferencia: a.resumen.margen_pct !== null && b.resumen.margen_pct !== null ? r2(a.resumen.margen_pct - b.resumen.margen_pct) : null },
      ventas_por_noche: variacion(r2(a.resumen.ventas / noches(a)), r2(b.resumen.ventas / noches(b))),
    },
    productos: unir('id_producto', { lista: 'por_producto', nombre: 'nombre' }),
    categorias: unir('categoria', { lista: 'por_categoria', nombre: 'categoria' }).map((c) => ({ ...c, nombre: c.categoria })),
  };
}
