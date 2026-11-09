import { Fragment, useState } from 'react';
import { get, patch, post } from '../api.js';
import { aInputLocal, deInputLocal, diaYFecha, fechaHora, hoy, horas, horasDecimal, hora, ROLES, sumarDias, TURNOS } from '../fmt.js';
import { Boton, Chip, Encabezado, Entrada, Estado, Modal, Pestanas, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

export function Personal() {
  const [tab, setTab] = useState('presentes');
  return (
    <>
      <Encabezado titulo="Horas del personal" sub="Quién está trabajando, cuántas horas hizo cada uno y la corrección de fichajes olvidados." />
      <Pestanas valor={tab} onCambio={setTab} opciones={[['presentes', 'Ahora'], ['resumen', 'Horas por empleado'], ['jornadas', 'Jornadas']]} />
      {tab === 'presentes' && <Presentes />}
      {tab === 'resumen' && <Resumen />}
      {tab === 'jornadas' && <Jornadas />}
    </>
  );
}

function Presentes() {
  const carga = useCarga(() => get('/fichajes/presentes'), [], { cada: 30000 });
  const [cerrar, setCerrar] = useState(null);
  return (
    <Estado carga={carga} vacio={carga.datos?.length === 0 ? 'Nadie tiene una jornada abierta en este momento.' : null}>
      {(lista) => (
        <>
          <div className="tabla-caja"><table>
            <thead><tr><th>Empleado</th><th>Rol</th><th>Turno</th><th>Ingresó</th><th className="num">Lleva</th><th /></tr></thead>
            <tbody>{lista.map((p) => (
              <tr key={p.id}><td><b>{p.nombre}</b></td><td>{ROLES[p.rol]}</td><td>{TURNOS[p.turno]}</td><td>{fechaHora(p.ingreso)}</td>
                <td className="num">{horas(p.minutos)} {p.posible_olvido && <Chip tono="malo">¿olvidó el egreso?</Chip>}</td>
                <td className="num"><Boton className="btn-chico" onClick={() => setCerrar(p)}>Cerrar jornada</Boton></td></tr>
            ))}</tbody>
          </table></div>
          {cerrar && <CerrarJornada jornada={cerrar} onCerrar={() => setCerrar(null)} onListo={() => { setCerrar(null); carga.recargar(); }} />}
        </>
      )}
    </Estado>
  );
}

function CerrarJornada({ jornada, onCerrar, onListo }) {
  const avisar = useAviso();
  const [egreso, setEgreso] = useState(aInputLocal(new Date().toISOString()));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setError('');
    try { await post(`/fichajes/${jornada.id}/cerrar`, { egreso: deInputLocal(egreso) }); avisar('Jornada cerrada'); onListo(); }
    catch (err) { setError(err.message); setEnviando(false); }
  }
  return (
    <Modal titulo={`Cerrar la jornada de ${jornada.nombre}`} onCerrar={onCerrar} ancho="chico">
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        {error && <div className="caja-error" role="alert">{error}</div>}
        <p>Ingresó el {fechaHora(jornada.ingreso)}. Indicá a qué hora se fue realmente.</p>
        <Entrada etiqueta="Hora de egreso" type="datetime-local" required value={egreso} onChange={(e) => setEgreso(e.target.value)} />
        <Boton tipo="primario" type="submit" cargando={enviando}>Cerrar jornada</Boton>
      </form>
    </Modal>
  );
}

