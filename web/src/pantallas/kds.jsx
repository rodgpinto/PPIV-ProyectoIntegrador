import { useEffect, useMemo, useRef, useState } from 'react';
import { get, patch } from '../api.js';
import { agruparPorProducto, minutosEntre, nivelDeEspera } from '../../../src/domain/pedidos.js';
import { useSesion } from '../app.jsx';
import { hora } from '../fmt.js';
import { Boton, Estado, useAviso, useCarga } from '../ui.jsx';

const COLUMNAS = [['pendiente', 'En espera'], ['preparando', 'Preparando'], ['listo', 'Listo para llevar']];
const origen = (it) => (it.canal === 'mesa' ? it.mesa : it.etiqueta || 'Barra');

/** Pitido corto sin archivos de audio: avisa cuando entra un pedido nuevo. */
function pitar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18);
    o.onended = () => ctx.close();
  } catch { /* sin audio: no pasa nada */ }
}

/**
 * Pantalla de cocina / barra: la cola de pedidos en lugar de comandas impresas.
 * Agrupa lo igual de distintas cuentas ("4 × Negroni") para prepararlo junto, y marca en amarillo y rojo lo que se demora.
 */
export function Kds() {
  const { usuario } = useSesion();
  const avisar = useAviso();
  const esAdmin = usuario.rol === 'administrador';
  const [destino, setDestino] = useState(esAdmin ? 'cocina' : usuario.rol);
  const [vista, setVista] = useState('grupos');
  const [sonido, setSonido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [, setLatido] = useState(0);
  const carga = useCarga(() => get('/kds', esAdmin ? { destino } : undefined), [destino], { cada: 5000 });
  const reloj = useRef({ desfase: 0, vistos: null });

  // La hora de referencia es la del servidor, para que una tablet con el reloj corrido no muestre esperas falsas.
  useEffect(() => {
    const d = carga.datos;
    if (!d || d.destino !== destino) return;
    reloj.current.desfase = new Date(d.ahora).getTime() - Date.now();
    const ids = new Set(d.items.map((i) => i.id));
    if (sonido && reloj.current.vistos && d.items.some((i) => !reloj.current.vistos.has(i.id))) pitar();
    reloj.current.vistos = ids;
  }, [carga.datos, destino, sonido]);
  useEffect(() => { const t = setInterval(() => setLatido((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { reloj.current.vistos = null; }, [destino]);

  const ahora = () => Date.now() + reloj.current.desfase;
  const items = carga.datos?.destino === destino ? carga.datos.items : [];

  async function avanzar(ids, estado) {
    setOcupado(true);
    try { await patch('/pedido-items/estado', { ids, estado }); await carga.recargar(); }
    catch (e) { avisar(e.message, 'error'); carga.recargar(); }
    finally { setOcupado(false); }
  }
  const pantallaCompleta = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

  const porEstado = (e) => items.filter((i) => i.estado === e);
  const porciones = (lista) => lista.reduce((s, i) => s + i.cantidad, 0);

  return (
    <div className="kds">
      <div className="kds-barra">
        <h1>{destino === 'barra' ? 'Barra' : 'Cocina'}</h1>
        {esAdmin && (
          <div className="pestanas" role="tablist" style={{ margin: 0, border: 0 }}>
            {['cocina', 'barra'].map((d) => <button key={d} role="tab" aria-selected={destino === d} className={destino === d ? 'activa' : ''} onClick={() => setDestino(d)}>{d === 'barra' ? 'Barra' : 'Cocina'}</button>)}
          </div>
        )}
        <div className="pestanas" role="tablist" style={{ margin: 0, border: 0 }} aria-label="Vista">
          <button role="tab" aria-selected={vista === 'grupos'} className={vista === 'grupos' ? 'activa' : ''} onClick={() => setVista('grupos')}>Agrupado</button>
          <button role="tab" aria-selected={vista === 'comandas'} className={vista === 'comandas' ? 'activa' : ''} onClick={() => setVista('comandas')}>Por cuenta</button>
        </div>
        <span style={{ marginLeft: 'auto' }} />
        <Boton className="btn-chico" aria-pressed={sonido} onClick={() => { setSonido(!sonido); if (!sonido) pitar(); }}>{sonido ? '🔔 Sonido activado' : '🔕 Activar sonido'}</Boton>
        <Boton className="btn-chico" onClick={pantallaCompleta}>Pantalla completa</Boton>
      </div>

      <Estado carga={carga}>
        {() => (
          <>
            {items.length === 0 && <p className="kds-vacio">Sin pedidos pendientes. Todo al día.</p>}
            <div className="kds-columnas">
              {COLUMNAS.map(([estado, titulo]) => (
                <section key={estado} className={`kds-col kds-${estado}`} aria-label={titulo}>
                  <h2>{titulo} <span className="kds-cuenta">{porciones(porEstado(estado))}</span></h2>
                  {vista === 'grupos'
                    ? <Grupos items={porEstado(estado)} estado={estado} destino={destino} ahora={ahora} ocupado={ocupado} avanzar={avanzar} />
                    : <Cuentas items={porEstado(estado)} estado={estado} destino={destino} ahora={ahora} ocupado={ocupado} avanzar={avanzar} />}
                </section>
              ))}
            </div>
          </>
        )}
      </Estado>
    </div>
  );
}

function Acciones({ estado, ids, ocupado, avanzar }) {
  if (estado === 'pendiente') {
    return <>
      <Boton tipo="primario" disabled={ocupado} onClick={() => avanzar(ids, 'preparando')}>Empezar</Boton>
      <Boton disabled={ocupado} onClick={() => avanzar(ids, 'listo')}>Ya está</Boton>
    </>;
  }
  if (estado === 'preparando') {
    return <>
      <Boton tipo="primario" disabled={ocupado} onClick={() => avanzar(ids, 'listo')}>Listo</Boton>
      <Boton className="btn-chico" disabled={ocupado} onClick={() => avanzar(ids, 'pendiente')} aria-label="Volver a en espera">↩</Boton>
    </>;
  }
  return <Boton className="btn-chico" disabled={ocupado} onClick={() => avanzar(ids, 'preparando')}>↩ Volver a preparar</Boton>;
}

function Espera({ desde, estado, destino, ahora }) {
  const min = minutosEntre(desde, ahora());
  return <span className={`kds-espera nivel-${estado === 'listo' ? 'listo' : nivelDeEspera(min, destino)}`}>{estado === 'listo' ? `listo hace ${min} min` : `${min} min`}</span>;
}

function Grupos({ items, estado, destino, ahora, ocupado, avanzar }) {
  const grupos = useMemo(() => agruparPorProducto(items), [items]);
  return grupos.map((g) => {
    const orig = new Map();
    for (const it of g.items) orig.set(origen(it), (orig.get(origen(it)) ?? 0) + it.cantidad);
    const desde = estado === 'listo' ? g.items.map((i) => i.listo_en).sort()[0] ?? g.desde : g.desde;
    return (
      <article key={g.clave} className={`kds-tarjeta nivel-${estado === 'listo' ? 'listo' : nivelDeEspera(minutosEntre(g.desde, ahora()), destino)}`}>
        <header><span className="kds-cant">{g.cantidad}×</span><h3>{g.nombre}</h3></header>
        {g.nota && <p className="kds-nota">⚠ {g.nota}</p>}
        <p className="kds-origen">{[...orig].map(([o, n]) => (n > 1 ? `${o} (${n})` : o)).join(' · ')}</p>
        <footer><Espera desde={desde} estado={estado} destino={destino} ahora={ahora} /><div className="kds-acciones"><Acciones estado={estado} ids={g.items.map((i) => i.id)} ocupado={ocupado} avanzar={avanzar} /></div></footer>
      </article>
    );
  });
}

/** Vista clásica: una tarjeta por cuenta con sus líneas (como una comanda). */
function Cuentas({ items, estado, destino, ahora, ocupado, avanzar }) {
  const cuentas = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!m.has(it.id_pedido)) m.set(it.id_pedido, { id: it.id_pedido, origen: origen(it), mozo: it.mozo, desde: it.creado_en, items: [] });
      m.get(it.id_pedido).items.push(it);
    }
    return [...m.values()];
  }, [items]);
  return cuentas.map((c) => (
    <article key={c.id} className={`kds-tarjeta nivel-${estado === 'listo' ? 'listo' : nivelDeEspera(minutosEntre(c.desde, ahora()), destino)}`}>
      <header><h3>{c.origen}</h3><small>{c.mozo} · {hora(c.desde)}</small></header>
      <ul className="kds-lineas">
        {c.items.map((it) => <li key={it.id}><span><b>{it.cantidad}×</b> {it.nombre}{it.nota && <em> ⚠ {it.nota}</em>}</span></li>)}
      </ul>
      <footer><Espera desde={c.desde} estado={estado} destino={destino} ahora={ahora} /><div className="kds-acciones"><Acciones estado={estado} ids={c.items.map((i) => i.id)} ocupado={ocupado} avanzar={avanzar} /></div></footer>
    </article>
  ));
}
