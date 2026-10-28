import { useMemo, useState } from 'react';
import { del, get, patch, post } from '../api.js';
import { useSesion } from '../app.jsx';
import { fechaHora, hora, horas, minutosDesde, pesos } from '../fmt.js';
import { MoverCuenta, MoverLineas } from './mover.jsx';
import { VerTicket } from './ticket.jsx';
import { Boton, Chip, Confirmar, Encabezado, Entrada, Estado, Modal, Pestanas, useAviso, useCarga } from '../ui.jsx';

const ETIQUETA_ESTADO = { pendiente: ['En espera', 'neutro'], preparando: ['Preparando', 'aviso'], listo: ['Listo para llevar', 'agua'], entregado: ['Entregado', 'ok'], anulado: ['Anulado', 'malo'] };
const MEDIOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta (POS)', mercado_pago: 'Mercado Pago', transferencia: 'Transferencia' };
const nombreDe = (c) => (c.canal === 'mesa' ? c.mesa : c.etiqueta || 'Barra');

/** Cuentas abiertas de mesas y barra: tomar pedidos, entregar lo que está listo y cobrar. */
export function Pedidos() {
  const { usuario } = useSesion();
  const avisar = useAviso();
  const [tab, setTab] = useState('abiertas');
  const abiertas = useCarga(() => get('/pedidos'), [], { cada: 8000 });
  const cerradas = useCarga(() => (tab === 'cerradas' ? get('/pedidos', { estado: 'cerrado' }) : Promise.resolve(null)), [tab]);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null); // 'nueva' | 'agregar' | 'cobrar' | {anular: item} | 'cancelar'
  const [destinoNuevo, setDestinoNuevo] = useState(null);
  const [ticket, setTicket] = useState(null); // { cuenta, titulo } para la vista de impresión

  const lista = abiertas.datos ?? [];
  const cuenta = lista.find((c) => c.id === sel) ?? null;
  const listos = lista.reduce((s, c) => s + c.items.filter((i) => i.estado === 'listo').length, 0);

  async function accion(promesa, ok) {
    try { await promesa; if (ok) avisar(ok); await abiertas.recargar(); return true; }
    catch (e) { avisar(e.message, 'error'); abiertas.recargar(); return false; }
  }
  const cambiar = (ids, estado, ok) => accion(patch('/pedido-items/estado', { ids, estado }), ok);

  return (
    <>
      <Encabezado titulo="Pedidos" sub="Cuentas abiertas de mesas y barra. Lo que está listo en cocina o barra aparece resaltado para llevarlo.">
        <Boton tipo="primario" onClick={() => setModal('nueva')}>Nueva cuenta</Boton>
      </Encabezado>
      <Pestanas valor={tab} onCambio={(t) => { setTab(t); setSel(null); }} opciones={[['abiertas', 'Abiertas', listos || null], ['cerradas', 'Cobradas esta noche']]} />

      {tab === 'abiertas' && (
        <Estado carga={abiertas}>
          {() => (
            <div className={`pedidos-layout ${cuenta ? 'con-seleccion' : ''}`}>
              <div className="pedidos-lista">
                {lista.length === 0 && <p className="vacio">No hay cuentas abiertas. Tocá «Nueva cuenta» para empezar.</p>}
                {lista.map((c) => {
                  const vivos = c.items.filter((i) => i.estado !== 'anulado');
                  const nListos = vivos.filter((i) => i.estado === 'listo').length;
                  const nEspera = vivos.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando').length;
                  return (
                    <button key={c.id} className={`ficha-cuenta ${c.id === sel ? 'ficha-sel' : ''} ${nListos ? 'ficha-lista' : ''}`} onClick={() => setSel(c.id)}>
                      <span className="cuenta-titulo"><b>{nombreDe(c)}</b><span>{pesos(c.total)}</span></span>
                      <span className="cuenta-sub">{c.canal === 'barra' ? 'Barra' : 'Mesa'} · {c.mozo} · hace {horas(minutosDesde(c.creado_en))}</span>
                      <span className="cuenta-chips">
                        {nListos > 0 && <Chip tono="agua">{nListos} para llevar</Chip>}
                        {nEspera > 0 && <Chip tono="neutro">{nEspera} en preparación</Chip>}
                        {nListos === 0 && nEspera === 0 && vivos.length > 0 && <Chip tono="ok">todo entregado</Chip>}
                      </span>
                    </button>
                  );
                })}
              </div>

              {cuenta && (
                <section className="tarjeta cuenta-detalle" aria-label={`Cuenta de ${nombreDe(cuenta)}`}>
                  <div className="cuenta-cab">
                    <button className="btn btn-chico volver" onClick={() => setSel(null)}>← Cuentas</button>
                    <h2>{nombreDe(cuenta)}</h2>
                    <span className="cuenta-total">{pesos(cuenta.total)}</span>
                  </div>
                  <p className="ayuda">Abierta a las {hora(cuenta.creado_en)} por {cuenta.mozo}</p>
                  <div className="tabla-caja"><table>
                    <thead><tr><th>Pedido</th><th>Estado</th><th className="num">Importe</th><th /></tr></thead>
                    <tbody>
                      {[...cuenta.items].sort((a, b) => (a.estado === 'anulado') - (b.estado === 'anulado') || a.id - b.id).map((i) => (
                        <tr key={i.id} className={i.estado === 'anulado' ? 'anulado' : ''}>
                          <td><b>{i.cantidad} ×</b> {i.nombre}{i.nota && <><br /><small className="ayuda">«{i.nota}»</small></>}</td>
                          <td><Chip tono={ETIQUETA_ESTADO[i.estado][1]}>{ETIQUETA_ESTADO[i.estado][0]}</Chip></td>
                          <td className="num">{pesos(i.precio_unitario * i.cantidad)}</td>
                          <td className="num">
                            {i.estado === 'listo' && <Boton tipo="primario" className="btn-chico" onClick={() => cambiar([i.id], 'entregado')}>Entregar</Boton>}
                            {(i.estado === 'pendiente' || (i.estado !== 'entregado' && i.estado !== 'anulado' && usuario.rol === 'administrador')) && (
                              <Boton className="btn-chico" onClick={() => setModal({ anular: i })}>Anular</Boton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                  <div className="acciones" style={{ marginTop: '.9rem' }}>
                    <Boton onClick={() => setModal('agregar')}>+ Agregar productos</Boton>
                    <Boton onClick={() => setModal('mover')}>Pasar a otra mesa</Boton>
                    {cuenta.items.filter((i) => i.estado !== 'anulado').length > 0 && <Boton onClick={() => setModal('mover-lineas')}>Pasar productos</Boton>}
                    {cuenta.items.filter((i) => i.estado !== 'anulado').length > 0 && <Boton onClick={() => setTicket({ cuenta, titulo: `Pre-cuenta · ${nombreDe(cuenta)}` })}>Imprimir cuenta</Boton>}
                    {cuenta.items.some((i) => i.estado === 'listo') && (
                      <Boton onClick={() => cambiar(cuenta.items.filter((i) => i.estado === 'listo').map((i) => i.id), 'entregado', 'Entregado')}>Entregar todo lo listo</Boton>
                    )}
                    {cuenta.items.every((i) => i.estado === 'anulado')
                      ? <Boton onClick={() => setModal('cancelar')}>Cancelar cuenta</Boton>
                      : <Boton tipo="primario" onClick={() => setModal('cobrar')}>Cobrar {pesos(cuenta.total)}</Boton>}
                  </div>
                </section>
              )}
            </div>
          )}
        </Estado>
      )}

      {tab === 'cerradas' && (
        <Estado carga={cerradas} vacio={cerradas.datos?.length === 0 ? 'Todavía no se cobró ninguna cuenta.' : null}>
          {(lista_) => (
            <div className="tabla-caja"><table>
              <thead><tr><th>Cuenta</th><th>Cerrada</th><th>Medio</th><th>Atendió</th><th className="num">Total</th><th /></tr></thead>
              <tbody>{lista_.map((c) => <tr key={c.id}><td><b>{nombreDe(c)}</b></td><td>{fechaHora(c.cerrado_en)}</td><td>{MEDIOS[c.medio_pago]}</td><td>{c.mozo}</td><td className="num">{pesos(c.total)}</td><td className="num"><Boton className="btn-chico" onClick={() => setTicket({ cuenta: c, titulo: `Ticket · ${nombreDe(c)}` })}>Ticket</Boton></td></tr>)}</tbody>
            </table></div>
          )}
        </Estado>
      )}

      {modal === 'nueva' && (
        <NuevaCuenta abiertas={lista} onCerrar={() => setModal(null)}
          onAbrirExistente={(id) => { setModal(null); setSel(id); }}
          onElegir={(destino) => { setModal(null); setDestinoNuevo(destino); }} />
      )}
      {destinoNuevo && (
        <SelectorProductos titulo={`Nueva cuenta · ${destinoNuevo.canal === 'mesa' ? destinoNuevo.nombre : destinoNuevo.etiqueta || 'Barra'}`} onCerrar={() => setDestinoNuevo(null)}
          onEnviar={(items) => post('/pedidos', { canal: destinoNuevo.canal, id_mesa: destinoNuevo.id_mesa, etiqueta: destinoNuevo.etiqueta, items })}
          onListo={async (p) => { setDestinoNuevo(null); await abiertas.recargar(); setSel(p.id); }} />
      )}
      {modal === 'agregar' && cuenta && (
        <SelectorProductos titulo={`Agregar a ${nombreDe(cuenta)}`} onCerrar={() => setModal(null)}
          onEnviar={(items) => post(`/pedidos/${cuenta.id}/items`, { items })}
          onListo={async () => { setModal(null); await abiertas.recargar(); }} />
      )}
      {modal === 'mover' && cuenta && (
        <MoverCuenta cuenta={cuenta} abiertas={lista} onCerrar={() => setModal(null)}
          onListo={async (p) => { setModal(null); await abiertas.recargar(); setSel(p.id); }} />
      )}
      {modal === 'mover-lineas' && cuenta && (
        <MoverLineas cuenta={cuenta} abiertas={lista} onCerrar={() => setModal(null)}
          onListo={async (r) => { setModal(null); await abiertas.recargar(); setSel(r.origen_cancelada ? r.pedido.id : cuenta.id); }} />
      )}
      {modal === 'cobrar' && cuenta && <Cobrar cuenta={cuenta} onCerrar={() => setModal(null)} onListo={async (cobrada) => { setModal(null); setSel(null); avisar(`Cuenta cobrada: ${pesos(cuenta.total)}`); setTicket({ cuenta: { ...cuenta, ...cobrada, estado: 'cerrado', items: cobrada?.items ?? cuenta.items }, titulo: `Cuenta cobrada · ${nombreDe(cuenta)}` }); await abiertas.recargar(); }} />}
      {ticket && <VerTicket cuenta={ticket.cuenta} titulo={ticket.titulo} onCerrar={() => setTicket(null)} />}
      {modal?.anular && (
        <Confirmar titulo="Anular pedido" peligro confirmar="Anular" onNo={() => setModal(null)}
          texto={modal.anular.estado === 'pendiente'
            ? `Se anula «${modal.anular.cantidad} × ${modal.anular.nombre}» y los ingredientes vuelven al stock.`
            : `«${modal.anular.nombre}» ya se empezó a preparar: se anula pero el stock NO vuelve. Si se tiró, registralo como merma.`}
          onSi={async () => { await accion(del(`/pedido-items/${modal.anular.id}`), 'Pedido anulado'); setModal(null); }} />
      )}
      {modal === 'cancelar' && cuenta && (
        <Confirmar titulo="Cancelar cuenta" confirmar="Cancelar cuenta" peligro onNo={() => setModal(null)} texto="La cuenta no tiene consumos. Se cierra sin cobrar y la mesa queda libre."
          onSi={async () => { await accion(post(`/pedidos/${cuenta.id}/cancelar`), 'Cuenta cancelada'); setModal(null); setSel(null); }} />
      )}
    </>
  );
}

function NuevaCuenta({ abiertas, onCerrar, onAbrirExistente, onElegir }) {
  const mesas = useCarga(() => get('/mesas'), []);
  const [canal, setCanal] = useState('mesa');
  const [etiqueta, setEtiqueta] = useState('');
  const conCuenta = new Map(abiertas.filter((c) => c.id_mesa).map((c) => [c.id_mesa, c.id]));
  return (
    <Modal titulo="Nueva cuenta" onCerrar={onCerrar} ancho="normal">
      <Pestanas valor={canal} onCambio={setCanal} opciones={[['mesa', 'Mesa'], ['barra', 'Barra']]} />
      {canal === 'mesa' ? (
        <Estado carga={mesas}>
          {({ mesas: lista }) => ['interior', 'exterior'].map((zona) => (
            <div key={zona}>
              <h3 style={{ margin: '.2rem 0 .5rem' }}>{zona === 'interior' ? 'Interior' : 'Exterior'}</h3>
              <div className="mesas">
                {lista.filter((m) => m.zona === zona && m.activo).map((m) => (
                  <button key={m.id} className={`mesa ${conCuenta.has(m.id) ? 'mesa-ocupada' : 'mesa-libre'}`}
                    onClick={() => (conCuenta.has(m.id) ? onAbrirExistente(conCuenta.get(m.id)) : onElegir({ canal: 'mesa', id_mesa: m.id, nombre: m.nombre }))}>
                    <div><b>{m.nombre}</b><small>{m.capacidad} lugares</small></div>
                    <span className="estado">{conCuenta.has(m.id) ? 'Con cuenta · abrir' : 'Sin cuenta'}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Estado>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); onElegir({ canal: 'barra', etiqueta: etiqueta.trim() }); }} className="modal-cuerpo" style={{ padding: 0 }}>
          <Entrada etiqueta="A nombre de / lugar en la barra (opcional)" maxLength={40} value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Ej.: Barra 3, Martina" />
          <Boton tipo="primario" type="submit">Continuar</Boton>
        </form>
      )}
    </Modal>
  );
}

// Aclaraciones frecuentes para cocina y barra: un toque las suma a la nota de la línea.
const NOTAS_RAPIDAS = ['sin sal', 'sin picante', 'sin cebolla', 'sin gluten (celíaco)', 'sin lácteos', 'sin hielo'];
const agregarNota = (actual, nueva) => {
  const partes = actual.split(',').map((x) => x.trim()).filter(Boolean);
  return (partes.includes(nueva) ? partes : [...partes, nueva]).join(', ').slice(0, 200);
};

/** Carta para armar el pedido: se toca un producto para sumarlo; abajo queda el resumen. */
function SelectorProductos({ titulo, onCerrar, onEnviar, onListo }) {
  const avisar = useAviso();
  const productos = useCarga(() => get('/productos'), []);
  const [cat, setCat] = useState(null);
  const [carrito, setCarrito] = useState([]); // [{id_producto, nombre, precio, cantidad, nota}]
  const [enviando, setEnviando] = useState(false);
  const categorias = useMemo(() => [...new Set((productos.datos ?? []).map((p) => p.categoria))], [productos.datos]);
  const actual = cat ?? categorias[0];
  const total = carrito.reduce((s, l) => s + l.precio * l.cantidad, 0);

  const sumar = (p, n = 1) => setCarrito((c) => {
    const i = c.findIndex((l) => l.id_producto === p.id_producto && !l.nota);
    if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: Math.max(0, l.cantidad + n) } : l)).filter((l) => l.cantidad > 0);
    return n > 0 ? [...c, { ...p, cantidad: n, nota: '' }] : c;
  });
  const cambiarLinea = (idx, cambios) => setCarrito((c) => c.map((l, j) => (j === idx ? { ...l, ...cambios } : l)).filter((l) => l.cantidad > 0));

  async function enviar() {
    setEnviando(true);
    try {
      const r = await onEnviar(carrito.map((l) => ({ id_producto: l.id_producto, cantidad: l.cantidad, ...(l.nota.trim() ? { nota: l.nota.trim() } : {}) })));
      avisar('Pedido enviado');
      if (r.sin_stock?.length) avisar(`Atención: no hay stock registrado de ${r.sin_stock.map((s) => s.nombre).join(', ')}. Se vendió igual; cargá la mercadería cuando llegue.`, 'aviso');
      onListo(r);
    } catch (e) {
      avisar(e.message, 'error');
      if (e.status === 409 && e.detalles?.id_pedido) onListo({ id: e.detalles.id_pedido });
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ancho="ancho" pie={<>
      <span style={{ marginRight: 'auto', fontSize: '1.15rem' }}><b>{pesos(total)}</b></span>
      <Boton onClick={onCerrar}>Cancelar</Boton>
      <Boton tipo="primario" cargando={enviando} disabled={!carrito.length} onClick={enviar}>Enviar pedido</Boton>
    </>}>
      <Estado carga={productos}>
        {(lista) => (
          <div className="picker">
            <div>
              <div className="pestanas" role="tablist">{categorias.map((c) => <button key={c} role="tab" aria-selected={c === actual} className={c === actual ? 'activa' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
              <div className="productos-grid">
                {lista.filter((p) => p.categoria === actual).map((p) => {
                  const en = carrito.filter((l) => l.id_producto === p.id).reduce((s, l) => s + l.cantidad, 0);
                  return (
                    <button key={p.id} className={`producto-btn ${en ? 'producto-en' : ''}`} onClick={() => sumar({ id_producto: p.id, nombre: p.nombre, precio: p.precio })}>
                      <b>{p.nombre}</b><span>{pesos(p.precio)}</span>
                      <small>{p.destino === 'barra' ? 'Barra' : 'Cocina'}</small>
                      {en > 0 && <span className="producto-cant">{en}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="carrito">
              <h3>Pedido</h3>
              {carrito.length === 0 ? <p className="ayuda">Tocá los productos para sumarlos.</p> : carrito.map((l, idx) => (
                <div className="carrito-linea" key={`${l.id_producto}-${idx}`}>
                  <div className="carrito-cab"><b>{l.nombre}</b><span>{pesos(l.precio * l.cantidad)}</span></div>
                  <div className="carrito-ctl">
                    <button className="btn btn-chico" aria-label={`Quitar uno de ${l.nombre}`} onClick={() => cambiarLinea(idx, { cantidad: l.cantidad - 1 })}>−</button>
                    <span className="cant">{l.cantidad}</span>
                    <button className="btn btn-chico" aria-label={`Sumar uno de ${l.nombre}`} onClick={() => cambiarLinea(idx, { cantidad: Math.min(50, l.cantidad + 1) })}>+</button>
                    <input placeholder="Nota (sin hielo, punto…)" aria-label={`Nota para ${l.nombre}`} maxLength={200} value={l.nota} onChange={(e) => cambiarLinea(idx, { nota: e.target.value })} />
                  </div>
                  <div className="notas-rapidas">
                    {NOTAS_RAPIDAS.map((n) => (
                      <button type="button" key={n} className="chip-nota" onClick={() => cambiarLinea(idx, { nota: agregarNota(l.nota, n) })}>{n}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Estado>
    </Modal>
  );
}

function Cobrar({ cuenta, onCerrar, onListo }) {
  const avisar = useAviso();
  const [medio, setMedio] = useState('efectivo');
  const [enviando, setEnviando] = useState(false);
  const sinTerminar = cuenta.items.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando');
  async function enviar() {
    setEnviando(true);
    try { const r = await post(`/pedidos/${cuenta.id}/cerrar`, { medio_pago: medio }); onListo(r); }
    catch (e) { avisar(e.message, 'error'); setEnviando(false); }
  }
  return (
    <Modal titulo={`Cobrar ${nombreDe(cuenta)}`} onCerrar={onCerrar} ancho="chico" pie={<><Boton onClick={onCerrar}>Volver</Boton><Boton tipo="primario" cargando={enviando} disabled={sinTerminar.length > 0} onClick={enviar}>Confirmar cobro</Boton></>}>
      <p className="cobro-total">{pesos(cuenta.total)}</p>
      {sinTerminar.length > 0 && <div className="nota">Todavía hay {sinTerminar.length} {sinTerminar.length === 1 ? 'pedido' : 'pedidos'} sin terminar. Esperá a que estén listos o anulalos.</div>}
      <div role="radiogroup" aria-label="Medio de pago" className="opciones-turno" style={{ margin: 0 }}>
        {Object.entries(MEDIOS).map(([k, t]) => <label key={k} className="opcion-turno"><input type="radio" name="medio" checked={medio === k} onChange={() => setMedio(k)} />{t}</label>)}
      </div>
      <p className="ayuda">El sistema registra el cobro. El pago con POS o Mercado Pago se hace por fuera; acá solo se anota el medio.</p>
    </Modal>
  );
}
