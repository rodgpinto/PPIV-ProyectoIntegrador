// Reglas puras de ventas y caja (sin base ni reloj: se prueban solas y las usa también la interfaz).
import { fechaEn, inicioDeDia, sumarDias } from './fechas.js';

export const MEDIOS = ['efectivo', 'tarjeta', 'mercado_pago', 'transferencia'];
/** La jornada comercial empieza a esta hora: lo vendido a la 01:30 pertenece a la noche anterior. */
export const HORA_INICIO_JORNADA = 6;

const redondear = (n) => Math.round(n * 100) / 100;
const MS_HORA = 3_600_000;

/** Jornada ('AAAA-MM-DD') a la que pertenece un instante. */
export const jornadaDe = (instante, zona, horaInicio = HORA_INICIO_JORNADA) =>
  fechaEn(zona, new Date(new Date(instante).getTime() - horaInicio * MS_HORA));

/** Instantes [inicio, fin) que cubren las jornadas desde..hasta (ambas incluidas). */
export function rangoDeJornadas(desde, hasta, zona, horaInicio = HORA_INICIO_JORNADA) {
  return {
    inicio: new Date(inicioDeDia(desde, zona).getTime() + horaInicio * MS_HORA).toISOString(),
    fin: new Date(inicioDeDia(sumarDias(hasta, 1), zona).getTime() + horaInicio * MS_HORA).toISOString(),
  };
}

/** Hora local (0-23) de un instante. */
export const horaLocal = (instante, zona) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: zona, hour: '2-digit', hourCycle: 'h23' }).format(new Date(instante)));

function acumular(mapa, clave, inicial, sumar) {
  let o = mapa.get(clave);
  if (!o) { o = { ...inicial }; mapa.set(clave, o); }
  sumar(o);
  return o;
}

const conMargen = (o) => {
  const margen = redondear(o.ventas_con_costo - o.costo);
  return { ...o, margen, margen_pct: o.ventas_con_costo > 0 ? redondear((margen / o.ventas_con_costo) * 100) : null };
};

/**
 * Resume las ventas de un período.
 * cuentas: pedidos cobrados [{id, canal, medio_pago, total, cerrado_en, id_usuario, usuario}]
 * items: líneas de esas cuentas [{id_pedido, id_producto, nombre, categoria, cantidad, precio_unitario, costo_unitario, estado, creado_en}]
 * anuladas: líneas anuladas de cuentas cobradas o canceladas (para control).
 */
