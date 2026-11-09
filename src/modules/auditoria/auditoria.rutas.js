import { esFecha, inicioDeDia, sumarDias } from '../../domain/fechas.js';
import { config } from '../../config.js';
import { HttpError } from '../../http/errores.js';
import { SOLO_ADMIN } from '../../roles.js';
import { ACCIONES } from '../../domain/auditoria.js';
import * as servicio from './auditoria.servicio.js';

const aFecha = (texto, nombre) => {
  if (!texto) return undefined;
  if (!esFecha(texto)) throw new HttpError(400, `${nombre} debe ser una fecha AAAA-MM-DD`);
  return texto;
};

export default [
  {
    metodo: 'GET', ruta: '/auditoria', roles: SOLO_ADMIN,
    handler: async ({ query }) => {
      const desde = aFecha(query.desde, 'desde');
      const hasta = aFecha(query.hasta, 'hasta');
      const resultado = ['ok', 'denegado', 'fallido'].includes(query.resultado) ? query.resultado : undefined;
      const datos = await servicio.listar({
        desde: desde ? inicioDeDia(desde, config.zonaHoraria).toISOString() : undefined,
        hasta: hasta ? inicioDeDia(sumarDias(hasta, 1), config.zonaHoraria).toISOString() : undefined,
        accion: query.accion || undefined,
        id_usuario: Number(query.id_usuario) || undefined,
        resultado,
        texto: query.texto?.trim().slice(0, 60) || undefined,
        limite: query.limite,
        antes_de_id: Number(query.antes_de_id) || undefined,
      });
      return { ...datos, acciones: ACCIONES };
    },
  },
];
