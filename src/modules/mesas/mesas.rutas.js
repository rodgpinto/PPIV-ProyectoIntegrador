import { db } from '../../db.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { SALON, SALON_EDITA, SOLO_ADMIN } from '../../roles.js';
import { armarSet } from '../catalogo/util.js';

const COLUMNAS = 'id, nombre, zona, capacidad, estado, estado_desde, activo';
const campos = {
  nombre: v.texto({ min: 1, max: 30 }),
  zona: v.opcion(['interior', 'exterior']),
  capacidad: v.numero({ entero: true, min: 1, max: 100 }),
};
const esquemaCrear = v.objeto(campos);
const esquemaActualizar = v.objeto({ ...campos, activo: v.booleano() }, { parcial: true });
const esquemaEstado = v.objeto({ estado: v.opcion(['libre', 'ocupada']) });

const duplicado = (e) => {
  if (e.code === '23505') throw new HttpError(409, 'Ya existe una mesa con ese nombre');
  throw e;
};

async function listar() {
  const { rows } = await db.query(`SELECT ${COLUMNAS} FROM mesa WHERE activo ORDER BY zona, nombre`);
  const total = rows.reduce((s, m) => s + m.capacidad, 0);
  const ocupado = rows.filter((m) => m.estado === 'ocupada').reduce((s, m) => s + m.capacidad, 0);
  const porZona = (zona) => {
    const ms = rows.filter((m) => m.zona === zona);
    return { mesas: ms.length, libres: ms.filter((m) => m.estado === 'libre').length, lugares_libres: ms.filter((m) => m.estado === 'libre').reduce((s, m) => s + m.capacidad, 0) };
  };
  return {
    mesas: rows,
    resumen: {
      mesas: rows.length,
      libres: rows.filter((m) => m.estado === 'libre').length,
      ocupadas: rows.filter((m) => m.estado === 'ocupada').length,
      aforo: total, lugares_ocupados: ocupado, lugares_libres: total - ocupado,
      interior: porZona('interior'), exterior: porZona('exterior'),
    },
  };
}

export default [
  { metodo: 'GET', ruta: '/mesas', roles: SALON, handler: listar },
  {
    metodo: 'PATCH', ruta: '/mesas/:id/estado', roles: SALON_EDITA,
    async handler({ params, body, ahora }) {
      const { estado } = validar(esquemaEstado, body);
      const id = idDe(params.id);
      const { rows } = await db.query('SELECT estado FROM mesa WHERE id = $1 AND activo', [id]);
      if (!rows[0]) throw new HttpError(404, 'Mesa no encontrada');
      if (estado === 'libre') {
        const { rows: abierta } = await db.query("SELECT id FROM pedido WHERE id_mesa = $1 AND estado = 'abierto'", [id]);
        if (abierta[0]) throw new HttpError(409, 'La mesa tiene una cuenta abierta: cobrala o cancelala primero', { id_pedido: abierta[0].id });
      }
      if (rows[0].estado !== estado) {
        await db.query('UPDATE mesa SET estado = $1, estado_desde = $2 WHERE id = $3', [estado, ahora.toISOString(), id]);
      }
      return (await db.query(`SELECT ${COLUMNAS} FROM mesa WHERE id = $1`, [id])).rows[0];
    },
  },
  {
    metodo: 'POST', ruta: '/mesas', roles: SOLO_ADMIN, status: 201,
    async handler({ body }) {
      const d = validar(esquemaCrear, body);
      try {
        return (await db.query(`INSERT INTO mesa (nombre, zona, capacidad) VALUES ($1, $2, $3) RETURNING ${COLUMNAS}`, [d.nombre, d.zona, d.capacidad])).rows[0];
      } catch (e) { return duplicado(e); }
    },
  },
  {
    metodo: 'PATCH', ruta: '/mesas/:id', roles: SOLO_ADMIN,
    async handler({ params, body }) {
      const { sql, valores, cantidad } = armarSet(validar(esquemaActualizar, body));
      if (!cantidad) throw new HttpError(400, 'No hay nada para actualizar');
      try {
        const { rows } = await db.query(`UPDATE mesa SET ${sql} WHERE id = $${cantidad + 1} RETURNING ${COLUMNAS}`, [...valores, idDe(params.id)]);
        if (!rows[0]) throw new HttpError(404, 'Mesa no encontrada');
        return rows[0];
      } catch (e) { return duplicado(e); }
    },
  },
];
