// Piezas de interfaz compartidas: sin librerías, con foco y teclado resueltos una sola vez.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { equivalencia } from '../../src/domain/presentaciones.js';
import { numero, UNIDADES } from './fmt.js';

/* ---- avisos (arriba, para que se vean sin scrollear) ---- */
const ContextoAvisos = createContext(() => {});
export const useAviso = () => useContext(ContextoAvisos);

export function ProveedorAvisos({ children }) {
  const [lista, setLista] = useState([]);
  const sig = useRef(0);
  const avisar = useCallback((texto, tipo = 'ok') => {
    const id = ++sig.current;
    setLista((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((a) => a.id !== id)), tipo === 'ok' ? 3000 : 7000);
  }, []);
  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}
      <div className="avisos" aria-live="polite">
        {lista.map((a) => <div key={a.id} className={`aviso aviso-${a.tipo}`} role={a.tipo === 'error' ? 'alert' : 'status'} title="Tocá para cerrar" onClick={() => setLista((l) => l.filter((x) => x.id !== a.id))}>{a.texto}</div>)}
      </div>
    </ContextoAvisos.Provider>
  );
}

/* ---- carga de datos ---- */
export function useCarga(funcion, deps = [], { cada } = {}) {
  const [estado, setEstado] = useState({ datos: null, error: null, cargando: true });
  const ultima = useRef(0);
  const cargar = useCallback(async (silencioso = false) => {
    const mia = ++ultima.current;
    if (!silencioso) setEstado((e) => ({ ...e, cargando: true, error: null }));
    try {
      const datos = await funcion();
      if (mia === ultima.current) setEstado({ datos, error: null, cargando: false });
    } catch (error) {
      if (mia === ultima.current) setEstado((e) => ({ datos: silencioso ? e.datos : null, error: silencioso ? e.error : error, cargando: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!cada) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') cargar(true); }, cada);
    return () => clearInterval(t);
  }, [cada, cargar]);
  return { ...estado, recargar: () => cargar(true), recargarConEspera: () => cargar(false) };
}

export function Estado({ carga, children, vacio }) {
  if (carga.error && !carga.datos) {
    return (
      <div className="caja-error" role="alert">
        <p>{carga.error.message}</p>
        <button className="btn" onClick={carga.recargarConEspera}>Reintentar</button>
      </div>
    );
  }
  if (carga.datos === null || carga.datos === undefined) return <p className="cargando" role="status">Cargando…</p>;
  if (vacio) return <p className="vacio">{vacio}</p>;
  return children(carga.datos);
}

/* ---- controles ---- */
// type="button" por defecto: dentro de un <form>, un botón sin tipo envía el formulario (era el error de «+ Agregar insumo» y «×»).
export function Boton({ tipo = 'secundario', cargando, children, className = '', ...resto }) {
  return <button type="button" className={`btn btn-${tipo} ${className}`} disabled={cargando || resto.disabled} {...resto}>{cargando ? 'Guardando…' : children}</button>;
}

export function Campo({ etiqueta, ayuda, error, children, className = '' }) {
  const id = useId();
  return (
    <div className={`campo ${error ? 'campo-error' : ''} ${className}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {typeof children === 'function' ? children({ id, 'aria-describedby': ayuda || error ? `${id}-a` : undefined, 'aria-invalid': error ? true : undefined }) : children}
      {(error || ayuda) && <small id={`${id}-a`} className={error ? 'texto-error' : 'ayuda'}>{error || ayuda}</small>}
    </div>
  );
}

export function Entrada({ etiqueta, ayuda, error, className, ...props }) {
  return <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} className={className}>{(a) => <input {...a} {...props} />}</Campo>;
}

export function Selector({ etiqueta, ayuda, error, className, children, ...props }) {
  return <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} className={className}>{(a) => <select {...a} {...props}>{children}</select>}</Campo>;
}

export function Chip({ tono = 'neutro', children }) {
  return <span className={`chip chip-${tono}`}>{children}</span>;
}

export function Pestanas({ valor, onCambio, opciones }) {
  return (
    <div className="pestanas" role="tablist">
      {opciones.map(([clave, texto, cuenta]) => (
        <button key={clave} role="tab" aria-selected={valor === clave} className={valor === clave ? 'activa' : ''} onClick={() => onCambio(clave)}>
          {texto}{cuenta ? <span className="cuenta">{cuenta}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---- ventana modal ---- */
export function Modal({ titulo, onCerrar, children, ancho = 'normal', pie }) {
  const caja = useRef(null);
  const previo = useRef(document.activeElement);
  const idTitulo = useId();
  useEffect(() => {
    const foco = caja.current?.querySelector('input:not([type=hidden]), select, textarea') ?? caja.current;
    foco?.focus();
    const alTecla = (e) => {
      if (e.key === 'Escape') onCerrar();
      if (e.key === 'Tab' && caja.current) {
        const f = [...caja.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
        if (!f.length) return;
        const [primero, ultimo] = [f[0], f[f.length - 1]];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    };
    document.addEventListener('keydown', alTecla);
    document.body.classList.add('con-modal');
    const aPrevio = previo.current;
    return () => { document.removeEventListener('keydown', alTecla); document.body.classList.remove('con-modal'); aPrevio?.focus?.(); };
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={`modal modal-${ancho}`} role="dialog" aria-modal="true" aria-labelledby={idTitulo} ref={caja} tabIndex={-1}>
        <header><h2 id={idTitulo}>{titulo}</h2><button className="btn-icono" onClick={onCerrar} aria-label="Cerrar">×</button></header>
        <div className="modal-cuerpo">{children}</div>
        {pie && <footer>{pie}</footer>}
      </div>
    </div>
  );
}

/** Confirmación simple para acciones delicadas. */
export function Confirmar({ titulo, texto, confirmar = 'Confirmar', peligro, onSi, onNo }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <Modal titulo={titulo} onCerrar={onNo} ancho="chico" pie={<>
      <Boton onClick={onNo}>Cancelar</Boton>
      <Boton tipo={peligro ? 'peligro' : 'primario'} cargando={enviando} onClick={async () => { setEnviando(true); try { await onSi(); } finally { setEnviando(false); } }}>{confirmar}</Boton>
    </>}>
      <p>{texto}</p>
    </Modal>
  );
}

export function Encabezado({ titulo, children, sub }) {
  return (
    <div className="encabezado">
      <div><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {children && <div className="acciones">{children}</div>}
    </div>
  );
}

/** Mensajes de validación del servidor por campo: { campo: mensaje } */
export function erroresPorCampo(error) {
  const d = error?.detalles;
  if (!d) return {};
  if (Array.isArray(d)) return Object.fromEntries(d.map((x) => [x.campo ?? x.path ?? '', x.mensaje ?? x.message ?? ''] ));
  if (typeof d === 'object') return d;
  return {};
}

/** Una cantidad con su unidad y, si el insumo tiene envases, su equivalencia: «2.450 ml ≈ 3 × Botella 750 ml + 200 ml». */
export function Cantidad({ valor, insumo, unidad, decimales = 2 }) {
  const u = unidad ?? insumo?.unidad;
  const eq = insumo?.presentaciones?.length ? equivalencia(valor, u, insumo.presentaciones, (n) => numero(n, decimales)) : null;
  return <>{numero(valor, decimales)} {UNIDADES[u]}{eq && <small className="ayuda equiv"> ≈ {eq}</small>}</>;
}
