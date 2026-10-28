import { config } from '../../config.js';
import { fechaEn } from '../../domain/fechas.js';
import { MEDIOS_PAGO } from '../../domain/pedidos.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { KDS, PEDIDOS } from '../../roles.js';
import * as servicio from './pedidos.servicio.js';

const lineas = v.lista(
  v.objeto({
    id_producto: v.numero({ entero: true, min: 1 }),
    cantidad: v.numero({ entero: true, min: 1, max: 50 }),
    nota: v.texto({ max: 200, opcional: true }),
  }),
  { min: 1, max: 40 },
);
const esquemaCrear = v.objeto({
  canal: v.opcion(['mesa', 'barra']),
  id_mesa: v.numero({ entero: true, min: 1, opcional: true, nulo: true }),
  etiqueta: v.texto({ max: 40, opcional: true }),
  items: lineas,
});
const esquemaAgregar = v.objeto({ items: lineas });
const esquemaCerrar = v.objeto({ medio_pago: v.opcion(MEDIOS_PAGO) });
const esquemaMover = v.objeto({
  id_mesa: v.numero({ entero: true, min: 1 }),
  unir: v.booleano({ opcional: true }),
});
const esquemaMoverItems = v.objeto({
  ids: v.lista(v.numero({ entero: true, min: 1 }), { min: 1, max: 40 }),
  id_pedido: v.numero({ entero: true, min: 1, opcional: true, nulo: true }),
  id_mesa: v.numero({ entero: true, min: 1, opcional: true, nulo: true }),
});
const esquemaEstado = v.objeto({
  ids: v.lista(v.numero({ entero: true, min: 1 }), { min: 1, max: 100 }),
  estado: v.opcion(['pendiente', 'preparando', 'listo', 'entregado']),
});

export default [
  {
    metodo: 'GET', ruta: '/pedidos', roles: PEDIDOS,
    handler: ({ query, ahora }) => servicio.listar(query.estado === 'cerrado' ? 'cerrado' : 'abierto', ahora),
  },
  { metodo: 'GET', ruta: '/pedidos/:id', roles: PEDIDOS, handler: ({ params }) => servicio.obtener(idDe(params.id)) },
  {
    metodo: 'POST', ruta: '/pedidos', roles: PEDIDOS, status: 201,
    handler: ({ body, usuario, ahora }) => servicio.crear(validar(esquemaCrear, body), usuario, ahora),
  },
  {
    metodo: 'POST', ruta: '/pedidos/:id/items', roles: PEDIDOS, status: 201,
    handler: ({ params, body, usuario, ahora }) => servicio.agregar(idDe(params.id), validar(esquemaAgregar, body).items, usuario, ahora),
  },
  {
    metodo: 'POST', ruta: '/pedidos/:id/cerrar', roles: PEDIDOS,
    handler: async ({ params, body, usuario, ahora, auditar }) => {
      const p = await servicio.cerrar(idDe(params.id), validar(esquemaCerrar, body), usuario, ahora);
      auditar({ detalle: { total: p.total, canal: p.canal, mesa: p.mesa ?? null } });
      return p;
    },
  },
  { metodo: 'POST', ruta: '/pedidos/:id/cancelar', roles: PEDIDOS, handler: ({ params, ahora }) => servicio.cancelar(idDe(params.id), ahora) },
  {
    // Pasa la cuenta entera a otra mesa (o la une con la que ya tiene esa mesa)
    metodo: 'POST', ruta: '/pedidos/:id/mover', roles: PEDIDOS,
    handler: async ({ params, body, ahora, auditar }) => {
      const r = await servicio.moverCuenta(idDe(params.id), validar(esquemaMover, body), ahora);
      auditar({ detalle: { desde: r.desde, hacia: r.hacia, unida_a_otra_cuenta: r.unida } });
      return r;
    },
  },
  {
    // Pasa líneas sueltas a otra cuenta o mesa (dividir la cuenta, o corregir una carga en la mesa equivocada)
    metodo: 'POST', ruta: '/pedidos/:id/mover-items', roles: PEDIDOS,
    handler: async ({ params, body, usuario, ahora, auditar }) => {
      const datos = validar(esquemaMoverItems, body);
      datos.ids = [...new Set(datos.ids)].sort((a, b) => a - b);
      const r = await servicio.moverItems(idDe(params.id), datos, usuario, ahora);
      auditar({ detalle: { desde: r.desde, hacia: r.hacia, lineas: r.lineas, origen_cancelada: r.origen_cancelada } });
      return r;
    },
  },
  {
    // Cambia el estado de una o varias líneas. El permiso depende del paso y del destino de cada línea (ver domain/pedidos.js)
    metodo: 'PATCH', ruta: '/pedido-items/estado', roles: [...new Set([...PEDIDOS, ...KDS])],
    handler: ({ body, usuario, ahora }) => {
      const { ids, estado } = validar(esquemaEstado, body);
      return servicio.cambiarEstado([...new Set(ids)].sort((a, b) => a - b), estado, usuario, ahora);
    },
  },
  {
    metodo: 'DELETE', ruta: '/pedido-items/:id', roles: PEDIDOS,
    handler: ({ params, usuario, ahora }) => servicio.anularItem(idDe(params.id), usuario, ahora, fechaEn(config.zonaHoraria, ahora)),
  },
  {
    // Pantalla de cocina/barra. Cada rol ve solo lo suyo; el administrador elige con ?destino=
    metodo: 'GET', ruta: '/kds', roles: KDS,
    handler: ({ query, usuario, ahora }) => {
      const destino = usuario.rol === 'administrador' ? query.destino ?? 'cocina' : usuario.rol;
      if (destino !== 'barra' && destino !== 'cocina') throw new HttpError(400, 'El destino debe ser barra o cocina');
      return servicio.cola(destino, ahora);
    },
  },
];
