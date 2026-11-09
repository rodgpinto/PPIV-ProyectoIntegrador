import { diasEntre, esFecha, sumarDias } from '../../domain/fechas.js';
import { HttpError } from '../../http/errores.js';
import { SOLO_ADMIN } from '../../roles.js';
import { jornadaActual } from '../ventas/ventas.servicio.js';
import * as servicio from './informes.servicio.js';

/** Lee desde/hasta de la consulta; por defecto las últimas 7 noches (la actual incluida). */
function periodo(query, ahora, sufijo = '') {
  const hasta = query[`hasta${sufijo}`] ?? (sufijo ? undefined : jornadaActual(ahora));
  const desde = query[`desde${sufijo}`] ?? (sufijo ? undefined : sumarDias(hasta, -6));
  if (!desde || !hasta) return null;
  if (!esFecha(desde) || !esFecha(hasta)) throw new HttpError(400, 'Las fechas deben tener formato AAAA-MM-DD');
  if (desde > hasta) throw new HttpError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  if (diasEntre(desde, hasta) > 365) throw new HttpError(400, 'El período no puede superar un año');
  return { desde, hasta };
}

const entero = (texto, defecto, min, max) => {
  if (texto === undefined || texto === '') return defecto;
  const n = Number(texto);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `El valor debe ser un entero entre ${min} y ${max}`);
  return n;
};

export default [
  {
    metodo: 'GET', ruta: '/informes/rentabilidad', roles: SOLO_ADMIN,
    handler: ({ query, ahora }) => { const p = periodo(query, ahora); return servicio.rentabilidadDe(p.desde, p.hasta); },
  },
  {
    metodo: 'GET', ruta: '/informes/comparar', roles: SOLO_ADMIN,
    handler: ({ query, ahora }) => {
      const actual = periodo(query, ahora);
      const previo = periodo(query, ahora, '_ant') ?? servicio.periodoAnterior(actual.desde, actual.hasta);
      if (previo.hasta >= actual.desde && previo.desde <= actual.hasta) throw new HttpError(400, 'Los dos períodos no pueden superponerse');
      return servicio.comparar(actual, previo);
    },
  },
  {
    metodo: 'GET', ruta: '/informes/consumo', roles: SOLO_ADMIN,
    handler: ({ query, ahora }) => { const p = periodo(query, ahora); return servicio.consumo(p.desde, p.hasta); },
  },
  {
    metodo: 'GET', ruta: '/informes/stock', roles: SOLO_ADMIN,
    handler: ({ query, ahora }) => { const p = periodo(query, ahora); return servicio.stockYMermas(p.desde, p.hasta); },
  },
  {
    metodo: 'GET', ruta: '/informes/compras', roles: SOLO_ADMIN,
    handler: ({ query, ahora }) => servicio.compras({ dias: entero(query.dias, 14, 3, 90), diasCobertura: entero(query.cobertura, 7, 1, 60) }, ahora),
  },
];
