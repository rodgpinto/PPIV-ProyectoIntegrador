import { useState } from 'react';
import { get, post, borrar } from '../api.js';
import { aNumero, numeroDe, CANALES, diaYFecha, fechaHora, jornadaActual, MEDIOS, minutosDesde, numero, pesos, pesosFino } from '../fmt.js';
import { useSesion } from '../app.jsx';
import { Boton, Chip, Confirmar, Encabezado, Entrada, Estado, useAviso, useCarga } from '../ui.jsx';

const estiloDif = (d) => (d === 0 ? 'ok' : Math.abs(d) <= 500 ? 'aviso' : 'malo');
const textoDif = (d) => (d === 0 ? 'Sin diferencia' : d < 0 ? `Faltan ${pesosFino(-d)}` : `Sobran ${pesosFino(d)}`);

export function Caja() {
  const [fecha, setFecha] = useState(jornadaActual());
  const carga = useCarga(() => get('/caja/jornada', { fecha }), [fecha], { cada: 30000 });
  const historial = useCarga(() => get('/caja/cierres'), []);
  const recargar = () => { carga.recargar(); historial.recargar(); };

  return (
    <>
      <Encabezado titulo="Caja" sub="Lo cobrado en la noche y el cierre con el conteo del efectivo. La noche cuenta de 06:00 a 06:00." />
      <div className="herramientas">
        <Entrada etiqueta="Noche" type="date" value={fecha} max={jornadaActual()} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        {fecha !== jornadaActual() && <Boton onClick={() => setFecha(jornadaActual())}>Volver a esta noche</Boton>}
      </div>
      <Estado carga={carga}>{(j) => <Jornada j={j} onCambio={recargar} />}</Estado>
      <section className="tarjeta" style={{ marginTop: '1rem' }}>
        <h2>Cierres anteriores</h2>
        <Estado carga={historial} vacio={historial.datos?.length === 0 ? 'Todavía no se cerró ninguna caja.' : null}>
          {(lista) => (
            <div className="tabla-caja"><table>
              <thead><tr><th>Noche</th><th>Caja</th><th className="num">Ventas</th><th className="num solo-ancho">Efectivo contado</th><th className="num">Diferencia</th><th className="solo-ancho">Cerró</th></tr></thead>
              <tbody>{lista.map((c) => (
                <tr key={c.id}>
                  <td><b>{diaYFecha(c.fecha_jornada)}</b> <small className="ayuda">{c.cuentas} cuentas</small></td>
                  <td>{NOMBRE_CAJA[c.canal]}</td>
                  <td className="num">{pesos(c.ventas_total)}</td>
                  <td className="num solo-ancho">{pesosFino(c.efectivo_contado)}</td>
                  <td className="num"><Chip tono={estiloDif(c.diferencia)}>{textoDif(c.diferencia)}</Chip></td>
                  <td className="solo-ancho">{c.usuario} <small className="ayuda">{fechaHora(c.cerrado_en)}</small></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Estado>
      </section>
    </>
  );
}

const NOMBRE_CAJA = { mesa: 'Salón', barra: 'Barra', todos: 'Toda la noche' };

function Jornada({ j, onCambio }) {
  const usaTodos = Boolean(j.cierre);
  const usaSeparadas = j.cierres.some((c) => c.canal !== 'todos');
  const [modo, setModo] = useState('separadas');
  const actual = usaTodos ? 'todos' : usaSeparadas ? 'separadas' : modo;
  return (
    <>
      <div className="rejilla">
        <section className="tarjeta">
          <h2>Cobrado {j.es_actual ? 'esta noche' : `el ${diaYFecha(j.fecha)}`} {j.cerrada ? <Chip tono="ok">caja cerrada</Chip> : <Chip tono="agua">abierta</Chip>}</h2>
          <p className="kpi-valor" style={{ fontSize: '2rem' }}>{pesos(j.ventas_total)}</p>
          <p className="ayuda">{j.cuentas} {j.cuentas === 1 ? 'cuenta' : 'cuentas'}{j.cuentas ? ` · ticket promedio ${pesos(j.ticket_promedio)}` : ''}{j.canceladas ? ` · ${j.canceladas} cancelada${j.canceladas === 1 ? '' : 's'}` : ''}</p>
          <ul className="lista-simple">
            {j.por_medio.map((m) => <li key={m.medio_pago}><span>{MEDIOS[m.medio_pago]} <small className="ayuda">{m.cuentas} {m.cuentas === 1 ? 'cuenta' : 'cuentas'}</small></span><b>{pesos(m.ventas)}</b></li>)}
          </ul>
          {j.por_canal.length > 1 && <p className="ayuda" style={{ marginTop: '.6rem' }}>{j.por_canal.map((c) => `${CANALES[c.canal]}: ${pesos(c.ventas)}`).join(' · ')}</p>}
        </section>
        {actual === 'todos' && (j.cierre ? <CierreHecho c={j.cierre} onCambio={onCambio} /> : <FormCierre j={j} caja={j.por_caja.todos} onCambio={onCambio} />)}
      </div>
      {!usaTodos && !usaSeparadas && (
        <div className="herramientas" style={{ marginTop: '1rem' }}>
          <div className="periodos" role="group" aria-label="Cómo cerrar la caja">
            <button type="button" className={`btn btn-chico ${actual === 'separadas' ? 'btn-primario' : ''}`} aria-pressed={actual === 'separadas'} onClick={() => setModo('separadas')}>Salón y barra por separado</button>
            <button type="button" className={`btn btn-chico ${actual === 'todos' ? 'btn-primario' : ''}`} aria-pressed={actual === 'todos'} onClick={() => setModo('todos')}>Todo junto</button>
          </div>
        </div>
      )}
      {actual === 'separadas' && (
        <div className="rejilla" style={{ marginTop: '1rem' }}>
          {['mesa', 'barra'].map((canal) => <CajaCanal key={canal} j={j} caja={j.por_caja[canal]} onCambio={onCambio} />)}
        </div>
      )}
    </>
  );
}

/** Una caja (salón o barra): lo cobrado en ese canal y su propio arqueo. */
function CajaCanal({ j, caja, onCambio }) {
  return (
    <div>
      <section className="tarjeta" style={{ marginBottom: '1rem' }}>
        <h2>{NOMBRE_CAJA[caja.canal]} {caja.cierre ? <Chip tono="ok">cerrada</Chip> : <Chip tono="agua">abierta</Chip>}</h2>
        <p className="kpi-valor" style={{ fontSize: '1.6rem' }}>{pesos(caja.ventas_total)}</p>
        <p className="ayuda">{caja.cuentas} {caja.cuentas === 1 ? 'cuenta' : 'cuentas'} · efectivo {pesos(caja.ventas_efectivo)}</p>
        <ul className="lista-simple">
          {caja.por_medio.filter((m) => m.ventas > 0).map((m) => <li key={m.medio_pago}><span>{MEDIOS[m.medio_pago]}</span><b>{pesos(m.ventas)}</b></li>)}
        </ul>
      </section>
      {caja.cierre ? <CierreHecho c={caja.cierre} onCambio={onCambio} /> : <FormCierre j={j} caja={caja} onCambio={onCambio} />}
    </div>
  );
}

function FormCierre({ j, caja, onCambio }) {
  const avisar = useAviso();
  const [f, setF] = useState({ fondo: '', retiros: '', contado: '', nota: '' });
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const set = (c) => (e) => setF((x) => ({ ...x, [c]: e.target.value }));
  const fondo = numeroDe(f.fondo);
  const retiros = numeroDe(f.retiros);
  const contado = aNumero(f.contado);
  const montosMal = [fondo, retiros].some((n) => !Number.isFinite(n) || n < 0);
  const esperado = montosMal ? NaN : Math.round((fondo + caja.ventas_efectivo - retiros) * 100) / 100;
  const diferencia = contado === null || montosMal ? null : Math.round((contado - esperado) * 100) / 100;
  const invalido = montosMal || contado === null || contado < 0;
  const bloqueada = caja.abiertas.length > 0;

  async function cerrar() {
    setEnviando(true);
    try {
      await post('/caja/cierres', { fecha: j.fecha, canal: caja.canal, fondo_inicial: fondo, retiros, efectivo_contado: contado, nota: f.nota.trim() });
      avisar('Caja cerrada');
      setConfirmar(false);
      onCambio();
    } catch (e) {
      avisar(e.message, 'error'); setConfirmar(false); onCambio();
    } finally { setEnviando(false); }
  }

  return (
    <section className="tarjeta">
      <h2>{caja.canal === 'todos' ? 'Cerrar la caja' : `Cerrar la caja del ${caja.canal === 'mesa' ? 'salón' : 'barra'}`.replace('del barra', 'de la barra')}</h2>
      {bloqueada && (
        <div className="nota" role="alert">
          <b>Hay {caja.abiertas.length} {caja.abiertas.length === 1 ? 'cuenta abierta' : 'cuentas abiertas'}.</b> Cobralas o cancelalas antes de cerrar:
          <ul className="lista-simple">{caja.abiertas.map((a) => <li key={a.id}><span>{a.mesa ?? `Barra ${a.etiqueta}`.trim()}</span><span className="ayuda">hace {numero(minutosDesde(a.creado_en))} min</span></li>)}</ul>
          <a href="#/pedidos">Ir a Pedidos →</a>
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (!invalido && !bloqueada) setConfirmar(true); }} className="modal-cuerpo" style={{ padding: 0 }}>
        <div className="filas">
          <Entrada etiqueta="Fondo de caja al empezar ($)" ayuda="El efectivo para dar vuelto" inputMode="decimal" value={f.fondo} onChange={set('fondo')} placeholder="0" />
          <Entrada etiqueta="Retiros de efectivo ($)" ayuda="Pagos a proveedores, propinas, etc." inputMode="decimal" value={f.retiros} onChange={set('retiros')} placeholder="0" />
        </div>
        <div className="sumario"><span>Efectivo cobrado: <b>{pesosFino(caja.ventas_efectivo)}</b></span><span>Debería haber: <b>{Number.isNaN(esperado) ? '—' : pesosFino(esperado)}</b></span></div>
        <Entrada etiqueta="Efectivo contado en la caja ($)" required inputMode="decimal" value={f.contado} onChange={set('contado')} />
        {diferencia !== null && <p><Chip tono={estiloDif(diferencia)}>{textoDif(diferencia)}</Chip></p>}
        <Entrada etiqueta="Nota (opcional)" maxLength={300} value={f.nota} onChange={set('nota')} />
        <div><Boton tipo="primario" type="submit" disabled={invalido || bloqueada}>Cerrar caja</Boton></div>
      </form>
      {confirmar && (
        <Confirmar titulo="Cerrar la caja"
          texto={`Ventas${caja.canal === 'todos' ? ' de la noche' : caja.canal === 'mesa' ? ' del salón' : ' de la barra'}: ${pesos(caja.ventas_total)}. Efectivo contado ${pesosFino(contado)} y debería haber ${pesosFino(esperado)}: ${textoDif(diferencia).toLowerCase()}. Después de cerrar no se pueden cobrar más cuentas en esta caja, salvo que el administrador la reabra.`}
          confirmar={enviando ? 'Cerrando…' : 'Cerrar caja'} onNo={() => setConfirmar(false)} onSi={cerrar} />
      )}
    </section>
  );
}

function CierreHecho({ c, onCambio }) {
  const { usuario } = useSesion();
  const avisar = useAviso();
  const [reabrir, setReabrir] = useState(false);
  return (
    <section className="tarjeta">
      <h2>Cierre de la caja{c.canal !== 'todos' && ` · ${NOMBRE_CAJA[c.canal]}`}</h2>
      <p><Chip tono={estiloDif(c.diferencia)}>{textoDif(c.diferencia)}</Chip></p>
      <ul className="lista-simple">
        <li><span>Fondo de caja</span><b>{pesosFino(c.fondo_inicial)}</b></li>
        <li><span>+ Cobrado en efectivo</span><b>{pesosFino(c.ventas_efectivo)}</b></li>
        <li><span>− Retiros</span><b>{pesosFino(c.retiros)}</b></li>
        <li><span>Debería haber</span><b>{pesosFino(c.efectivo_esperado)}</b></li>
        <li><span>Contado</span><b>{pesosFino(c.efectivo_contado)}</b></li>
      </ul>
      {c.nota && <p className="nota">{c.nota}</p>}
      <p className="ayuda">Cerró {c.usuario} · {fechaHora(c.cerrado_en)}</p>
      {usuario.rol === 'administrador' && <Boton tipo="peligro" onClick={() => setReabrir(true)}>Reabrir caja</Boton>}
      {reabrir && (
        <Confirmar titulo="Reabrir la caja" texto="Se borra este cierre y se vuelve a poder cobrar en la noche. Después hay que contar y cerrar de nuevo." confirmar="Reabrir" peligro onNo={() => setReabrir(false)}
          onSi={async () => { try { await borrar(`/caja/cierres/${c.id}`); avisar('Caja reabierta'); setReabrir(false); onCambio(); } catch (e) { avisar(e.message, 'error'); setReabrir(false); } }} />
      )}
    </section>
  );
}