export function resumirVentas({ cuentas, items }, zona, horaInicio = HORA_INICIO_JORNADA) {
  const porId = new Map(cuentas.map((c) => [c.id, c]));
  const vivos = items.filter((i) => i.estado !== 'anulado' && porId.has(i.id_pedido));
  const anulados = items.filter((i) => i.estado === 'anulado' && porId.has(i.id_pedido));

  const ventas = redondear(cuentas.reduce((s, c) => s + c.total, 0));
  const sinCosto = vivos.filter((i) => i.costo_unitario == null);
  const conCosto = vivos.filter((i) => i.costo_unitario != null);
  const costo = redondear(conCosto.reduce((s, i) => s + i.costo_unitario * i.cantidad, 0));
  const ventasConCosto = redondear(conCosto.reduce((s, i) => s + i.precio_unitario * i.cantidad, 0));

  const grupo = (_nombre, extraer) => {
    const m = new Map();
    for (const c of cuentas) acumular(m, extraer(c), { cuentas: 0, ventas: 0 }, (o) => { o.cuentas += 1; o.ventas = redondear(o.ventas + c.total); });
    return m;
  };
  const porCanal = [...grupo('canal', (c) => c.canal)].map(([canal, o]) => ({ canal, ...o })).sort((a, b) => b.ventas - a.ventas);
  const medios = grupo('medio', (c) => c.medio_pago);
  const porMedio = MEDIOS.map((medio) => ({ medio_pago: medio, cuentas: medios.get(medio)?.cuentas ?? 0, ventas: medios.get(medio)?.ventas ?? 0 }));
  const porUsuario = [...(() => {
    const m = new Map();
    for (const c of cuentas) acumular(m, c.id_usuario, { id_usuario: c.id_usuario, nombre: c.usuario ?? '—', cuentas: 0, ventas: 0 }, (o) => { o.cuentas += 1; o.ventas = redondear(o.ventas + c.total); });
    return m;
  })().values()].sort((a, b) => b.ventas - a.ventas);

  const jornadas = new Map();
  for (const c of cuentas) {
    acumular(jornadas, jornadaDe(c.cerrado_en, zona, horaInicio), { cuentas: 0, ventas: 0 }, (o) => { o.cuentas += 1; o.ventas = redondear(o.ventas + c.total); });
  }
  const porJornada = [...jornadas].map(([fecha, o]) => ({ fecha, ...o, ticket_promedio: redondear(o.ventas / o.cuentas) })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const horas = new Map();
  for (const i of vivos) {
    acumular(horas, horaLocal(i.creado_en, zona), { unidades: 0, ventas: 0 }, (o) => { o.unidades += i.cantidad; o.ventas = redondear(o.ventas + i.precio_unitario * i.cantidad); });
  }
  // Se ordenan en el orden de la jornada: 19, 20, … 23, 0, 1, 2
  const porHora = [...horas].map(([hora, o]) => ({ hora, ...o })).sort((a, b) => ((a.hora - horaInicio + 24) % 24) - ((b.hora - horaInicio + 24) % 24));

  const productos = new Map();
  const categorias = new Map();
  for (const i of vivos) {
    const venta = i.precio_unitario * i.cantidad;
    const tiene = i.costo_unitario != null;
    const sumar = (o) => {
      o.unidades += i.cantidad; o.ventas = redondear(o.ventas + venta);
      if (tiene) { o.costo = redondear(o.costo + i.costo_unitario * i.cantidad); o.ventas_con_costo = redondear(o.ventas_con_costo + venta); } else o.sin_costo = true;
    };
    const base = { unidades: 0, ventas: 0, costo: 0, ventas_con_costo: 0, sin_costo: false };
    acumular(productos, i.id_producto, { id_producto: i.id_producto, nombre: i.nombre, categoria: i.categoria ?? '', ...base }, sumar);
    acumular(categorias, i.categoria || 'Sin categoría', { categoria: i.categoria || 'Sin categoría', ...base }, sumar);
  }
  const finalizar = (m) => [...m.values()].map(conMargen).sort((a, b) => b.ventas - a.ventas).map(({ ventas_con_costo, ...r }) => r);

  const unidades = vivos.reduce((s, i) => s + i.cantidad, 0);
  const res = conMargen({ ventas, costo, ventas_con_costo: ventasConCosto });
  return {
    resumen: {
      ventas, cuentas: cuentas.length, ticket_promedio: cuentas.length ? redondear(ventas / cuentas.length) : 0, unidades,
      costo, margen: res.margen, margen_pct: res.margen_pct,
      margen_incompleto: sinCosto.length > 0, lineas_sin_costo: sinCosto.length,
      anulado: { lineas: anulados.length, monto: redondear(anulados.reduce((s, i) => s + i.precio_unitario * i.cantidad, 0)) },
    },
    por_canal: porCanal, por_medio: porMedio, por_jornada: porJornada, por_hora: porHora,
    por_producto: finalizar(productos), por_categoria: finalizar(categorias), por_usuario: porUsuario,
  };
}

/** Efectivo que debería haber en la caja y diferencia contra lo contado. */
export function calcularArqueo({ ventas_efectivo, fondo_inicial = 0, retiros = 0, efectivo_contado = null }) {
  const esperado = redondear(fondo_inicial + ventas_efectivo - retiros);
  return { efectivo_esperado: esperado, diferencia: efectivo_contado == null ? null : redondear(efectivo_contado - esperado) };
}
