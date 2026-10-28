import { Descarga } from '../../http/descarga.js';
import { SOLO_ADMIN } from '../../roles.js';
import * as servicio from './respaldo.servicio.js';

export default [
  { metodo: 'GET', ruta: '/respaldos', roles: SOLO_ADMIN, handler: ({ ahora }) => servicio.estado(ahora) },
  {
    // Crea una copia ahora mismo (además de las automáticas)
    metodo: 'POST', ruta: '/respaldos', roles: SOLO_ADMIN, status: 201,
    handler: async ({ ahora, auditar }) => {
      const copia = await servicio.crearRespaldo({ ahora });
      servicio.depurar();
      auditar({ id_entidad: copia.nombre, sinCuerpo: true, detalle: { bytes: copia.bytes } });
      return copia;
    },
  },
  {
    metodo: 'GET', ruta: '/respaldos/:nombre', roles: SOLO_ADMIN, auditar: true,
    handler: ({ params }) => new Descarga(params.nombre, servicio.leerArchivo(params.nombre), 'application/gzip'),
  },
];
