import { useState } from 'react';
import { get, patch, post, put } from '../api.js';
import { costoDeEnvase } from '../../../src/domain/presentaciones.js';
import { fechaCorta, numero, pesosFino, UNIDADES, numeroDe } from '../fmt.js';
import { Boton, Cantidad, Chip, Encabezado, Entrada, Estado, Modal, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

export function Insumos() {
  const avisar = useAviso();
  const carga = useCarga(async () => { const [insumos, proveedores] = await Promise.all([get('/insumos'), get('/proveedores')]); return { insumos, proveedores }; }, []);
  const [modal, setModal] = useState(null);
  const [texto, setTexto] = useState('');

  return (
    <>
      <Encabezado titulo="Insumos" sub="Ingredientes y bebidas que usan las recetas, con sus mínimos y máximos.">
        <Boton tipo="primario" onClick={() => setModal({})}>Nuevo insumo</Boton>
      </Encabezado>
      <div className="herramientas"><Entrada etiqueta="Buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
      <Estado carga={carga} vacio={carga.datos?.insumos.length === 0 ? 'Todavía no cargaste insumos.' : null}>
        {({ insumos, proveedores }) => (
          <>
            <div className="tabla-caja"><table>
              <thead><tr><th>Insumo</th><th className="num">Stock</th><th className="num">Mín. / Máx.</th><th className="num">Costo unitario</th><th>Proveedor</th><th>Próx. vencimiento</th><th /></tr></thead>
              <tbody>{insumos.filter((i) => i.nombre.toLowerCase().includes(texto.toLowerCase())).map((i) => {
                const bajo = i.stock_actual < i.stock_minimo;
                const sobre = i.stock_maximo !== null && i.stock_actual > i.stock_maximo;
                return (
                  <tr key={i.id} className={i.activo ? '' : 'inactivo'}>
                    <td><b>{i.nombre}</b> {!i.activo && <Chip>de baja</Chip>}</td>
                    <td className="num"><Cantidad valor={i.stock_actual} insumo={i} /> {bajo && <Chip tono="malo">reponer</Chip>}{sobre && <Chip tono="aviso">de más</Chip>}</td>
                    <td className="num">{numero(i.stock_minimo)} / {i.stock_maximo === null ? '—' : numero(i.stock_maximo)}</td>
                    <td className="num">{pesosFino(i.costo_unitario)} / {UNIDADES[i.unidad]}</td>
                    <td>{i.proveedor ?? '—'}</td><td>{i.proximo_vencimiento ? fechaCorta(i.proximo_vencimiento) : '—'}</td>
                    <td className="num"><Boton className="btn-chico" onClick={() => setModal(i)}>Editar</Boton></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            {modal && <FormInsumo insumo={modal} proveedores={proveedores.filter((p) => p.activo || p.id === modal.id_proveedor)} onCerrar={() => setModal(null)} onListo={() => { setModal(null); avisar('Insumo guardado'); carga.recargar(); }} />}
          </>
        )}
      </Estado>
    </>
  );
}

function FormInsumo({ insumo, proveedores, onCerrar, onListo }) {
  const nuevo = !insumo.id;
  const compras = useCarga(() => (nuevo ? Promise.resolve(null) : get(`/insumos/${insumo.id}/compras`)), [insumo.id]);
  const [f, setF] = useState({
    nombre: insumo.nombre ?? '', unidad: insumo.unidad ?? 'g', costo_unitario: String(insumo.costo_unitario ?? 0),
    stock_minimo: String(insumo.stock_minimo ?? 0), stock_maximo: insumo.stock_maximo === null || insumo.stock_maximo === undefined ? '' : String(insumo.stock_maximo),
    dias_aviso_vencimiento: String(insumo.dias_aviso_vencimiento ?? 3), id_proveedor: insumo.id_proveedor ? String(insumo.id_proveedor) : '', activo: insumo.activo ?? true,
  });
  const [pres, setPres] = useState((insumo.presentaciones ?? []).map((p) => ({ nombre: p.nombre, cantidad: String(p.cantidad), principal: p.principal })));
  const setP = (i, campo, valor) => setPres((l) => l.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  const hacerPrincipal = (i) => setPres((l) => l.map((p, j) => ({ ...p, principal: j === i })));
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const set = (c) => (e) => setF({ ...f, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const n = (t) => numeroDe(t);

  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    const cuerpo = {
      nombre: f.nombre.trim(), costo_unitario: n(f.costo_unitario), stock_minimo: n(f.stock_minimo), stock_maximo: f.stock_maximo === '' ? null : n(f.stock_maximo),
      dias_aviso_vencimiento: Math.round(n(f.dias_aviso_vencimiento)), id_proveedor: f.id_proveedor ? Number(f.id_proveedor) : null,
    };
    const lista = pres.filter((p) => p.nombre.trim() || p.cantidad.trim());
    const malas = lista.findIndex((p) => !p.nombre.trim() || !(n(p.cantidad) > 0));
    if (malas >= 0) { setErrores({ presentaciones: `Revisá la presentación ${malas + 1}: necesita un nombre y una cantidad mayor a cero.` }); setEnviando(false); return; }
    try {
      const guardado = nuevo ? await post('/insumos', { ...cuerpo, unidad: f.unidad }) : await patch(`/insumos/${insumo.id}`, { ...cuerpo, activo: f.activo });
      await put(`/insumos/${guardado.id}/presentaciones`, { presentaciones: lista.map((p) => ({ nombre: p.nombre.trim(), cantidad: n(p.cantidad), principal: Boolean(p.principal) })) });
      onListo();
    } catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { nombre: err.message }); setEnviando(false); }
  }
  const u = UNIDADES[f.unidad];

  return (
    <Modal titulo={nuevo ? 'Nuevo insumo' : `Editar ${insumo.nombre}`} onCerrar={onCerrar} ancho="ancho" pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton tipo="primario" cargando={enviando} onClick={enviar}>Guardar</Boton></>}>
      <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
        <div className="filas">
          <Entrada etiqueta="Nombre" required value={f.nombre} onChange={set('nombre')} error={errores.nombre} />
          <Selector etiqueta="Unidad" value={f.unidad} onChange={set('unidad')} disabled={!nuevo} ayuda={nuevo ? 'No se puede cambiar después.' : undefined}>
            <option value="ml">ml (líquidos)</option><option value="g">g (sólidos)</option><option value="unidad">unidad</option>
          </Selector>
          <Selector etiqueta="Proveedor habitual" value={f.id_proveedor} onChange={set('id_proveedor')}><option value="">Sin asignar</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
        </div>
        <div className="filas">
          <Entrada etiqueta={`Stock mínimo (${u})`} inputMode="decimal" value={f.stock_minimo} onChange={set('stock_minimo')} error={errores.stock_minimo} ayuda="Por debajo de esto se pide reponer." />
          <Entrada etiqueta={`Stock máximo (${u})`} inputMode="decimal" value={f.stock_maximo} onChange={set('stock_maximo')} error={errores.stock_maximo} ayuda="Por encima, alerta de sobrestock. Vacío = sin tope." />
          <Entrada etiqueta="Avisar vencimiento (días antes)" inputMode="numeric" value={f.dias_aviso_vencimiento} onChange={set('dias_aviso_vencimiento')} error={errores.dias_aviso_vencimiento} />
          <Entrada etiqueta={`Costo por ${u} ($)`} inputMode="decimal" value={f.costo_unitario} onChange={set('costo_unitario')} error={errores.costo_unitario} ayuda="Se actualiza solo con cada compra." />
        </div>
        <div>
          <h3>Presentaciones <small className="ayuda">(envases en los que lo comprás)</small></h3>
          <p className="ayuda">Así podés cargar, contar y dar de baja en botellas o cajas, y ver el stock como «3 × Botella 750 ml». Internamente todo sigue en {u}, que es lo que usan las recetas.</p>
          {pres.map((p, i) => {
            const cant = n(p.cantidad);
            return (
              <div className="pres-fila" key={i}>
                <Entrada etiqueta={i === 0 ? 'Nombre' : <span className="solo-lector">Nombre {i + 1}</span>} placeholder="Botella 750 ml" maxLength={60} value={p.nombre} onChange={(e) => setP(i, 'nombre', e.target.value)} />
                <Entrada etiqueta={i === 0 ? `Trae (${u})` : <span className="solo-lector">Cantidad {i + 1}</span>} inputMode="decimal" placeholder="750" value={p.cantidad} onChange={(e) => setP(i, 'cantidad', e.target.value)} />
                <label className="pres-principal" title="La que se usa para mostrar el stock en envases"><input type="radio" name="principal" checked={Boolean(p.principal) || (i === 0 && !pres.some((x) => x.principal))} onChange={() => hacerPrincipal(i)} /> Principal</label>
                <span className="ayuda pres-costo">{cant > 0 && n(f.costo_unitario) > 0 ? `${pesosFino(costoDeEnvase(n(f.costo_unitario), { cantidad: cant }))} c/u` : ''}</span>
                <Boton className="btn-chico" aria-label="Quitar presentación" onClick={() => setPres((l) => l.filter((_, j) => j !== i))}>×</Boton>
              </div>
            );
          })}
          {errores.presentaciones && <p className="texto-error">{errores.presentaciones}</p>}
          <div><Boton className="btn-chico" onClick={() => setPres((l) => [...l, { nombre: '', cantidad: '', principal: false }])}>+ Agregar presentación</Boton></div>
        </div>
        {!nuevo && <div className="fila-check"><input id="i-activo" type="checkbox" checked={f.activo} onChange={set('activo')} /><label htmlFor="i-activo">Activo (si está en recetas de productos activos no se puede dar de baja)</label></div>}
        {!nuevo && (
          <Estado carga={compras}>{(c) => (
            <div>
              <h3>Precios por proveedor</h3>
              {c.por_proveedor.length === 0 ? <p className="ayuda">Todavía no hay compras registradas.</p> : (
                <ul className="lista-simple">{c.por_proveedor.map((p, i) => <li key={p.id_proveedor ?? i}><span>{p.proveedor ?? 'Sin proveedor'} {i === 0 && c.por_proveedor.length > 1 && <Chip tono="ok">más barato</Chip>}</span><span>{pesosFino(p.costo_unitario)} / {UNIDADES[c.insumo.unidad]} <small className="ayuda">({fechaCorta(p.fecha)})</small></span></li>)}</ul>
              )}
            </div>
          )}</Estado>
        )}
      </form>
    </Modal>
  );
}
