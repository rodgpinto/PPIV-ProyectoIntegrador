import { useState } from 'react';
import { get, patch, post } from '../api.js';
import { Boton, Chip, Encabezado, Entrada, Estado, Modal, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

export function Proveedores() {
  const avisar = useAviso();
  const carga = useCarga(() => get('/proveedores'), []);
  const [modal, setModal] = useState(null);

  async function cambiarActivo(p) {
    try { await patch(`/proveedores/${p.id}`, { activo: !p.activo }); avisar(p.activo ? 'Proveedor dado de baja' : 'Proveedor reactivado'); carga.recargar(); }
    catch (e) { avisar(e.message, 'error'); }
  }

  return (
    <>
      <Encabezado titulo="Proveedores" sub="A quién le comprás. El costo de cada insumo se actualiza con la última compra.">
        <Boton tipo="primario" onClick={() => setModal({})}>Nuevo proveedor</Boton>
      </Encabezado>
      <Estado carga={carga} vacio={carga.datos?.length === 0 ? 'Todavía no cargaste proveedores.' : null}>
        {(lista) => (
          <div className="tabla-caja"><table>
            <thead><tr><th>Nombre</th><th>Contacto</th><th>Teléfono</th><th>Notas</th><th /></tr></thead>
            <tbody>{lista.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td><b>{p.nombre}</b> {!p.activo && <Chip>de baja</Chip>}</td><td>{p.contacto || '—'}</td><td>{p.telefono || '—'}</td><td>{p.notas || '—'}</td>
                <td className="num"><Boton className="btn-chico" onClick={() => setModal(p)}>Editar</Boton> <Boton className="btn-chico" onClick={() => cambiarActivo(p)}>{p.activo ? 'Dar de baja' : 'Reactivar'}</Boton></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Estado>
      {modal && <FormProveedor proveedor={modal} onCerrar={() => setModal(null)} onListo={() => { setModal(null); avisar('Proveedor guardado'); carga.recargar(); }} />}
    </>
  );
}

function FormProveedor({ proveedor, onCerrar, onListo }) {
  const nuevo = !proveedor.id;
  const [f, setF] = useState({ nombre: proveedor.nombre ?? '', contacto: proveedor.contacto ?? '', telefono: proveedor.telefono ?? '', notas: proveedor.notas ?? '' });
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const set = (c) => (e) => setF({ ...f, [c]: e.target.value });
  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    try { await (nuevo ? post('/proveedores', f) : patch(`/proveedores/${proveedor.id}`, f)); onListo(); }
    catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { nombre: err.message }); setEnviando(false); }
  }
  return (
    <Modal titulo={nuevo ? 'Nuevo proveedor' : `Editar ${proveedor.nombre}`} onCerrar={onCerrar}>
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        <Entrada etiqueta="Nombre" required value={f.nombre} onChange={set('nombre')} error={errores.nombre} />
        <div className="filas"><Entrada etiqueta="Contacto" value={f.contacto} onChange={set('contacto')} error={errores.contacto} /><Entrada etiqueta="Teléfono" value={f.telefono} onChange={set('telefono')} error={errores.telefono} /></div>
        <Entrada etiqueta="Notas" value={f.notas} onChange={set('notas')} error={errores.notas} />
        <Boton tipo="primario" type="submit" cargando={enviando}>Guardar</Boton>
      </form>
    </Modal>
  );
}
