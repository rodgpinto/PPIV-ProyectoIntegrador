import { config } from '../../config.js';
import { db } from '../../db.js';
import { esOlvidoEgreso, minutosTrabajados, resumirHoras } from '../../domain/horas.js';
import { esFecha, fechaEn, inicioDeDia, sumarDias } from '../../domain/fechas.js';
import { HttpError } from '../../http/errores.js';
import { idDe, v, validar } from '../../http/validar.js';
import { SOLO_ADMIN, TODOS } from '../../roles.js';

const zona = config.zonaHoraria;
const TURNOS = ['produccion', 'servicio'];
const COLUMNAS = 'f.id, f.id_usuario, u.nombre, u.rol, f.turno, f.ingreso, f.egreso, f.nota, f.manual';
const DESDE = 'FROM fichaje f JOIN usuario u ON u.id = f.id_usuario';

const esquemaIngreso = v.objeto({ turno: v.opcion(TURNOS) });
const esquemaManual = v.objeto({
  id_usuario: v.numero({ entero: true, min: 1 }),
  turno: v.opcion(TURNOS),
  ingreso: v.fechaHora(),
  egreso: v.fechaHora({ nulo: true }),
  nota: v.texto({ max: 300, opcional: true }),
});
const esquemaEditar = v.objeto({
  turno: v.opcion(TURNOS),
  ingreso: v.fechaHora(),
  egreso: v.fechaHora({ nulo: true }),
  nota: v.texto({ max: 300 }),
}, { parcial: true });
const esquemaCerrar = v.objeto({ egreso: v.fechaHora() });

const decorar = (f, ahora) => ({
  ...f,
  minutos: minutosTrabajados(f, ahora),
  abierto: !f.egreso,
  posible_olvido: esOlvidoEgreso(f, ahora),
});

/** Rango de días locales [desde, hasta] como instantes. Por defecto, los últimos 14 días. */
function rango(query, ahora) {
  const hoy = fechaEn(zona, ahora);
  const hasta = query.hasta ?? hoy;
  const desde = query.desde ?? sumarDias(hasta, -13);
  if (!esFecha(desde) || !esFecha(hasta)) throw new HttpError(400, 'Las fechas deben tener formato AAAA-MM-DD');
  if (desde > hasta) throw new HttpError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  return { desde, hasta, inicio: inicioDeDia(desde, zona).toISOString(), fin: inicioDeDia(sumarDias(hasta, 1), zona).toISOString() };
}

async function fichajesDelRango(query, ahora) {
  const r = rango(query, ahora);
  const params = [r.inicio, r.fin];
  let donde = 'f.ingreso >= $1 AND f.ingreso < $2';
  if (query.id_usuario) { params.push(idDe(query.id_usuario)); donde += ` AND f.id_usuario = $${params.length}`; }
  const { rows } = await db.query(`SELECT ${COLUMNAS} ${DESDE} WHERE ${donde} ORDER BY f.ingreso DESC, f.id DESC`, params);
  return { r, rows };
}

function validarTramo(ingreso, egreso, ahora) {
  if (new Date(ingreso) > new Date(ahora.getTime() + 60_000)) throw new HttpError(400, 'El ingreso no puede ser futuro');
  if (egreso && new Date(egreso) < new Date(ingreso)) throw new HttpError(400, 'El egreso no puede ser anterior al ingreso');
  if (egreso && new Date(egreso) > new Date(ahora.getTime() + 60_000)) throw new HttpError(400, 'El egreso no puede ser futuro');
}

function abiertoDuplicado(e) {
  if (e.code === '23505') throw new HttpError(409, 'Esa persona ya tiene una jornada abierta: hay que cerrarla antes');
  throw e;
}

