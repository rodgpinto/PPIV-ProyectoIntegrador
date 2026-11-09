// Servidor HTTP con el módulo nativo de Node: sirve la API (/api) y la interfaz compilada (public/).
// Sin Express ni librerías: menos memoria, menos dependencias que mantener y menos superficie de ataque.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { CSS_CARTA, renderCarta } from './carta-publica.js';
import { Descarga } from './descarga.js';

const LIMITE_BODY = 100 * 1024;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const COMPRIMIBLES = /^(text\/|application\/(json|javascript)|image\/svg)/;

const CABECERAS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function ipDe(req, trustProxy) {
  const directa = req.socket.remoteAddress ?? null;
  if (!trustProxy) return directa;
  const cadena = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cadena[cadena.length - trustProxy] ?? directa;
}

function leerBody(req) {
  return new Promise((resolver, rechazar) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITE_BODY) { rechazar(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
    req.on('error', rechazar);
  });
}

export function crearServidor({ despachar, publicDir, trustProxy = 0 }) {
  const cacheEstaticos = new Map(); // ruta -> { mtime, buffer, gzip, etag }

  function enviar(req, res, status, cuerpo, tipo, extra = {}) {
    const headers = { ...CABECERAS, 'Content-Type': tipo, ...extra };
    if (req.headers['x-forwarded-proto'] === 'https') headers['Strict-Transport-Security'] = 'max-age=31536000';
    let buf = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo ?? '', 'utf8');
    if (status === 200 && req.method === 'GET') {
      const etag = extra.ETag ?? `"${createHash('sha1').update(buf).digest('base64url')}"`;
      headers.ETag = etag;
      if (req.headers['if-none-match'] === etag) {
        const { 'Content-Type': _tipo, gzip: _gz, ...sin } = headers;
        res.writeHead(304, sin);
        return res.end();
      }
    }
    headers.Vary = 'Accept-Encoding';
    if (buf.length > 1024 && COMPRIMIBLES.test(tipo) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      buf = extra.gzip ?? gzipSync(buf);
      headers['Content-Encoding'] = 'gzip';
    }
    delete headers.gzip;
    headers['Content-Length'] = buf.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  const json = (req, res, status, datos, extra) =>
    enviar(req, res, status, status === 204 ? '' : JSON.stringify(datos ?? null), 'application/json; charset=utf-8', { 'Cache-Control': 'no-cache', ...extra });

  async function api(req, res, url) {
    let body;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const texto = await leerBody(req);
      if (texto.trim()) {
        try { body = JSON.parse(texto); } catch { return json(req, res, 400, { error: 'El cuerpo de la solicitud no es un JSON válido' }); }
      }
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() || null : null;
    const r = await despachar({
      metodo: req.method, ruta: url.pathname.slice(4) || '/', query: Object.fromEntries(url.searchParams),
      body, token, ip: ipDe(req, trustProxy), ahora: new Date(),
    });
    if (r.body instanceof Descarga) {
      const { nombre, buffer, tipo } = r.body;
      return enviar(req, res, 200, buffer, tipo, { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}"` });
    }
    return json(req, res, r.status, r.body);
  }

  function estatico(req, res, url) {
    if (!publicDir || !existsSync(publicDir)) return json(req, res, 404, { error: 'Falta compilar la interfaz: ejecutá "npm run build"' });
    let relativa;
    try { relativa = decodeURIComponent(url.pathname); } catch { return json(req, res, 400, { error: 'Dirección inválida' }); }
    let archivo = path.join(publicDir, relativa === '/' ? 'index.html' : relativa);
    if (!archivo.startsWith(publicDir)) return json(req, res, 404, { error: 'No encontrado' });
    if (!existsSync(archivo) || !statSync(archivo).isFile()) {
      if (path.extname(relativa)) return json(req, res, 404, { error: 'No encontrado' });
      archivo = path.join(publicDir, 'index.html'); // la interfaz usa rutas con #, pero por las dudas
    }
    const mtime = statSync(archivo).mtimeMs;
    let e = cacheEstaticos.get(archivo);
    if (!e || e.mtime !== mtime) {
      const buffer = readFileSync(archivo);
      e = { mtime, buffer, gzip: gzipSync(buffer), etag: `"${createHash('sha1').update(buffer).digest('base64url')}"` };
      cacheEstaticos.set(archivo, e);
    }
    const tipo = TIPOS[path.extname(archivo)] ?? 'application/octet-stream';
    // Los archivos de /assets llevan hash en el nombre: se cachean un año. Lo demás se revalida.
    const inmutable = archivo.startsWith(path.join(publicDir, 'assets'));
    return enviar(req, res, 200, e.buffer, tipo, { ETag: e.etag, gzip: e.gzip, 'Cache-Control': inmutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  }

  // La carta de los clientes (QR): HTML ya armado, separado por completo de la aplicación del personal
  async function cartaPublica(req, res, url) {
    if (url.pathname === '/carta/estilos.css') return enviar(req, res, 200, CSS_CARTA, TIPOS['.css'], { 'Cache-Control': 'public, max-age=3600' });
    if (url.pathname !== '/carta' && url.pathname !== '/carta/') return json(req, res, 404, { error: 'No encontrado' });
    const r = await despachar({ metodo: 'GET', ruta: '/carta', ip: ipDe(req, trustProxy), ahora: new Date() });
    if (r.status !== 200) return enviar(req, res, 503, 'La carta no está disponible en este momento.', 'text/plain; charset=utf-8', { 'Retry-After': '30' });
    return enviar(req, res, 200, renderCarta(r.body), TIPOS['.html'], { 'Cache-Control': 'public, max-age=60' });
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/salud') return json(req, res, 200, { ok: true });
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(req, res, 405, { error: 'Método no permitido' });
      if (url.pathname === '/carta' || url.pathname.startsWith('/carta/')) return await cartaPublica(req, res, url);
      return estatico(req, res, url);
    } catch (error) {
      if (!res.headersSent) json(req, res, error.status ?? 500, { error: error.status === 413 ? 'El cuerpo de la solicitud es demasiado grande' : 'Error interno del servidor' });
      if (!error.status) console.error(error);
    }
  });
}
