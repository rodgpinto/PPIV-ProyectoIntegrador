// Fechas en la zona horaria del local. Todo es función pura (sin acceso a reloj ni a base).

const partes = (zona, instante) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante);

/** 'YYYY-MM-DD' que corresponde al instante en esa zona horaria. */
export function fechaEn(zona, instante = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

/** Diferencia en minutos entre la hora local de la zona y UTC en ese instante (Buenos Aires: -180). */
export function offsetMinutos(zona, instante) {
  const p = partes(zona, instante);
  const g = (tipo) => Number(p.find((x) => x.type === tipo).value);
  const comoUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000);
}

/** Instante (Date) en que empieza el día 'YYYY-MM-DD' en esa zona. */
export function inicioDeDia(fecha, zona) {
  const [a, m, d] = fecha.split('-').map(Number);
  const nominal = Date.UTC(a, m - 1, d);
  const primero = nominal - offsetMinutos(zona, new Date(nominal)) * 60000;
  return new Date(nominal - offsetMinutos(zona, new Date(primero)) * 60000);
}

export function esFecha(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function sumarDias(fecha, n) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Días enteros de `desde` a `hasta` (positivo si hasta es posterior). */
export function diasEntre(desde, hasta) {
  const ms = (f) => { const [a, m, d] = f.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((ms(hasta) - ms(desde)) / 86400000);
}
