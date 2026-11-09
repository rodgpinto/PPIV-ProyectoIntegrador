// Reglas puras de pedidos y de la pantalla de cocina (sin base de datos: se prueban solas y las usa también la interfaz).

export const ESTADOS_ACTIVOS = ['pendiente', 'preparando', 'listo'];
export const MEDIOS_PAGO = ['efectivo', 'tarjeta', 'mercado_pago', 'transferencia'];

// Qué estados pueden seguir a cada uno. Se puede deshacer un paso (por si tocaron sin querer).
const SIGUIENTES = {
  pendiente: ['preparando', 'listo'],
  preparando: ['listo', 'pendiente'],
  listo: ['entregado', 'preparando'],
  entregado: [],
  anulado: [],
};
export const transicionValida = (de, a) => SIGUIENTES[de]?.includes(a) ?? false;

const PEDIDOS = ['administrador', 'camarero', 'cajero', 'barra'];

/**
 * Preparar y dejar listo lo hace quien trabaja ese destino (barra → barra, cocina → cocina) y el administrador.
 * Marcar como entregado lo hace quien atiende (camarero, cajero, barra) y el administrador.
 */
export function puedeCambiar({ rol, destino, a }) {
  if (a === 'entregado') return PEDIDOS.includes(rol);
  return rol === 'administrador' || rol === destino;
}

export const totalDe = (items) =>
  Math.round(items.filter((i) => i.estado !== 'anulado').reduce((s, i) => s + i.precio_unitario * i.cantidad, 0) * 100) / 100;

/** Minutos de espera a partir de los cuales una línea pasa a amarillo y a rojo en la pantalla. */
export const UMBRALES_ESPERA = { barra: { aviso: 6, urgente: 12 }, cocina: { aviso: 12, urgente: 20 } };
export function nivelDeEspera(minutos, destino) {
  const u = UMBRALES_ESPERA[destino] ?? UMBRALES_ESPERA.cocina;
  return minutos >= u.urgente ? 'urgente' : minutos >= u.aviso ? 'aviso' : 'normal';
}

/**
 * Agrupa líneas iguales (mismo producto, misma nota y mismo estado) de distintas cuentas, para preparar
 * varias porciones juntas: "4 × Negroni". Los grupos salen del más antiguo al más nuevo.
 */
export function agruparPorProducto(items) {
  const grupos = new Map();
  for (const it of items) {
    const clave = `${it.id_producto}|${it.nota ?? ''}|${it.estado}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, id_producto: it.id_producto, nombre: it.nombre, nota: it.nota ?? '', estado: it.estado, cantidad: 0, desde: it.creado_en, items: [] };
      grupos.set(clave, g);
    }
    g.cantidad += it.cantidad;
    g.items.push(it);
    if (new Date(it.creado_en) < new Date(g.desde)) g.desde = it.creado_en;
  }
  return [...grupos.values()].sort((a, b) => new Date(a.desde) - new Date(b.desde));
}

export const minutosEntre = (desde, hasta) => Math.max(0, Math.floor((new Date(hasta) - new Date(desde)) / 60000));
