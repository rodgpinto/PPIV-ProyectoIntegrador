import { esFecha, diasEntre, sumarDias } from '../../domain/fechas.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { CAJA, SOLO_ADMIN } from '../../roles.js';
import * as servicio from './ventas.servicio.js';

const monto = v.numero({ min: 0, max: 99_999_999 });
const esquemaCierre = v.objeto({
  fecha: v.fecha({ opcional: true }),
  canal: v.opcion(['mesa', 'barra', 'todos'], { opcional: true }),
  fondo_inicial: v.numero({ min: 0, max: 99_999_999, opcional: true }),
  retiros: v.numero({ min: 0, max: 99_999_999, opcional: true }),
  efectivo_contado: monto,
  nota: v.texto({ max: 300, opcional: true }),
});

/** Período pedido en la consulta; por defecto, las últimas 7 jornadas (incluida la actual). */
function periodo(query, ahora) {
  const hasta = query.hasta ?? servicio.jornadaActual(ahora);
  const desde = query.desde ?? sumarDias(hasta, -6);
  if (!esFecha(desde) || !esFecha(hasta)) throw new HttpError(400, 'Las fechas deben tener formato AAAA-MM-DD');
  if (desde > hasta) throw new HttpError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  if (diasEntre(desde, hasta) > 365) throw new HttpError(400, 'El período no puede superar un año');
  return { desde, hasta };
}

export default [
  {
    metodo: 'GET', ruta: '/reportes/ventas', roles: SOLO_ADMIN,
    handler: ({ query, ahora }) => { const { desde, hasta } = periodo(query, ahora); return servicio.reporte(desde, hasta); },
  },
  {
    metodo: 'GET', ruta: '/caja/jornada', roles: CAJA,
    handler: ({ query, ahora }) => {
      const fecha = query.fecha ?? servicio.jornadaActual(ahora);
      if (!esFecha(fecha)) throw new HttpError(400, 'La fecha debe tener formato AAAA-MM-DD');
      return servicio.jornada(fecha, ahora);
    },
  },
  { metodo: 'GET', ruta: '/caja/cierres', roles: CAJA, handler: () => servicio.cierres({ limite: 60 }) },
  {
    metodo: 'POST', ruta: '/caja/cierres', roles: CAJA, status: 201,
    handler: ({ body, usuario, ahora }) => {
      const d = validar(esquemaCierre, body);
      return servicio.cerrarCaja({ ...d, fecha: d.fecha ?? servicio.jornadaActual(ahora) }, usuario, ahora);
    },
  },
  { metodo: 'DELETE', ruta: '/caja/cierres/:id', roles: SOLO_ADMIN, handler: ({ params }) => servicio.reabrirCaja(idDe(params.id)) },
];
