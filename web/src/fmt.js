// Formatos para pantalla. Todo en hora de Buenos Aires (Argentina no usa horario de verano: UTC-3 fijo).
export const ZONA = 'America/Argentina/Buenos_Aires';

const fPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const fPesosFino = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pesos = (n) => (n === null || n === undefined ? '—' : fPesos.format(n));
export const pesosFino = (n) => (n === null || n === undefined ? '—' : fPesosFino.format(n));
export const numero = (n, dec = 0) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: dec }).format(n));
export const porc = (n) => (n === null || n === undefined ? '—' : `${numero(n, 1)} %`);

export const horas = (min) => {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
};
/** Horas decimales para planillas (7,5). */
export const horasDecimal = (min) => numero(Math.round((min / 60) * 100) / 100, 2);

const fHora = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false });
const fFechaHora = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const hora = (iso) => (iso ? fHora.format(new Date(iso)) : '—');
export const fechaHora = (iso) => (iso ? fFechaHora.format(new Date(iso)).replace(',', '') : '—');
export const fechaCorta = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '—');
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const diaYFecha = (ymd) => {
  const [a, m, d] = ymd.split('-').map(Number);
  return `${DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

export const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
export const sumarDias = (ymd, n) => {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

/** ISO -> valor para <input type="datetime-local"> en hora de Buenos Aires. */
export function aInputLocal(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Valor de <input type="datetime-local"> (hora de Buenos Aires) -> ISO UTC. */
export const deInputLocal = (texto) => (texto ? new Date(`${texto}:00-03:00`).toISOString() : null);

export const minutosDesde = (iso, ahora = Date.now()) => Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000));

export const ROLES = { administrador: 'Administrador', cajero: 'Cajero', barra: 'Barra', camarero: 'Camarero', host: 'Host', cocina: 'Cocina' };
export const LISTA_ROLES = Object.keys(ROLES);
export const TURNOS = { produccion: 'Producción', servicio: 'Servicio (cocina y atención)' };
export const UNIDADES = { ml: 'ml', g: 'g', unidad: 'u.' };
export const MOTIVOS = { vencido: 'Vencido', devolucion: 'Devolución al proveedor', se_cayo: 'Se cayó o se rompió', consumo_interno: 'Consumo interno' };

/** Noche comercial en curso ('AAAA-MM-DD'): va de las 06:00 a las 06:00, así que a la 01:00 sigue siendo la de ayer. */
export const jornadaActual = (ahora = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(ahora - 6 * 3600_000));
export const MEDIOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercado_pago: 'Mercado Pago', transferencia: 'Transferencia' };
export const CANALES = { mesa: 'Mesas', barra: 'Barra' };
/**
 * Texto escrito por una persona -> número, al estilo argentino: '1.500,50' = 1500,5 y '5.000' = 5000 (el punto separa miles).
 * Un punto con otra cantidad de cifras ('1.5', '0.500') se toma como decimal. null si no es un número.
 */
export function aNumero(texto) {
  const t = String(texto ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  const miles = /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t);
  const limpio = /,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : miles ? t.replace(/\./g, '') : t;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}
/** Como aNumero pero para formularios: vacío cuenta como 0 y un texto inválido da NaN (para que lo marque la validación). */
export const numeroDe = (texto) => (String(texto ?? '').trim() === '' ? 0 : aNumero(texto) ?? NaN);
