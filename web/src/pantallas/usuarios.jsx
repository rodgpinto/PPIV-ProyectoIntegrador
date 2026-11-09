import { useState } from 'react';
import { get, patch, post } from '../api.js';
import { useSesion } from '../app.jsx';
import { LISTA_ROLES, ROLES } from '../fmt.js';
import { Boton, Chip, Confirmar, Encabezado, Entrada, Estado, Modal, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

export function Usuarios() {
  const { usuario: yo } = useSesion();
  const avisar = useAviso();
  const carga = useCarga(() => get('/usuarios'), []);
  const [modal, setModal] = useState(null); // {tipo, usuario}
  const [verInactivos, setVerInactivos] = useState(true);

  async function cambiarActivo(u) {
    try { await patch(`/usuarios/${u.id}`, { activo: !u.activo }); avisar(u.activo ? `${u.nombre} fue dado de baja y se cerraron sus sesiones` : `${u.nombre} fue reactivado`); setModal(null); carga.recargar(); }
    catch (e) { avisar(e.message, 'error'); setModal(null); }
  }

  return (
    <>
      <Encabezado titulo="Empleados" sub="Altas, bajas, roles y contraseñas. Los cambios rigen de inmediato.">
        <Boton tipo="primario" onClick={() => setModal({ tipo: 'alta' })}>Nuevo empleado</Boton>
      </Encabezado>
      <div className="fila-check" style={{ marginBottom: '.6rem' }}><input id="ver-inact" type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /><label htmlFor="ver-inact">Mostrar dados de baja</label></div>
      <Estado carga={carga}>
        {(lista) => (
          <div className="tabla-caja"><table>
            <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th /></tr></thead>
            <tbody>{lista.filter((u) => verInactivos || u.activo).map((u) => {
              const soyYo = u.id === yo.id;
              return (
                <tr key={u.id} className={u.activo ? '' : 'inactivo'}>
                  <td><b>{u.nombre}</b> {soyYo && <Chip tono="agua">vos</Chip>}</td><td>{u.email}</td><td>{ROLES[u.rol]}</td><td>{u.activo ? <Chip tono="ok">Activo</Chip> : <Chip>De baja</Chip>}</td>
                  <td className="num">
                    <Boton className="btn-chico" onClick={() => setModal({ tipo: 'editar', usuario: u })}>Editar / rol</Boton>{' '}
                    <Boton className="btn-chico" onClick={() => setModal({ tipo: 'clave', usuario: u })}>Cambiar contraseña</Boton>{' '}
                    {!soyYo && <Boton className="btn-chico" onClick={() => (u.activo ? setModal({ tipo: 'baja', usuario: u }) : cambiarActivo(u))}>{u.activo ? 'Dar de baja' : 'Reactivar'}</Boton>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Estado>
      {modal?.tipo === 'alta' && <FormAlta onCerrar={() => setModal(null)} onListo={() => { setModal(null); avisar('Empleado creado'); carga.recargar(); }} />}
      {modal?.tipo === 'editar' && <FormEditar usuario={modal.usuario} soyYo={modal.usuario.id === yo.id} onCerrar={() => setModal(null)} onListo={() => { setModal(null); avisar('Cambios guardados'); carga.recargar(); }} />}
      {modal?.tipo === 'clave' && <FormClave usuario={modal.usuario} onCerrar={() => setModal(null)} onListo={() => { setModal(null); avisar(`Contraseña de ${modal.usuario.nombre} cambiada. Se cerraron sus sesiones.`); }} />}
      {modal?.tipo === 'baja' && <Confirmar titulo={`Dar de baja a ${modal.usuario.nombre}`} texto="No va a poder ingresar y se cierran sus sesiones abiertas. Su historial de horas se conserva y podés reactivarlo cuando quieras." confirmar="Dar de baja" peligro onNo={() => setModal(null)} onSi={() => cambiarActivo(modal.usuario)} />}
    </>
  );
}

function useEnvio(accion, onListo) {
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  return {
    errores, enviando,
    async enviar(e) {
      e.preventDefault(); setEnviando(true); setErrores({});
      try { await accion(); onListo(); }
      catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { general: err.message }); setEnviando(false); }
    },
  };
}

function FormAlta({ onCerrar, onListo }) {
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'camarero' });
  const { errores, enviando, enviar } = useEnvio(() => post('/usuarios', { ...f, nombre: f.nombre.trim(), email: f.email.trim() }), onListo);
  const set = (c) => (e) => setF({ ...f, [c]: e.target.value });
  return (
    <Modal titulo="Nuevo empleado" onCerrar={onCerrar} ancho="chico">
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        {errores.general && <div className="caja-error" role="alert">{errores.general}</div>}
        <Entrada etiqueta="Nombre y apellido" required value={f.nombre} onChange={set('nombre')} error={errores.nombre} />
        <Entrada etiqueta="Email" type="email" required value={f.email} onChange={set('email')} error={errores.email} />
        <Selector etiqueta="Rol" value={f.rol} onChange={set('rol')}>{LISTA_ROLES.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}</Selector>
        <Entrada etiqueta="Contraseña inicial" type="text" autoComplete="off" required minLength={8} value={f.password} onChange={set('password')} error={errores.password} ayuda="Mínimo 8 caracteres. Pasásela y pedile que la cambie en «Mi cuenta»." />
        <Boton tipo="primario" type="submit" cargando={enviando}>Crear empleado</Boton>
      </form>
    </Modal>
  );
}

function FormEditar({ usuario, soyYo, onCerrar, onListo }) {
  const [f, setF] = useState({ nombre: usuario.nombre, rol: usuario.rol });
  const { errores, enviando, enviar } = useEnvio(() => patch(`/usuarios/${usuario.id}`, { nombre: f.nombre.trim(), rol: f.rol }), onListo);
  return (
    <Modal titulo={`Editar a ${usuario.nombre}`} onCerrar={onCerrar} ancho="chico">
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        {errores.general && <div className="caja-error" role="alert">{errores.general}</div>}
        <Entrada etiqueta="Nombre" required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} error={errores.nombre} />
        <Selector etiqueta="Rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} disabled={soyYo} ayuda={soyYo ? 'No podés cambiar tu propio rol.' : 'Cambia lo que ve y puede hacer, desde el próximo movimiento.'} error={errores.rol}>
          {LISTA_ROLES.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
        </Selector>
        <Boton tipo="primario" type="submit" cargando={enviando}>Guardar</Boton>
      </form>
    </Modal>
  );
}

function FormClave({ usuario, onCerrar, onListo }) {
  const [password, setPassword] = useState('');
  const { errores, enviando, enviar } = useEnvio(() => patch(`/usuarios/${usuario.id}`, { password }), onListo);
  return (
    <Modal titulo={`Nueva contraseña para ${usuario.nombre}`} onCerrar={onCerrar} ancho="chico">
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        {errores.general && <div className="caja-error" role="alert">{errores.general}</div>}
        <Entrada etiqueta="Contraseña nueva" type="text" autoComplete="off" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} error={errores.password} ayuda="Se cierran todas sus sesiones abiertas." />
        <Boton tipo="primario" type="submit" cargando={enviando}>Cambiar contraseña</Boton>
      </form>
    </Modal>
  );
}
