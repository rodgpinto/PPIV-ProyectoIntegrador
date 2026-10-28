import { idDe, v, validar } from '../../http/validar.js';
import { ROLES, SOLO_ADMIN, TODOS } from '../../roles.js';
import * as servicio from './productos.servicio.js';

const nombre = v.texto({ min: 1, max: 100 });
const precio = v.numero({ min: 0, max: 99_999_999 });
const receta = v.lista(
  v.objeto({ id_insumo: v.numero({ entero: true, min: 1 }), cantidad: v.numero({ minExclusivo: 0, max: 1_000_000 }) }),
  { max: 50, unicoPor: 'id_insumo' },
);
const base = {
  nombre,
  descripcion: v.texto({ max: 500, opcional: true }),
  categoria: v.texto({ min: 1, max: 50 }),
  destino: v.opcion(['barra', 'cocina']),
};

const recetaOpcional = v.lista(
  v.objeto({ id_insumo: v.numero({ entero: true, min: 1 }), cantidad: v.numero({ minExclusivo: 0, max: 1_000_000 }) }),
  { max: 50, unicoPor: 'id_insumo', opcional: true },
);
const esquemaCrear = v.objeto({ ...base, precio, receta: recetaOpcional });
// El precio se cambia solo por los endpoints de precios: un único punto de control.
const esquemaActualizar = v.objeto({ ...base, activo: v.booleano() }, { parcial: true });
const esquemaReceta = v.objeto({ receta });
const esquemaPrecio = v.objeto({ precio });
const esquemaPrecios = v.objeto({
  precios: v.lista(v.objeto({ id: v.numero({ entero: true, min: 1 }), precio }), { min: 1, max: 300, unicoPor: 'id' }),
});
const esquemaAjuste = v.objeto({
  modo: v.opcion(['porcentaje', 'margen']),
  valor: v.numero({ min: -99, max: 1000 }),
  ids: v.lista(v.numero({ entero: true, min: 1 }), { max: 500, opcional: true }),
  categoria: v.texto({ max: 50, opcional: true }),
  aplicar: v.booleano({ opcional: true }),
  paso: v.numero({ minExclusivo: 0, max: 10_000, opcional: true }),
});

export default [
  // Carta pública (RF-14): la consultan los clientes por QR, sin iniciar sesión.
  { metodo: 'GET', ruta: '/carta', publico: true, handler: () => servicio.carta() },

  {
    metodo: 'GET', ruta: '/productos', roles: TODOS,
    handler: ({ usuario, query }) =>
      usuario.rol === ROLES.ADMIN
        ? servicio.listarConCostos({ incluirInactivos: query.incluir_inactivos === 'true' })
        : servicio.listarBasico(),
  },
  { metodo: 'GET', ruta: '/productos/:id', roles: SOLO_ADMIN, handler: ({ params }) => servicio.obtener(idDe(params.id)) },
  { metodo: 'POST', ruta: '/productos', roles: SOLO_ADMIN, status: 201, handler: ({ body }) => servicio.crear(validar(esquemaCrear, body)) },
  { metodo: 'PATCH', ruta: '/productos/:id', roles: SOLO_ADMIN, handler: ({ params, body }) => servicio.actualizar(idDe(params.id), validar(esquemaActualizar, body)) },
  { metodo: 'DELETE', ruta: '/productos/:id', roles: SOLO_ADMIN, handler: ({ params }) => servicio.darDeBaja(idDe(params.id)) },
  { metodo: 'PUT', ruta: '/productos/:id/receta', roles: SOLO_ADMIN, handler: ({ params, body }) => servicio.reemplazarReceta(idDe(params.id), validar(esquemaReceta, body).receta) },

  // Precios (R21): uno, varios, o ajuste masivo por porcentaje / margen
  { metodo: 'PATCH', ruta: '/productos/:id/precio', roles: SOLO_ADMIN, handler: ({ params, body }) => servicio.cambiarPrecio(idDe(params.id), validar(esquemaPrecio, body).precio) },
  { metodo: 'PUT', ruta: '/productos/precios', roles: SOLO_ADMIN, handler: ({ body }) => servicio.actualizarPrecios(validar(esquemaPrecios, body).precios) },
  { metodo: 'POST', ruta: '/productos/ajuste-precios', roles: SOLO_ADMIN, handler: ({ body }) => servicio.ajustarPrecios(validar(esquemaAjuste, body)) },
];
