// Cliente de la API: guarda el token, agrega el encabezado y convierte los errores en excepciones legibles.
const CLAVE = 'radas.token';
let token = null;
try { token = localStorage.getItem(CLAVE); } catch { /* sin almacenamiento: la sesión dura hasta recargar */ }

export class ErrorApi extends Error {
  constructor(status, mensaje, detalles) { super(mensaje); this.status = status; this.detalles = detalles; }
}

export const hayToken = () => Boolean(token);
export function guardarToken(t) {
  token = t;
  try { t ? localStorage.setItem(CLAVE, t) : localStorage.removeItem(CLAVE); } catch { /* idem */ }
}

const oyentes = new Set();
export const alExpirarSesion = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };

export async function api(metodo, ruta, cuerpo, query) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  let res;
  try {
    res = await fetch(`/api${ruta}${qs}`, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.');
  }
  if (res.status === 204) return null;
  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && !ruta.startsWith('/auth/login')) { guardarToken(null); oyentes.forEach((f) => f()); }
    throw new ErrorApi(res.status, datos?.error ?? `Error ${res.status}`, datos?.detalles);
  }
  return datos;
}
export const get = (r, q) => api('GET', r, undefined, q);
export const post = (r, b) => api('POST', r, b ?? {});
export const patch = (r, b) => api('PATCH', r, b);
export const put = (r, b) => api('PUT', r, b);
export const borrar = (r) => api('DELETE', r);
export const del = borrar;

/** Descarga un archivo de la API (el token va en un encabezado, así que no sirve un enlace común): devuelve { blob, nombre }. */
export async function descargar(ruta) {
  let res;
  try {
    res = await fetch(`/api${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.');
  }
  if (!res.ok) {
    const datos = await res.json().catch(() => null);
    if (res.status === 401 && token) { guardarToken(null); oyentes.forEach((f) => f()); }
    throw new ErrorApi(res.status, datos?.error ?? `Error ${res.status}`);
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'descarga';
  return { blob: await res.blob(), nombre };
}

/** Guarda un Blob como archivo en el dispositivo. */
export function guardarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
