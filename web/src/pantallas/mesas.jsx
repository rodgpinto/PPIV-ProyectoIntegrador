import { useState } from 'react';
import { get, patch, post } from '../api.js';
import { useSesion } from '../app.jsx';
import { hora, minutosDesde, horas, ZONA } from '../fmt.js';
import { Boton, Confirmar, Encabezado, Entrada, Estado, Modal, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

const PUEDE_EDITAR = ['administrador', 'host', 'camarero', 'cajero'];

/** Tablero de mesas: el host ve qué hay libre; quien puede, toca la mesa para marcarla ocupada o libre. */
export function Mesas() {
  const { usuario } = useSesion();
  const avisar = useAviso();
  // Se consulta cada 10 s (y el ETag hace que, si nada cambió, la respuesta sea mínima). Más barato que mantener sockets abiertos.
  const carga = useCarga(() => get('/mesas'), [], { cada: 10000 });
  const [admin, setAdmin] = useState(false);
  const [ocupadas, setOcupadas] = useState(new Set());
  const editable = PUEDE_EDITAR.includes(usuario.rol);

  async function alternar(m) {
    const nuevo = m.estado === 'libre' ? 'ocupada' : 'libre';
    setOcupadas((s) => new Set(s).add(m.id));
    try { await patch(`/mesas/${m.id}/estado`, { estado: nuevo }); await carga.recargar(); }
    catch (e) { avisar(e.message, 'error'); }
    finally { setOcupadas((s) => { const n = new Set(s); n.delete(m.id); return n; }); }
  }

  return (
    <>
      <Encabezado titulo="Mesas" sub={editable ? 'Tocá una mesa para marcarla ocupada o libre.' : 'Disponibilidad en tiempo real (se actualiza sola).'}>
        {usuario.rol === 'administrador' && <Boton onClick={() => setAdmin(true)}>Administrar mesas</Boton>}
      </Encabezado>
      <Estado carga={carga}>
        {({ mesas, resumen }) => (
          <>
            <div className="resumen-aforo" aria-label="Resumen del aforo">
              <div className="dato"><b>{resumen.lugares_libres}</b><span>lugares libres de {resumen.aforo}</span></div>
              <div className="dato"><b>{resumen.interior.lugares_libres}</b><span>libres adentro</span></div>
              <div className="dato"><b>{resumen.exterior.lugares_libres}</b><span>libres afuera</span></div>
              <div className="dato"><b>{resumen.libres}/{resumen.mesas}</b><span>mesas libres</span></div>
            </div>
            {['interior', 'exterior'].map((zona) => {
              const lista = mesas.filter((m) => m.zona === zona && m.activo);
              return (
                <section className="zona" key={zona}>
                  <h2>{zona === 'interior' ? 'Interior' : 'Exterior'}</h2>
                  {lista.length === 0 ? <p className="vacio">No hay mesas en esta zona.</p> : (
                    <div className="mesas">
                      {lista.map((m) => {
                        const contenido = (
                          <>
                            <div><b>{m.nombre}</b><small>{m.capacidad} lugares</small></div>
                            <div>
                              <span className="estado">{m.estado === 'libre' ? 'Libre' : 'Ocupada'}</span>
                              {m.estado === 'ocupada' && <small>desde las {hora(m.estado_desde)} · {horas(minutosDesde(m.estado_desde))}</small>}
                            </div>
                          </>
                        );
                        const clase = `mesa mesa-${m.estado}`;
                        return editable
                          ? <button key={m.id} className={clase} disabled={ocupadas.has(m.id)} onClick={() => alternar(m)} aria-label={`${m.nombre}, ${m.capacidad} lugares, ${m.estado}. Tocar para cambiar`}>{contenido}</button>
                          : <div key={m.id} className={clase}>{contenido}</div>;
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            {admin && <AdminMesas mesas={mesas} onCerrar={() => { setAdmin(false); carga.recargar(); }} />}
          </>
        )}
      </Estado>
    </>
  );
}

function AdminMesas({ mesas, onCerrar }) {
  const avisar = useAviso();
  const [lista, setLista] = useState(mesas);
  const [edicion, setEdicion] = useState(null); // null | {} (nueva) | mesa
  const [baja, setBaja] = useState(null);

  async function recargar() { setLista((await get('/mesas')).mesas); }

  return (
    <Modal titulo="Administrar mesas" onCerrar={onCerrar} ancho="ancho" pie={<Boton onClick={() => setEdicion({})} tipo="primario">Nueva mesa</Boton>}>
      <div className="tabla-caja"><table>
        <thead><tr><th>Mesa</th><th>Zona</th><th className="num">Lugares</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {lista.map((m) => (
            <tr key={m.id} className={m.activo ? '' : 'inactivo'}>
              <td>{m.nombre}</td><td>{m.zona}</td><td className="num">{m.capacidad}</td><td>{m.activo ? 'Activa' : 'De baja'}</td>
              <td className="num">
                <Boton className="btn-chico" onClick={() => setEdicion(m)}>Editar</Boton>{' '}
                {m.activo
                  ? <Boton className="btn-chico" onClick={() => setBaja(m)}>Dar de baja</Boton>
                  : <Boton className="btn-chico" onClick={async () => { try { await patch(`/mesas/${m.id}`, { activo: true }); await recargar(); } catch (e) { avisar(e.message, 'error'); } }}>Reactivar</Boton>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {edicion && <FormMesa mesa={edicion} onCerrar={() => setEdicion(null)} onListo={async () => { setEdicion(null); await recargar(); avisar('Mesa guardada'); }} />}
      {baja && <Confirmar titulo={`Dar de baja ${baja.nombre}`} texto="La mesa deja de aparecer en el tablero y no cuenta para el aforo. Se puede reactivar cuando quieras." confirmar="Dar de baja" peligro
        onNo={() => setBaja(null)} onSi={async () => { try { await patch(`/mesas/${baja.id}`, { activo: false }); setBaja(null); await recargar(); } catch (e) { avisar(e.message, 'error'); } }} />}
    </Modal>
  );
}

function FormMesa({ mesa, onCerrar, onListo }) {
  const nueva = !mesa.id;
  const [f, setF] = useState({ nombre: mesa.nombre ?? '', zona: mesa.zona ?? 'interior', capacidad: mesa.capacidad ?? 2 });
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    const cuerpo = { nombre: f.nombre.trim(), zona: f.zona, capacidad: Number(f.capacidad) };
    try { await (nueva ? post('/mesas', cuerpo) : patch(`/mesas/${mesa.id}`, cuerpo)); onListo(); }
    catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { nombre: err.message }); setEnviando(false); }
  }
  return (
    <Modal titulo={nueva ? 'Nueva mesa' : `Editar ${mesa.nombre}`} onCerrar={onCerrar} ancho="chico">
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        <Entrada etiqueta="Nombre" required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} error={errores.nombre} />
        <Selector etiqueta="Zona" value={f.zona} onChange={(e) => setF({ ...f, zona: e.target.value })}><option value="interior">Interior</option><option value="exterior">Exterior</option></Selector>
        <Entrada etiqueta="Lugares" type="number" min="1" max="100" required value={f.capacidad} onChange={(e) => setF({ ...f, capacidad: e.target.value })} error={errores.capacidad} />
        <Boton tipo="primario" type="submit" cargando={enviando}>Guardar</Boton>
      </form>
    </Modal>
  );
}
void ZONA;
