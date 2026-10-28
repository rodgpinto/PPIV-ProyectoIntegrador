import { config } from '../../config.js';
import { fechaEn } from '../../domain/fechas.js';
import { idDe, v, validar } from '../../http/validar.js';
import { MERMAS, SOLO_ADMIN } from '../../roles.js';
import * as servicio from './stock.servicio.js';

const id = v.numero({ entero: true, min: 1 });
const cant = v.numero({ minExclusivo: 0, max: 1_000_000_000 });

const esquemaIngreso = v.objeto({
  id_insumo: id,
  cantidad: cant,
  costo_total: v.numero({ min: 0, max: 1_000_000_000_000, opcional: true }),
  costo_unitario: v.numero({ min: 0, max: 100_000_000, opcional: true }),
  id_proveedor: v.numero({ entero: true, min: 1, nulo: true }),
  fecha_ingreso: v.fecha({ opcional: true }),
  fecha_vencimiento: v.fecha({ nulo: true }),
  nota: v.texto({ max: 300, opcional: true }),
});
const esquemaMerma = v.objeto({
  id_insumo: id,
  cantidad: cant,
  motivo: v.opcion(['vencido', 'devolucion', 'se_cayo', 'consumo_interno']),
  id_lote: v.numero({ entero: true, min: 1, nulo: true }),
  nota: v.texto({ max: 300, opcional: true }),
});
const esquemaAjuste = v.objeto({
  id_insumo: id,
  cantidad_real: v.numero({ min: 0, max: 1_000_000_000 }),
  nota: v.texto({ max: 300, opcional: true }),
});

const hoy = (ahora) => fechaEn(config.zonaHoraria, ahora);

export default [
  {
    metodo: 'POST', ruta: '/stock/ingresos', roles: SOLO_ADMIN, status: 201,
    handler: ({ body, usuario, ahora }) => servicio.registrarIngreso(validar(esquemaIngreso, body), usuario, hoy(ahora)),
  },
  {
    metodo: 'POST', ruta: '/stock/mermas', roles: MERMAS, status: 201,
    handler: ({ body, usuario }) => servicio.registrarMerma(validar(esquemaMerma, body), usuario),
  },
  {
    metodo: 'POST', ruta: '/stock/ajustes', roles: SOLO_ADMIN, status: 201,
    handler: async ({ body, usuario, ahora, auditar }) => {
      const r = await servicio.registrarAjuste(validar(esquemaAjuste, body), usuario, hoy(ahora));
      auditar({ detalle: { diferencia: r.diferencia, stock_nuevo: r.stock_actual } });
      return r;
    },
  },
  { metodo: 'GET', ruta: '/stock/alertas', roles: SOLO_ADMIN, handler: ({ ahora }) => servicio.alertas(hoy(ahora)) },
  {
    metodo: 'GET', ruta: '/stock/lotes', roles: SOLO_ADMIN,
    handler: ({ query }) => servicio.lotes(query.id_insumo ? idDe(query.id_insumo) : null),
  },
  {
    metodo: 'GET', ruta: '/stock/movimientos', roles: SOLO_ADMIN,
    handler: ({ query }) => servicio.movimientos({ idInsumo: query.id_insumo ? idDe(query.id_insumo) : null, limite: Math.min(Number(query.limite) || 100, 500) }),
  },
];
