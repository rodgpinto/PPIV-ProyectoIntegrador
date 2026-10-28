import { db } from '../../db.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { SOLO_ADMIN } from '../../roles.js';
import { armarSet } from './util.js';

const COLUMNAS = 'id, nombre, contacto, telefono, notas, activo';
const campos = {
  nombre: v.texto({ min: 1, max: 100 }),
  contacto: v.texto({ max: 100, opcional: true }),
  telefono: v.texto({ max: 40, opcional: true }),
  notas: v.texto({ max: 300, opcional: true }),
};
const esquemaCrear = v.objeto(campos);
const esquemaActualizar = v.objeto({ ...campos, activo: v.booleano() }, { parcial: true });

const duplicado = (e) => {
  if (e.code === '23505') throw new HttpError(409, 'Ya existe un proveedor con ese nombre');
  throw e;
};

export default [
  {
    metodo: 'GET', ruta: '/proveedores', roles: SOLO_ADMIN,
    handler: async ({ query }) => (await db.query(`SELECT ${COLUMNAS} FROM proveedor ${query.incluir_inactivos === 'true' ? '' : 'WHERE activo'} ORDER BY nombre`)).rows,
  },
  {
    metodo: 'POST', ruta: '/proveedores', roles: SOLO_ADMIN, status: 201,
    async handler({ body }) {
      const d = { contacto: '', telefono: '', notas: '', ...validar(esquemaCrear, body) };
      try {
        return (await db.query(`INSERT INTO proveedor (nombre, contacto, telefono, notas) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS}`, [d.nombre, d.contacto, d.telefono, d.notas])).rows[0];
      } catch (e) { return duplicado(e); }
    },
  },
  {
    metodo: 'PATCH', ruta: '/proveedores/:id', roles: SOLO_ADMIN,
    async handler({ params, body }) {
      const { sql, valores, cantidad } = armarSet(validar(esquemaActualizar, body));
      if (!cantidad) throw new HttpError(400, 'No hay nada para actualizar');
      try {
        const { rows } = await db.query(`UPDATE proveedor SET ${sql} WHERE id = $${cantidad + 1} RETURNING ${COLUMNAS}`, [...valores, idDe(params.id)]);
        if (!rows[0]) throw new HttpError(404, 'Proveedor no encontrado');
        return rows[0];
      } catch (e) { return duplicado(e); }
    },
  },
];
