import { fechaEn } from './fechas.js';

export const MAX_HORAS_JORNADA = 16; // una jornada abierta por más tiempo se considera olvido de egreso

/** Minutos de un fichaje. Si sigue abierto, cuenta hasta `ahora`. */
export function minutosTrabajados({ ingreso, egreso }, ahora) {
  const fin = egreso ? new Date(egreso) : ahora;
  return Math.max(0, Math.round((fin - new Date(ingreso)) / 60000));
}

export function esOlvidoEgreso(fichaje, ahora) {
  return !fichaje.egreso && minutosTrabajados(fichaje, ahora) > MAX_HORAS_JORNADA * 60;
}

/** "7 h 30 min", "45 min", "0 min". */
export function formatoHoras(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Horas por empleado. Una jornada que cruza la medianoche (19:00 a 02:30) se asigna
 * al día en que empezó, que es como se liquida un turno de noche.
 * fichajes: [{ id_usuario, nombre, rol, turno, ingreso, egreso }]
 */
export function resumirHoras(fichajes, ahora, zona) {
  const porUsuario = new Map();
  for (const f of fichajes) {
    if (!porUsuario.has(f.id_usuario)) {
      porUsuario.set(f.id_usuario, {
        id_usuario: f.id_usuario, nombre: f.nombre, rol: f.rol,
        minutos: 0, jornadas: 0, abiertas: 0,
        por_turno: { produccion: 0, servicio: 0 }, por_dia: {},
      });
    }
    const r = porUsuario.get(f.id_usuario);
    const min = minutosTrabajados(f, ahora);
    const dia = fechaEn(zona, new Date(f.ingreso));
    r.minutos += min;
    r.jornadas += 1;
    if (!f.egreso) r.abiertas += 1;
    r.por_turno[f.turno] = (r.por_turno[f.turno] ?? 0) + min;
    r.por_dia[dia] = (r.por_dia[dia] ?? 0) + min;
  }
  return [...porUsuario.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
