import { useMemo, useState } from 'react';
import { guardarArchivo } from '../api.js';
import { qrSvg } from '../../../src/domain/qr.js';
import { Boton, Entrada } from '../ui.jsx';

const CLAVE = 'radas.urlPublica';
const leer = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
const guardar = (v) => { try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento */ } };

/** Dirección que no sirve desde el celular de un cliente (solo anda en esta computadora o en la red del local). */
export function esDireccionPrivada(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function normalizarBase(texto) {
  const t = String(texto ?? '').trim().replace(/\/+$/, '').replace(/\/carta$/i, '');
  if (!t) return null;
  const conEsquema = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try { return new URL(conEsquema).origin + new URL(conEsquema).pathname.replace(/\/+$/, ''); } catch { return null; }
}

export function CartaQr() {
  const [base, setBase] = useState(() => leer() || window.location.origin);
  const normal = normalizarBase(base);
  const direccion = normal ? `${normal}/carta` : null;
  const svg = useMemo(() => { try { return direccion ? qrSvg(direccion) : null; } catch { return null; } }, [direccion]);
  const imagen = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;

  return (
    <>
      <div className="tarjeta no-imprimir">
        <h2>Carta para los clientes</h2>
        <p>Es una página aparte, sin usuarios ni contraseñas: solo muestra la carta y los precios. Se actualiza sola cuando cambiás productos o precios.</p>
        <Entrada
          etiqueta="Dirección pública del sistema"
          ayuda="La que se escribe en el navegador de un celular que no está en el local. Si cambia, hay que imprimir el QR de nuevo."
          value={base}
          onChange={(e) => { setBase(e.target.value); guardar(e.target.value); }}
          placeholder="https://radas.ejemplo.com"
          inputMode="url"
        />
        {direccion && esDireccionPrivada(direccion) && (
          <p className="nota" role="alert">Esa dirección solo funciona en esta computadora o dentro de la red del local: los clientes con datos móviles no podrían abrirla. Poné la dirección pública donde esté publicado el sistema.</p>
        )}
        {!normal && <p className="nota nota-mala" role="alert">Escribí una dirección válida.</p>}
        {direccion && <p className="ayuda">El QR lleva a: <a href={direccion} target="_blank" rel="noreferrer">{direccion}</a></p>}
        <div className="acciones">
          <Boton tipo="primario" disabled={!svg} onClick={() => window.print()}>Imprimir cartelitos</Boton>
          <Boton disabled={!svg} onClick={() => guardarArchivo(new Blob([svg], { type: 'image/svg+xml' }), 'radas-carta-qr.svg')}>Descargar el QR (SVG)</Boton>
        </div>
      </div>
      {svg && (
        <section className="qr-hoja" aria-label="Cartelitos para imprimir">
          {[0, 1, 2, 3].map((i) => (
            <figure key={i} className="qr-cartel">
              <figcaption className="qr-marca">RADAS</figcaption>
              <img src={imagen} alt={`Código QR que abre la carta en ${direccion}`} />
              <p><b>Escaneá y mirá la carta</b></p>
              <small>Abrí la cámara del celular y apuntá al código</small>
            </figure>
          ))}
        </section>
      )}
    </>
  );
}
