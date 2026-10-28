import { useEffect, useMemo, useState } from 'react';
import { aBase } from '../../../src/domain/presentaciones.js';
import { get, patch, post, put } from '../api.js';
import { numero, pesos, pesosFino, porc, UNIDADES, numeroDe } from '../fmt.js';
import { Boton, Chip, Confirmar, Encabezado, Entrada, Estado, Modal, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

const margenDe = (precio, costo) => (precio > 0 ? Math.round(((precio - costo) / precio) * 1000) / 10 : null);
const tonoMargen = (m) => (m === null ? 'neutro' : m < 60 ? 'malo' : m < 75 ? 'aviso' : 'ok');

export function Productos() {
  const avisar = useAviso();
  const carga = useCarga(() => get('/productos', { incluir_inactivos: 'true' }), []);
  const [filtro, setFiltro] = useState({ texto: '', categoria: '', inactivos: false });
  const [edicionPrecios, setEdicionPrecios] = useState({}); // id -> texto escrito
  const [seleccion, setSeleccion] = useState(new Set());
  const [modal, setModal] = useState(null); // {tipo:'producto', producto} | {tipo:'ajuste'}
  const [guardando, setGuardando] = useState(false);
  const [confirmarGuardar, setConfirmarGuardar] = useState(false);

  const todos = carga.datos ?? [];
  const categorias = useMemo(() => [...new Set(todos.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'es')), [todos]);
  const visibles = todos.filter((p) =>
    (filtro.inactivos || p.activo)
    && (!filtro.categoria || p.categoria === filtro.categoria)
    && (!filtro.texto || p.nombre.toLowerCase().includes(filtro.texto.toLowerCase())));

  const cambios = Object.entries(edicionPrecios)
    .map(([id, t]) => ({ id: Number(id), precio: numeroDe(t), texto: t }))
    .filter((c) => { const p = todos.find((x) => x.id === c.id); return p && c.texto !== '' && Number.isFinite(c.precio) && c.precio !== p.precio; });
  const invalidos = Object.entries(edicionPrecios).filter(([, t]) => t !== '' && (!Number.isFinite(numeroDe(t)) || numeroDe(t) < 0));

  async function guardarCambios() {
    setGuardando(true);
    try {
      await put('/productos/precios', { precios: cambios.map(({ id, precio }) => ({ id, precio })) });
      await carga.recargar(); // primero los datos nuevos, para que el precio no "salte" al valor viejo
      avisar(`${cambios.length} ${cambios.length === 1 ? 'precio actualizado' : 'precios actualizados'}`);
      setEdicionPrecios({}); setConfirmarGuardar(false);
    } catch (e) { avisar(e.message, 'error'); setConfirmarGuardar(false); }
    finally { setGuardando(false); }
  }

  const alternarSel = (id) => setSeleccion((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosSel = visibles.length > 0 && visibles.every((p) => seleccion.has(p.id));

  return (
    <>
      <Encabezado titulo="Productos y precios" sub="Editá los precios directamente en la tabla o ajustalos en bloque por porcentaje o por margen deseado.">
        <Boton onClick={() => setModal({ tipo: 'ajuste' })} disabled={cambios.length > 0} title={cambios.length ? 'Guardá o descartá los cambios de la tabla primero' : undefined}>Ajustar precios en bloque</Boton>
        <Boton tipo="primario" onClick={() => setModal({ tipo: 'producto', producto: null })}>Nuevo producto</Boton>
      </Encabezado>

      <div className="herramientas">
        <Entrada etiqueta="Buscar" type="search" placeholder="Nombre…" value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
        <Selector etiqueta="Categoría" value={filtro.categoria} onChange={(e) => setFiltro({ ...filtro, categoria: e.target.value })}>
          <option value="">Todas</option>{categorias.map((c) => <option key={c}>{c}</option>)}
        </Selector>
        <div className="fila-check"><input id="inact" type="checkbox" checked={filtro.inactivos} onChange={(e) => setFiltro({ ...filtro, inactivos: e.target.checked })} /><label htmlFor="inact">Mostrar dados de baja</label></div>
      </div>

      <Estado carga={carga} vacio={todos.length === 0 ? 'Todavía no hay productos. Creá el primero.' : null}>
        {() => (
          <>
            <div className="tabla-caja"><table>
              <thead><tr>
                <th><input type="checkbox" aria-label="Seleccionar todos los visibles" checked={todosSel} onChange={() => setSeleccion(todosSel ? new Set() : new Set(visibles.map((p) => p.id)))} /></th>
                <th>Producto</th><th className="solo-ancho">Categoría</th><th className="num solo-ancho">Costo</th><th className="num">Precio de venta</th><th className="num">Margen</th><th /></tr></thead>
              <tbody>
                {visibles.map((p) => {
                  const escrito = edicionPrecios[p.id];
                  const precioMostrado = escrito !== undefined ? numeroDe(escrito) : p.precio;
                  const m = p.tiene_receta ? margenDe(Number.isFinite(precioMostrado) ? precioMostrado : p.precio, p.costo) : null;
                  const cambiado = cambios.some((c) => c.id === p.id);
                  return (
                    <tr key={p.id} className={`${p.activo ? '' : 'inactivo'} ${cambiado ? 'cambiado' : ''}`}>
                      <td><input type="checkbox" aria-label={`Seleccionar ${p.nombre}`} checked={seleccion.has(p.id)} onChange={() => alternarSel(p.id)} /></td>
                      <td><button className="enlace" onClick={() => setModal({ tipo: 'producto', producto: p })}>{p.nombre}</button> {!p.activo && <Chip>de baja</Chip>}<br /><small className="ayuda">{p.categoria} · {p.destino === 'barra' ? 'Barra' : 'Cocina'}</small></td>
                      <td className="solo-ancho">{p.categoria}</td>
                      <td className="num solo-ancho">{p.tiene_receta ? <>{pesos(p.costo)}{p.costo_incompleto && <Chip tono="aviso">incompleto</Chip>}</> : <Chip tono="aviso">sin receta</Chip>}</td>
                      <td className="num"><input className="precio" inputMode="decimal" aria-label={`Precio de ${p.nombre}`} value={escrito ?? String(p.precio)} onChange={(e) => setEdicionPrecios({ ...edicionPrecios, [p.id]: e.target.value })} /></td>
                      <td className="num">{m === null ? '—' : <><Chip tono={tonoMargen(m)}>{porc(m)}</Chip><br /><small className="ayuda">{pesos(precioMostrado - p.costo)}</small></>}</td>
                      <td className="num solo-ancho"><Boton className="btn-chico" onClick={() => setModal({ tipo: 'producto', producto: p })}>Editar</Boton></td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && <tr><td colSpan="7" className="vacio">Ningún producto coincide con el filtro.</td></tr>}
              </tbody>
            </table></div>
            <p className="ayuda" style={{ marginTop: '.5rem' }}>Margen = (precio − costo) ÷ precio. El costo sale de las recetas con el último precio de compra de cada insumo.</p>
          </>
        )}
      </Estado>

      {cambios.length > 0 && (
        <div className="barra-cambios" role="region" aria-label="Cambios sin guardar">
          <span>{cambios.length} {cambios.length === 1 ? 'precio modificado' : 'precios modificados'} sin guardar</span>
          <Boton onClick={() => setEdicionPrecios({})}>Descartar</Boton>
          <Boton tipo="primario" disabled={invalidos.length > 0} onClick={() => setConfirmarGuardar(true)}>Guardar cambios</Boton>
        </div>
      )}

      {confirmarGuardar && (
        <Modal titulo="Confirmar cambio de precios" onCerrar={() => setConfirmarGuardar(false)} pie={<><Boton onClick={() => setConfirmarGuardar(false)}>Volver</Boton><Boton tipo="primario" cargando={guardando} onClick={guardarCambios}>Aplicar {cambios.length} cambios</Boton></>}>
          <div className="tabla-caja"><table>
            <thead><tr><th>Producto</th><th className="num">Antes</th><th className="num">Ahora</th></tr></thead>
            <tbody>{cambios.map((c) => { const p = todos.find((x) => x.id === c.id); return <tr key={c.id}><td>{p.nombre}</td><td className="num">{pesos(p.precio)}</td><td className="num"><b>{pesos(c.precio)}</b></td></tr>; })}</tbody>
          </table></div>
          <p className="ayuda">Se aplican todos juntos o ninguno.</p>
        </Modal>
      )}

      {modal?.tipo === 'producto' && (
        <FormProducto producto={modal.producto} categorias={categorias} onCerrar={() => setModal(null)}
          onListo={async (texto) => { await carga.recargar(); setModal(null); avisar(texto); }} />
      )}
      {modal?.tipo === 'ajuste' && (
        <AjustePrecios productos={todos.filter((p) => p.activo)} categorias={categorias} seleccion={seleccion} onCerrar={() => setModal(null)}
          onListo={async (texto) => { await carga.recargar(); setModal(null); avisar(texto); setSeleccion(new Set()); }} />
      )}
    </>
  );
}

/* ---------- ajuste en bloque: por porcentaje o por margen deseado, con vista previa ---------- */
function AjustePrecios({ productos, categorias, seleccion, onCerrar, onListo }) {
  const [f, setF] = useState({ modo: 'porcentaje', valor: '10', alcance: seleccion.size ? 'seleccion' : 'todos', categoria: categorias[0] ?? '', paso: '100' });
  const [vista, setVista] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const set = (c) => (e) => { setF((x) => ({ ...x, [c]: e.target.value })); setVista(null); };

  function cuerpo(aplicar) {
    const c = { modo: f.modo, valor: numeroDe(f.valor), aplicar };
    if (f.paso !== '') c.paso = Number(f.paso);
    if (f.alcance === 'seleccion') c.ids = [...seleccion];
    if (f.alcance === 'categoria') c.categoria = f.categoria;
    return c;
  }
  async function ejecutar(aplicar) {
    setCargando(true); setError('');
    try {
      const r = await post('/productos/ajuste-precios', cuerpo(aplicar));
      if (aplicar) onListo(`${r.cambios.length} ${r.cambios.length === 1 ? 'precio actualizado' : 'precios actualizados'}`);
      else setVista(r);
    } catch (e) { setError(e.message); setVista(null); }
    finally { setCargando(false); }
  }
  const esPorc = f.modo === 'porcentaje';
  const alcanza = f.alcance === 'seleccion' ? seleccion.size : f.alcance === 'categoria' ? productos.filter((p) => p.categoria === f.categoria).length : productos.length;

  return (
    <Modal titulo="Ajustar precios en bloque" onCerrar={onCerrar} ancho="ancho" pie={<>
      <Boton onClick={onCerrar}>Cancelar</Boton>
      <Boton cargando={cargando} onClick={() => ejecutar(false)}>Ver vista previa</Boton>
      <Boton tipo="primario" cargando={cargando} disabled={!vista || vista.cambios.length === 0} onClick={() => ejecutar(true)}>Aplicar {vista ? vista.cambios.length : ''} cambios</Boton>
    </>}>
      {error && <div className="caja-error" role="alert">{error}</div>}
      <div className="filas">
        <Selector etiqueta="Cómo ajustar" value={f.modo} onChange={set('modo')}>
          <option value="porcentaje">Subir o bajar un porcentaje</option>
          <option value="margen">Llevar al margen deseado</option>
        </Selector>
        <Entrada etiqueta={esPorc ? 'Porcentaje (negativo para bajar)' : 'Margen deseado (%)'} inputMode="decimal" required value={f.valor} onChange={set('valor')}
          ayuda={esPorc ? 'Ej.: 10 sube un 10 %; −5 baja un 5 %.' : 'Calcula el precio con el costo actual. Sin receta no se puede.'} />
        <Selector etiqueta="Redondear a" value={f.paso} onChange={set('paso')}>
          <option value="">No redondear</option><option value="10">$10</option><option value="50">$50</option><option value="100">$100</option><option value="500">$500</option>
        </Selector>
      </div>
      <div className="filas">
        <Selector etiqueta="Qué productos" value={f.alcance} onChange={set('alcance')}>
          <option value="todos">Todos los activos</option>
          <option value="categoria">Una categoría</option>
          <option value="seleccion" disabled={!seleccion.size}>Los {seleccion.size} seleccionados</option>
        </Selector>
        {f.alcance === 'categoria' && <Selector etiqueta="Categoría" value={f.categoria} onChange={set('categoria')}>{categorias.map((c) => <option key={c}>{c}</option>)}</Selector>}
      </div>
      <p className="ayuda">Afecta a {alcanza} {alcanza === 1 ? 'producto' : 'productos'}. Primero se muestra una vista previa; nada cambia hasta que apliques.</p>
      {vista && (
        <>
          {vista.cambios.length === 0 ? <p className="nota">Con estos valores ningún precio cambia.</p> : (
            <div className="tabla-caja"><table>
              <thead><tr><th>Producto</th><th className="num">Precio actual</th><th className="num">Precio nuevo</th><th className="num">Margen</th></tr></thead>
              <tbody>{vista.cambios.map((c) => (
                <tr key={c.id}><td>{c.nombre}<br /><small className="ayuda">{c.categoria}</small></td><td className="num">{pesos(c.precio_actual)}</td>
                  <td className="num"><b>{pesos(c.precio_nuevo)}</b></td><td className="num">{porc(c.margen_pct_actual)} → <b>{porc(c.margen_pct_nuevo)}</b></td></tr>
              ))}</tbody>
            </table></div>
          )}
          {vista.omitidos.length > 0 && <div className="nota"><b>No se tocan:</b> {vista.omitidos.map((o) => `${o.nombre ?? o.id} (${o.motivo})`).join('; ')}</div>}
        </>
      )}
    </Modal>
  );
}

/* ---------- alta y edición de producto, con receta ---------- */
function FormProducto({ producto, categorias, onCerrar, onListo }) {
  const nuevo = !producto;
  const insumos = useCarga(() => get('/insumos'), []);
  const detalle = useCarga(() => (nuevo ? Promise.resolve(null) : get(`/productos/${producto.id}`)), [producto?.id]);
  const [f, setF] = useState(null);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [baja, setBaja] = useState(false);

  useEffect(() => {
    if (f !== null || !(nuevo || detalle.datos)) return;
    const d = detalle.datos;
    setF({
      nombre: d?.nombre ?? '', descripcion: d?.descripcion ?? '', categoria: d?.categoria ?? categorias[0] ?? '', destino: d?.destino ?? 'barra',
      precio: String(d?.precio ?? ''), activo: d?.activo ?? true, receta: (d?.receta ?? []).map((r) => ({ id_insumo: String(r.id_insumo), cantidad: String(r.cantidad), medida: '' })),
    });
  }, [f, nuevo, detalle.datos, categorias]);
  const lista = insumos.datos ?? [];
  const cantidadBase = (r) => {
    const i = lista.find((x) => String(x.id) === r.id_insumo);
    const envase = i?.presentaciones?.find((p) => String(p.id) === r.medida);
    return envase ? aBase(numeroDe(r.cantidad), envase) : numeroDe(r.cantidad);
  };
  const costoLinea = (r) => { const i = lista.find((x) => String(x.id) === r.id_insumo); return i ? i.costo_unitario * (cantidadBase(r) || 0) : 0; };
  const costo = f ? f.receta.reduce((s, r) => s + costoLinea(r), 0) : 0;
  const precio = f ? numeroDe(f.precio) : 0;
  const m = f && f.receta.length && precio > 0 ? margenDe(precio, costo) : null;
  const set = (c) => (e) => setF((x) => ({ ...x, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setReceta = (i, c, v) => setF((x) => ({ ...x, receta: x.receta.map((r, j) => (j === i ? { ...r, [c]: v } : r)) }));

  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    const receta = f.receta.filter((r) => r.id_insumo).map((r) => ({ id_insumo: Number(r.id_insumo), cantidad: cantidadBase(r) }));
    const datos = { nombre: f.nombre.trim(), descripcion: f.descripcion.trim(), categoria: f.categoria.trim(), destino: f.destino };
    try {
      if (nuevo) {
        await post('/productos', { ...datos, precio, receta });
        return onListo('Producto creado');
      }
      await patch(`/productos/${producto.id}`, { ...datos, activo: f.activo });
      await put(`/productos/${producto.id}/receta`, { receta });
      if (precio !== producto.precio) await patch(`/productos/${producto.id}/precio`, { precio });
      return onListo('Producto guardado');
    } catch (err) {
      const c = erroresPorCampo(err);
      setErrores(Object.keys(c).length ? c : { general: err.message }); setEnviando(false);
    }
  }

  return (
    <Modal titulo={nuevo ? 'Nuevo producto' : `Editar ${producto.nombre}`} onCerrar={onCerrar} ancho="ancho" pie={<>
      {!nuevo && producto.activo && <Boton tipo="peligro" onClick={() => setBaja(true)} style={{ marginRight: 'auto' }}>Dar de baja</Boton>}
      <Boton onClick={onCerrar}>Cancelar</Boton>
      <Boton tipo="primario" cargando={enviando} disabled={!f} onClick={enviar}>Guardar</Boton>
    </>}>
      {(detalle.error || insumos.error) && <div className="caja-error" role="alert">{(detalle.error ?? insumos.error).message}</div>}
      {errores.general && <div className="caja-error" role="alert">{errores.general}</div>}
      {!f ? <p className="cargando">Cargando…</p> : (
        <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
          <div className="filas">
            <Entrada etiqueta="Nombre" required maxLength={100} value={f.nombre} onChange={set('nombre')} error={errores.nombre} />
            <Entrada etiqueta="Categoría" required list="categorias" value={f.categoria} onChange={set('categoria')} error={errores.categoria} />
            <datalist id="categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
            <Selector etiqueta="Se prepara en" value={f.destino} onChange={set('destino')}><option value="barra">Barra</option><option value="cocina">Cocina</option></Selector>
          </div>
          <Entrada etiqueta="Descripción para la carta" maxLength={500} value={f.descripcion} onChange={set('descripcion')} error={errores.descripcion} />
          <div className="filas">
            <Entrada etiqueta="Precio de venta ($)" inputMode="decimal" required value={f.precio} onChange={set('precio')} error={errores.precio} />
            {!nuevo && <div className="fila-check"><input id="p-activo" type="checkbox" checked={f.activo} onChange={set('activo')} /><label htmlFor="p-activo">Aparece en la carta</label></div>}
          </div>

          <h3>Receta <small className="ayuda">(cantidad de cada insumo por porción)</small></h3>
          {f.receta.length === 0 && <p className="nota">Sin receta no se puede calcular el costo ni el margen.</p>}
          {f.receta.map((r, i) => {
            const ins = lista.find((x) => String(x.id) === r.id_insumo);
            return (
              <div className="receta-fila" key={i}>
                <Selector etiqueta={i === 0 ? 'Insumo' : <span className="solo-lector">Insumo {i + 1}</span>} value={r.id_insumo} onChange={(e) => setF((x) => ({ ...x, receta: x.receta.map((fila, j) => (j === i ? { ...fila, id_insumo: e.target.value, medida: '' } : fila)) }))}>
                  <option value="">Elegí…</option>{lista.filter((x) => x.activo !== false).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </Selector>
                <Entrada etiqueta={i === 0 ? 'Cantidad' : <span className="solo-lector">Cantidad {i + 1}</span>} placeholder={ins ? (r.medida ? 'envases' : UNIDADES[ins.unidad]) : ''} inputMode="decimal" value={r.cantidad} onChange={(e) => setReceta(i, 'cantidad', e.target.value)}
                  ayuda={r.medida && r.cantidad ? `= ${numero(cantidadBase(r), 2)} ${UNIDADES[ins.unidad]}` : undefined} />
                {ins?.presentaciones?.length > 0 ? (
                  <Selector etiqueta={i === 0 ? 'Medida' : <span className="solo-lector">Medida {i + 1}</span>} value={r.medida} onChange={(e) => setReceta(i, 'medida', e.target.value)}>
                    <option value="">{UNIDADES[ins.unidad]}</option>{ins.presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </Selector>
                ) : <div />}
                <div className="calc">{pesos(costoLinea(r))}</div>
                <Boton className="btn-chico" aria-label="Quitar insumo" onClick={() => setF((x) => ({ ...x, receta: x.receta.filter((_, j) => j !== i) }))}>×</Boton>
              </div>
            );
          })}
          {errores.receta && <p className="texto-error">{errores.receta}</p>}
          <div><Boton className="btn-chico" onClick={() => setF((x) => ({ ...x, receta: [...x.receta, { id_insumo: '', cantidad: '', medida: '' }] }))}>+ Agregar insumo</Boton></div>
          <div className="sumario"><span>Costo: <b>{pesosFino(costo)}</b></span><span>Margen: <b>{m === null ? '—' : porc(m)}</b></span>{m !== null && <span>Ganancia por unidad: <b>{pesos(precio - costo)}</b></span>}</div>
        </form>
      )}
      {baja && <Confirmar titulo="Dar de baja el producto" texto={`"${producto.nombre}" deja de aparecer en la carta. Se conserva en el historial y se puede reactivar.`} confirmar="Dar de baja" peligro onNo={() => setBaja(false)}
        onSi={async () => { try { await patch(`/productos/${producto.id}`, { activo: false }); onListo('Producto dado de baja'); } catch (e) { setErrores({ general: e.message }); setBaja(false); } }} />}
    </Modal>
  );
}
void numero;
