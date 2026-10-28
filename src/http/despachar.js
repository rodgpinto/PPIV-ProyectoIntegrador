// Despachador de la API: busca la ruta, autentica, controla el rol y ejecuta el handler.
// Express solo le pasa el pedido; así toda la API se puede probar sin servidor HTTP.
import { buscarSesion } from '../modules/auth/sesiones.js';
import { diferencias } from '../domain/auditoria.js';
import { HttpError, respuestaDeError } from './errores.js';

function compilar(patron) {
  const nombres = [];
  const re = new RegExp(`^${patron.replace(/:([a-z_]+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; })}/?$`);
  return { re, nombres };
}

/**
 * tabla: [{ metodo, ruta, roles | publico, status?, handler({ usuario, params, query, body, token, ip, ahora }) }]
 * El handler devuelve los datos (200 o `status`) o undefined (204 sin contenido).
 */
export function crearDespachador(tabla, { auditar = null, instantaneas = {} } = {}) {
  const rutas = tabla.map((r) => ({ ...r, ...compilar(r.ruta) }));

  return async function despachar({ metodo, ruta, query = {}, body, token = null, ip = null, ahora = new Date() }) {
    let contexto = null; // lo necesario para auditar aunque el handler falle
    try {
      let elegida = null;
      let rutaExiste = false;
      for (const r of rutas) {
        const m = r.re.exec(ruta);
        if (!m) continue;
        rutaExiste = true;
        if (r.metodo === metodo) { elegida = { r, m }; break; }
      }
      if (!elegida) throw new HttpError(rutaExiste ? 405 : 404, rutaExiste ? 'Método no permitido' : 'Ruta no encontrada');

      const { r, m } = elegida;
      let params;
      try {
        params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      } catch {
        throw new HttpError(400, 'Dirección inválida');
      }

      let usuario = null;
      const extra = {};
      contexto = { r, usuario: null, params, body, extra, ip, ahora };
      if (!r.publico) {
        if (!token) throw new HttpError(401, 'Falta iniciar sesión');
        usuario = await buscarSesion(token, ahora);
        if (!usuario) throw new HttpError(401, 'La sesión no es válida o venció');
        contexto.usuario = usuario;
        if (!r.roles.includes(usuario.rol)) throw new HttpError(403, 'No tenés permiso para esta acción');
      }

      // El handler puede llamar a auditar({ detalle, entidad, id_entidad }) para dejar datos propios (antes/después, etc.)
      const aportar = (aporte = {}) => {
        const { detalle, ...resto } = aporte;
        Object.assign(extra, resto);
        extra.detalle = { ...extra.detalle, ...detalle };
      };
      // Foto antes y después, solo para las rutas que la declaran (ver modules/auditoria/instantaneas.js)
      const foto = auditar && r.metodo !== 'GET' ? instantaneas[`${r.metodo} ${r.ruta}`] : null;
      const antes = foto ? await foto(params).catch(() => null) : null;
      const datos = await r.handler({ usuario, params, query, body, token, ip, ahora, auditar: aportar });
      if (foto && antes) {
        const despues = await foto(params).catch(() => null);
        const cambios = despues ? diferencias(antes, despues) : { eliminado: antes };
        if (Object.keys(cambios).length) aportar({ detalle: { cambios } });
      }
      const status = datos === undefined ? 204 : (r.status ?? 200);
      await auditar?.({ ...contexto, status, datos });
      return { status, body: datos };
    } catch (error) {
      const respuesta = respuestaDeError(error);
      if (contexto) await auditar?.({ ...contexto, status: respuesta.status, datos: respuesta.body });
      return respuesta;
    }
  };
}