export default [
  {
    // Cada persona ficha su propio ingreso
    metodo: 'POST', ruta: '/fichajes/ingreso', roles: TODOS, status: 201,
    async handler({ body, usuario, ahora }) {
      const { turno } = validar(esquemaIngreso, body);
      try {
        const { rows } = await db.query(
          'INSERT INTO fichaje (id_usuario, turno, ingreso) VALUES ($1, $2, $3) RETURNING id', [usuario.id, turno, ahora.toISOString()],
        );
        return { id: rows[0].id, turno, ingreso: ahora.toISOString() };
      } catch (e) {
        if (e.code === '23505') throw new HttpError(409, 'Ya tenés una jornada abierta. Registrá primero tu egreso');
        throw e;
      }
    },
  },
  {
    metodo: 'POST', ruta: '/fichajes/egreso', roles: TODOS,
    async handler({ usuario, ahora }) {
      const { rows } = await db.query(
        'UPDATE fichaje SET egreso = $1 WHERE id_usuario = $2 AND egreso IS NULL RETURNING id, turno, ingreso, egreso',
        [ahora.toISOString(), usuario.id],
      );
      if (!rows[0]) throw new HttpError(409, 'No tenés una jornada abierta');
      return { ...rows[0], minutos: minutosTrabajados(rows[0], ahora) };
    },
  },
  {
    // Estado propio: si hay jornada abierta y el historial reciente
    metodo: 'GET', ruta: '/fichajes/mio', roles: TODOS,
    async handler({ usuario, query, ahora }) {
      const { r, rows } = await fichajesDelRango({ ...query, id_usuario: String(usuario.id) }, ahora);
      const abierto = (await db.query(`SELECT ${COLUMNAS} ${DESDE} WHERE f.id_usuario = $1 AND f.egreso IS NULL`, [usuario.id])).rows[0] ?? null;
      const historial = rows.map((f) => decorar(f, ahora));
      return {
        abierto: abierto ? decorar(abierto, ahora) : null,
        desde: r.desde, hasta: r.hasta,
        minutos_total: historial.reduce((s, f) => s + f.minutos, 0),
        historial,
      };
    },
  },

  // ----- administración -----
  {
    // Quién está trabajando ahora
    metodo: 'GET', ruta: '/fichajes/presentes', roles: SOLO_ADMIN,
    async handler({ ahora }) {
      const { rows } = await db.query(`SELECT ${COLUMNAS} ${DESDE} WHERE f.egreso IS NULL ORDER BY f.ingreso`);
      return rows.map((f) => decorar(f, ahora));
    },
  },
  {
    metodo: 'GET', ruta: '/fichajes', roles: SOLO_ADMIN,
    async handler({ query, ahora }) {
      const { r, rows } = await fichajesDelRango(query, ahora);
      return { desde: r.desde, hasta: r.hasta, fichajes: rows.map((f) => decorar(f, ahora)) };
    },
  },
  {
    // Horas trabajadas por empleado en el período
    metodo: 'GET', ruta: '/fichajes/resumen', roles: SOLO_ADMIN,
    async handler({ query, ahora }) {
      const { r, rows } = await fichajesDelRango(query, ahora);
      const empleados = resumirHoras(rows, ahora, zona);
      return {
        desde: r.desde, hasta: r.hasta, empleados,
        minutos_total: empleados.reduce((s, e) => s + e.minutos, 0),
        con_jornada_abierta: empleados.filter((e) => e.abiertas > 0).length,
      };
    },
  },
  {
    // Carga manual (por ejemplo, alguien que olvidó fichar)
    metodo: 'POST', ruta: '/fichajes', roles: SOLO_ADMIN, status: 201,
    async handler({ body, usuario, ahora }) {
      const d = validar(esquemaManual, body);
      validarTramo(d.ingreso, d.egreso, ahora);
      const { rows: u } = await db.query('SELECT id FROM usuario WHERE id = $1', [d.id_usuario]);
      if (!u[0]) throw new HttpError(404, 'Usuario no encontrado');
      try {
        const { rows } = await db.query(
          `INSERT INTO fichaje (id_usuario, turno, ingreso, egreso, nota, manual, editado_por)
           VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id`,
          [d.id_usuario, d.turno, d.ingreso, d.egreso ?? null, d.nota ?? '', usuario.id],
        );
        return { id: rows[0].id };
      } catch (e) { return abiertoDuplicado(e); }
    },
  },
  {
    metodo: 'PATCH', ruta: '/fichajes/:id', roles: SOLO_ADMIN,
    async handler({ params, body, usuario, ahora }) {
      const id = idDe(params.id);
      const datos = validar(esquemaEditar, body);
      const { rows: actual } = await db.query('SELECT id, ingreso, egreso FROM fichaje WHERE id = $1', [id]);
      if (!actual[0]) throw new HttpError(404, 'Fichaje no encontrado');
      const ingreso = datos.ingreso ?? new Date(actual[0].ingreso).toISOString();
      const egreso = 'egreso' in datos ? datos.egreso : (actual[0].egreso ? new Date(actual[0].egreso).toISOString() : null);
      validarTramo(ingreso, egreso, ahora);

      const campos = { ...datos, manual: true, editado_por: usuario.id };
      const claves = Object.keys(campos);
      try {
        const { rows } = await db.query(
          `UPDATE fichaje SET ${claves.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${claves.length + 1} RETURNING id`,
          [...claves.map((c) => campos[c]), id],
        );
        return { id: rows[0].id };
      } catch (e) { return abiertoDuplicado(e); }
    },
  },
  {
    // Cerrar una jornada que quedó abierta por olvido
    metodo: 'POST', ruta: '/fichajes/:id/cerrar', roles: SOLO_ADMIN,
    async handler({ params, body, usuario, ahora }) {
      const id = idDe(params.id);
      const { egreso } = validar(esquemaCerrar, body);
      const { rows: actual } = await db.query('SELECT id, ingreso, egreso FROM fichaje WHERE id = $1', [id]);
      if (!actual[0]) throw new HttpError(404, 'Fichaje no encontrado');
      if (actual[0].egreso) throw new HttpError(409, 'Esa jornada ya está cerrada');
      validarTramo(new Date(actual[0].ingreso).toISOString(), egreso, ahora);
      await db.query('UPDATE fichaje SET egreso = $1, manual = TRUE, editado_por = $2 WHERE id = $3', [egreso, usuario.id, id]);
      return { id, egreso };
    },
  },
];