function descargarCsv(nombre, filas) {
  const csv = filas.map((f) => f.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function Resumen() {
  const [rango, setRango] = useState({ desde: sumarDias(hoy(), -(Number(hoy().slice(8)) - 1)), hasta: hoy() });
  const carga = useCarga(() => get('/fichajes/resumen', rango), [rango.desde, rango.hasta]);
  const [abierto, setAbierto] = useState(null);
  const atajo = (desde, hasta) => setRango({ desde, hasta });
  const primeroDelMes = sumarDias(hoy(), -(Number(hoy().slice(8)) - 1));

  return (
    <>
      <div className="herramientas">
        <Entrada etiqueta="Desde" type="date" value={rango.desde} max={rango.hasta} onChange={(e) => e.target.value && setRango({ ...rango, desde: e.target.value })} />
        <Entrada etiqueta="Hasta" type="date" value={rango.hasta} min={rango.desde} onChange={(e) => e.target.value && setRango({ ...rango, hasta: e.target.value })} />
        <Boton onClick={() => atajo(primeroDelMes, hoy())}>Este mes</Boton>
        <Boton onClick={() => atajo(sumarDias(hoy(), -6), hoy())}>Últimos 7 días</Boton>
      </div>
      <Estado carga={carga} vacio={carga.datos?.empleados.length === 0 ? 'No hay jornadas en este período.' : null}>
        {(d) => (
          <>
            <div className="sumario"><span>Total del período: <b>{horas(d.minutos_total)}</b></span>
              <Boton className="btn-chico" onClick={() => descargarCsv(`horas-${d.desde}-a-${d.hasta}.csv`, [['Empleado', 'Rol', 'Jornadas', 'Producción (h)', 'Servicio (h)', 'Total (h)'], ...d.empleados.map((e) => [e.nombre, ROLES[e.rol], e.jornadas, horasDecimal(e.por_turno.produccion), horasDecimal(e.por_turno.servicio), horasDecimal(e.minutos)])])}>Descargar planilla (CSV)</Boton></div>
            <div className="tabla-caja"><table>
              <thead><tr><th>Empleado</th><th>Rol</th><th className="num">Jornadas</th><th className="num">Producción</th><th className="num">Servicio</th><th className="num">Total</th></tr></thead>
              <tbody>{d.empleados.map((e) => (
                <Fragment key={e.id_usuario}>
                  <tr>
                    <td><button className="btn btn-chico" aria-expanded={abierto === e.id_usuario} onClick={() => setAbierto(abierto === e.id_usuario ? null : e.id_usuario)}>{abierto === e.id_usuario ? '▾' : '▸'}</button> <b>{e.nombre}</b></td>
                    <td>{ROLES[e.rol]}</td><td className="num">{e.jornadas}{e.abiertas > 0 && <> <Chip tono="agua">{e.abiertas} abierta</Chip></>}</td>
                    <td className="num">{horas(e.por_turno.produccion)}</td><td className="num">{horas(e.por_turno.servicio)}</td><td className="num"><b>{horas(e.minutos)}</b></td>
                  </tr>
                  {abierto === e.id_usuario && (
                    <tr className="expandido"><td colSpan="6">
                      <div className="barritas">{Object.entries(e.por_dia).sort().map(([dia, min]) => <span key={dia}>{diaYFecha(dia)}: <b>{horas(min)}</b></span>)}</div>
                      <small className="ayuda">Cada jornada cuenta en el día en que empezó, aunque termine de madrugada.</small>
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table></div>
          </>
        )}
      </Estado>
    </>
  );
}

function Jornadas() {
  const [rango, setRango] = useState({ desde: sumarDias(hoy(), -6), hasta: hoy() });
  const carga = useCarga(() => get('/fichajes', rango), [rango.desde, rango.hasta]);
  const usuarios = useCarga(() => get('/usuarios'), []);
  const [modal, setModal] = useState(null);
  const avisar = useAviso();
  return (
    <>
      <div className="herramientas">
        <Entrada etiqueta="Desde" type="date" value={rango.desde} max={rango.hasta} onChange={(e) => e.target.value && setRango({ ...rango, desde: e.target.value })} />
        <Entrada etiqueta="Hasta" type="date" value={rango.hasta} min={rango.desde} onChange={(e) => e.target.value && setRango({ ...rango, hasta: e.target.value })} />
        <Boton tipo="primario" onClick={() => setModal({})} disabled={!usuarios.datos}>Cargar jornada a mano</Boton>
      </div>
      <Estado carga={carga} vacio={carga.datos?.fichajes.length === 0 ? 'No hay jornadas en este período.' : null}>
        {(d) => (
          <div className="tabla-caja"><table>
            <thead><tr><th>Empleado</th><th>Turno</th><th>Ingreso</th><th>Egreso</th><th className="num">Horas</th><th /></tr></thead>
            <tbody>{d.fichajes.map((j) => (
              <tr key={j.id}><td><b>{j.nombre}</b><br /><small className="ayuda">{ROLES[j.rol]}</small></td><td>{TURNOS[j.turno]}</td><td>{fechaHora(j.ingreso)}</td>
                <td>{j.egreso ? fechaHora(j.egreso) : <Chip tono={j.posible_olvido ? 'malo' : 'agua'}>{j.posible_olvido ? '¿sin egreso?' : 'en curso'}</Chip>}</td>
                <td className="num">{horas(j.minutos)} {j.manual && <Chip>manual</Chip>}</td>
                <td className="num"><Boton className="btn-chico" onClick={() => setModal(j)}>Corregir</Boton></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Estado>
      {modal && <FormJornada jornada={modal} usuarios={(usuarios.datos ?? []).filter((u) => u.activo)} onCerrar={() => setModal(null)} onListo={() => { setModal(null); avisar('Jornada guardada'); carga.recargar(); }} />}
    </>
  );
}

function FormJornada({ jornada, usuarios, onCerrar, onListo }) {
  const nueva = !jornada.id;
  const [f, setF] = useState({ id_usuario: jornada.id_usuario ? String(jornada.id_usuario) : '', turno: jornada.turno ?? 'servicio', ingreso: aInputLocal(jornada.ingreso), egreso: aInputLocal(jornada.egreso), nota: jornada.nota ?? '' });
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const set = (c) => (e) => setF({ ...f, [c]: e.target.value });
  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    const cuerpo = { turno: f.turno, ingreso: deInputLocal(f.ingreso), egreso: deInputLocal(f.egreso), nota: f.nota.trim() };
    try { await (nueva ? post('/fichajes', { ...cuerpo, id_usuario: Number(f.id_usuario) }) : patch(`/fichajes/${jornada.id}`, cuerpo)); onListo(); }
    catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { general: err.message }); setEnviando(false); }
  }
  return (
    <Modal titulo={nueva ? 'Cargar jornada a mano' : `Corregir jornada de ${jornada.nombre}`} onCerrar={onCerrar} ancho="chico">
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        {errores.general && <div className="caja-error" role="alert">{errores.general}</div>}
        {nueva && <Selector etiqueta="Empleado" required value={f.id_usuario} onChange={set('id_usuario')} error={errores.id_usuario}><option value="">Elegí…</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({ROLES[u.rol]})</option>)}</Selector>}
        <Selector etiqueta="Turno" value={f.turno} onChange={set('turno')}>{Object.entries(TURNOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</Selector>
        <Entrada etiqueta="Ingreso" type="datetime-local" required value={f.ingreso} onChange={set('ingreso')} error={errores.ingreso} />
        <Entrada etiqueta="Egreso" type="datetime-local" value={f.egreso} onChange={set('egreso')} error={errores.egreso} ayuda="Vacío si todavía está trabajando." />
        <Entrada etiqueta="Motivo de la corrección" maxLength={300} value={f.nota} onChange={set('nota')} error={errores.nota} />
        <Boton tipo="primario" type="submit" cargando={enviando}>Guardar</Boton>
      </form>
    </Modal>
  );
}
void hora;
