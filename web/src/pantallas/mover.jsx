import { useState } from 'react';
import { get, post } from '../api.js';
import { pesos } from '../fmt.js';
import { Boton, Chip, Estado, Modal, useAviso, useCarga } from '../ui.jsx';

const nombreDe = (c) => (c.canal === 'mesa' ? c.mesa : c.etiqueta || 'Barra');

/** Mesas para elegir destino: las libres, las que ya tienen cuenta (se unen) y, deshabilitada, la actual. */
function ElegirMesa({ abiertas, actual, textoLibre, textoConCuenta, onElegir, ocupado }) {
  const mesas = useCarga(() => get('/mesas'), []);
  const conCuenta = new Map(abiertas.filter((c) => c.id_mesa).map((c) => [c.id_mesa, c]));
  return (
    <Estado carga={mesas}>
      {({ mesas: lista }) => ['interior', 'exterior'].map((zona) => (
        <div key={zona}>
          <h3 style={{ margin: '.2rem 0 .5rem' }}>{zona === 'interior' ? 'Interior' : 'Exterior'}</h3>
          <div className="mesas">
            {lista.filter((m) => m.zona === zona && m.activo).map((m) => {
              const cuenta = conCuenta.get(m.id);
              const esActual = m.id === actual;
              return (
                <button key={m.id} type="button" disabled={esActual || ocupado} className={`mesa ${cuenta ? 'mesa-ocupada' : 'mesa-libre'}`} onClick={() => onElegir(m, cuenta)}>
                  <div><b>{m.nombre}</b><small>{m.capacidad} lugares</small></div>
                  <span className="estado">{esActual ? 'Mesa actual' : cuenta ? textoConCuenta : textoLibre}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Estado>
  );
}

/** Pasa toda la cuenta a otra mesa; si la mesa ya tiene cuenta, pregunta si se juntan. */
export function MoverCuenta({ cuenta, abiertas, onCerrar, onListo }) {
  const avisar = useAviso();
  const [uniendo, setUniendo] = useState(null); // { mesa, cuenta }
  const [enviando, setEnviando] = useState(false);

  async function mover(mesa, unir) {
    setEnviando(true);
    try {
      const r = await post(`/pedidos/${cuenta.id}/mover`, { id_mesa: mesa.id, ...(unir ? { unir: true } : {}) });
      avisar(r.unida ? `Se juntó con la cuenta de ${r.hacia}` : `Cuenta pasada a ${r.hacia}`);
      await onListo(r.pedido);
    } catch (e) { avisar(e.message, 'error'); setUniendo(null); } finally { setEnviando(false); }
  }

  if (uniendo) {
    return (
      <Modal titulo="¿Juntar las cuentas?" onCerrar={() => setUniendo(null)} ancho="chico" pie={<>
        <Boton onClick={() => setUniendo(null)}>Volver</Boton>
        <Boton tipo="primario" cargando={enviando} onClick={() => mover(uniendo.mesa, true)}>Juntar cuentas</Boton>
      </>}>
        <p>La mesa <b>{uniendo.mesa.nombre}</b> ya tiene una cuenta de {pesos(uniendo.cuenta.total)}. Todo lo de <b>{nombreDe(cuenta)}</b> ({pesos(cuenta.total)}) se suma a esa cuenta y {nombreDe(cuenta)} queda libre.</p>
      </Modal>
    );
  }
  return (
    <Modal titulo={`Pasar ${nombreDe(cuenta)} a otra mesa`} onCerrar={onCerrar}>
      <p className="ayuda">Elegí la mesa a la que se mueve toda la cuenta. Lo pedido sigue en cocina y barra con la mesa nueva.</p>
      <ElegirMesa abiertas={abiertas} actual={cuenta.id_mesa} ocupado={enviando} textoLibre="Libre · pasar acá" textoConCuenta="Con cuenta · juntar"
        onElegir={(mesa, otra) => (otra ? setUniendo({ mesa, cuenta: otra }) : mover(mesa, false))} />
    </Modal>
  );
}

/** Pasa algunas líneas a otra mesa (dividir la cuenta o corregir una carga en la mesa equivocada). */
export function MoverLineas({ cuenta, abiertas, onCerrar, onListo }) {
  const avisar = useAviso();
  const movibles = cuenta.items.filter((i) => i.estado !== 'anulado');
  const [marcadas, setMarcadas] = useState(new Set());
  const [enviando, setEnviando] = useState(false);
  const alternar = (id) => setMarcadas((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const suma = movibles.filter((i) => marcadas.has(i.id)).reduce((s, i) => s + i.precio_unitario * i.cantidad, 0);

  async function mover(mesa) {
    setEnviando(true);
    try {
      const r = await post(`/pedidos/${cuenta.id}/mover-items`, { ids: [...marcadas], id_mesa: mesa.id });
      avisar(`${marcadas.size} ${marcadas.size === 1 ? 'línea pasada' : 'líneas pasadas'} a ${r.hacia}${r.origen_cancelada ? ` · ${r.desde} quedó libre` : ''}`);
      await onListo(r);
    } catch (e) { avisar(e.message, 'error'); } finally { setEnviando(false); }
  }

  return (
    <Modal titulo={`Pasar productos de ${nombreDe(cuenta)}`} onCerrar={onCerrar} ancho="ancho">
      <p className="ayuda">Tildá lo que querés pasar y elegí la mesa. Si la mesa ya tiene cuenta se suma a esa; si no, se abre una nueva. Se pasan líneas completas.</p>
      <div className="tabla-caja"><table>
        <tbody>
          {movibles.map((i) => (
            <tr key={i.id}>
              <td style={{ width: 44 }}><input type="checkbox" id={`mv-${i.id}`} checked={marcadas.has(i.id)} onChange={() => alternar(i.id)} aria-label={`Pasar ${i.cantidad} ${i.nombre}`} /></td>
              <td><label htmlFor={`mv-${i.id}`}><b>{i.cantidad} ×</b> {i.nombre}{i.nota && <small className="ayuda"> «{i.nota}»</small>}</label></td>
              <td className="num">{pesos(i.precio_unitario * i.cantidad)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p><b>{marcadas.size}</b> {marcadas.size === 1 ? 'línea elegida' : 'líneas elegidas'}{marcadas.size > 0 && <> · {pesos(suma)} </>}{marcadas.size === movibles.length && marcadas.size > 0 && <Chip tono="aviso">toda la cuenta: {nombreDe(cuenta)} quedará libre</Chip>}</p>
      {marcadas.size > 0
        ? <ElegirMesa abiertas={abiertas} actual={cuenta.id_mesa} ocupado={enviando} textoLibre="Libre · abrir cuenta" textoConCuenta="Con cuenta · sumar" onElegir={(mesa) => mover(mesa)} />
        : <p className="vacio">Elegí al menos una línea.</p>}
    </Modal>
  );
}
