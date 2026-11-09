import { useState } from 'react';
import { get, post } from '../api.js';
import { aBase, principalDe } from '../../../src/domain/presentaciones.js';
import { fechaCorta, fechaHora, hoy, MOTIVOS, numero, pesos, pesosFino, UNIDADES, numeroDe } from '../fmt.js';
import { Boton, Cantidad, Chip, Encabezado, Entrada, Estado, Pestanas, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';
import { FormMerma } from './mermas.jsx';

export function Stock() {
  const [tab, setTab] = useState('alertas');
  const base = useCarga(async () => { const [insumos, proveedores, alertas] = await Promise.all([get('/insumos'), get('/proveedores'), get('/stock/alertas')]); return { insumos, proveedores, alertas }; }, []);
  const total = base.datos?.alertas.total;
  return (
    <>
      <Encabezado titulo="Stock" sub="Cada ingreso queda como un lote con su fecha de entrada, vencimiento y costo. Se consume primero lo que vence antes." />
      <Pestanas valor={tab} onCambio={setTab} opciones={[['alertas', 'Alertas', total], ['ingreso', 'Ingresar mercadería'], ['merma', 'Mermas'], ['ajuste', 'Conteo físico'], ['lotes', 'Lotes'], ['movimientos', 'Movimientos']]} />
      <Estado carga={base}>
        {({ insumos, proveedores, alertas }) => (
          <>
            {tab === 'alertas' && <Alertas a={alertas} insumos={insumos} />}
            {tab === 'ingreso' && <Ingreso insumos={insumos.filter((i) => i.activo)} proveedores={proveedores.filter((p) => p.activo)} onListo={base.recargar} />}
            {tab === 'merma' && <div className="tarjeta"><FormMerma insumos={insumos} onListo={base.recargar} /></div>}
            {tab === 'ajuste' && <Ajuste insumos={insumos.filter((i) => i.activo)} onListo={base.recargar} />}
            {tab === 'lotes' && <Lotes insumos={insumos} />}
            {tab === 'movimientos' && <Movimientos />}
          </>
        )}
      </Estado>
    </>
  );
}

function Alertas({ a, insumos }) {
  if (!a.total) return <p className="nota nota-agua">Todo en orden: no hay faltantes, vencimientos cercanos ni sobrestock.</p>;
  const cant = (x, valor) => <Cantidad valor={valor} insumo={insumos.find((i) => i.id === x.id_insumo)} unidad={x.unidad} />;
  const tabla = (titulo, tono, cab, filas) => filas.length > 0 && (
    <section style={{ marginBottom: '1.2rem' }}>
      <h2 className={`tono-${tono}`}>{titulo} <Chip tono={tono === 'malo' ? 'malo' : 'aviso'}>{filas.length}</Chip></h2>
      <div className="tabla-caja" style={{ marginTop: '.5rem' }}><table><thead><tr>{cab.map((c) => <th key={c} className={c === 'Insumo' ? '' : 'num'}>{c}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j} className={j === 0 ? '' : 'num'}>{c}</td>)}</tr>)}</tbody></table></div>
    </section>
  );
  return (
    <>
      {tabla('Vencidos: retirar y registrar la merma', 'malo', ['Insumo', 'Cantidad', 'Venció', 'Hace'], a.vencidos.map((x) => [x.nombre, cant(x, x.cantidad), fechaCorta(x.fecha_vencimiento), `${x.dias_vencido} d`]))}
      {tabla('Por vencer: usar primero', 'aviso', ['Insumo', 'Cantidad', 'Vence', 'Faltan'], a.por_vencer.map((x) => [x.nombre, cant(x, x.cantidad), fechaCorta(x.fecha_vencimiento), x.dias_restantes === 0 ? 'hoy' : `${x.dias_restantes} d`]))}
      {tabla('Reponer', 'malo', ['Insumo', 'Hay', 'Mínimo', 'Faltan'], a.reponer.map((x) => [x.nombre, cant(x, x.stock_actual), numero(x.stock_minimo), cant(x, x.faltante)]))}
      {tabla('Sobrestock: capital parado', 'aviso', ['Insumo', 'Hay', 'Máximo', 'De más', 'En depósito'], a.sobrestock.map((x) => [x.nombre, cant(x, x.stock_actual), numero(x.stock_maximo), cant(x, x.exceso), `${x.dias_en_stock} d`]))}
    </>
  );
}

function Ingreso({ insumos, proveedores, onListo }) {
  const avisar = useAviso();
  const vacio = { id_insumo: '', modo: 'envases', id_presentacion: '', envases: '', cantidad: '', modoCosto: 'total', costo: '', id_proveedor: '', fecha_ingreso: hoy(), fecha_vencimiento: '', nota: '' };
  const [f, setF] = useState(vacio);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const set = (c) => (e) => setF((x) => ({ ...x, [c]: e.target.value }));
  const ins = insumos.find((i) => String(i.id) === f.id_insumo);
  const n = (t) => numeroDe(t);
  const envasado = Boolean(ins?.presentaciones.length) && f.modo === 'envases';
  const pres = envasado ? ins.presentaciones.find((p) => String(p.id) === f.id_presentacion) ?? principalDe(ins.presentaciones) : null;
  const cantidadBase = envasado ? (pres ? aBase(n(f.envases), pres) : 0) : n(f.cantidad);
  const unidad = ins ? UNIDADES[ins.unidad] : 'unidad';
  // Lo que se pagó en total, sea cual sea la forma en que se cargó el precio
  const costoTotal = f.costo === '' ? null : f.modoCosto === 'total' ? n(f.costo) : f.modoCosto === 'envase' ? n(f.costo) * n(f.envases) : n(f.costo) * cantidadBase;
  const unitario = costoTotal !== null && cantidadBase > 0 ? costoTotal / cantidadBase : null;

  function elegirInsumo(e) {
    const i = insumos.find((x) => String(x.id) === e.target.value);
    setF((x) => ({ ...x, id_insumo: e.target.value, id_proveedor: i?.id_proveedor ? String(i.id_proveedor) : x.id_proveedor,
      modo: 'envases', id_presentacion: String(principalDe(i?.presentaciones)?.id ?? ''), envases: '', cantidad: '', modoCosto: 'total' }));
  }
  function cambiarModo(e) { setF((x) => ({ ...x, modo: e.target.value, modoCosto: 'total' })); }

  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    const detalle = envasado && pres ? `${numero(n(f.envases), 2)} × ${pres.nombre}` : '';
    const nota = [detalle, f.nota.trim()].filter(Boolean).join(' · ');
    const cuerpo = {
      id_insumo: Number(f.id_insumo), cantidad: cantidadBase, id_proveedor: f.id_proveedor ? Number(f.id_proveedor) : null,
      fecha_ingreso: f.fecha_ingreso || undefined, fecha_vencimiento: f.fecha_vencimiento || null, ...(nota ? { nota } : {}),
      ...(costoTotal !== null ? { costo_total: Math.round(costoTotal * 100) / 100 } : {}),
    };
    try { await post('/stock/ingresos', cuerpo); avisar('Ingreso registrado'); setF({ ...vacio, fecha_ingreso: f.fecha_ingreso }); onListo(); }
    catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { cantidad: err.message }); }
    finally { setEnviando(false); }
  }

  return (
    <form className="tarjeta modal-cuerpo" onSubmit={enviar} style={{ maxWidth: 640 }}>
      <h3>Ingresar mercadería</h3>
      <Selector etiqueta="Insumo" required value={f.id_insumo} onChange={elegirInsumo} error={errores.id_insumo}>
        <option value="">Elegí un insumo…</option>{insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
      </Selector>
      {ins?.presentaciones.length > 0 && (
        <Selector etiqueta="Cargar la cantidad en" value={f.modo} onChange={cambiarModo}>
          <option value="envases">Envases (botellas, cajas…)</option><option value="base">{unidad} sueltos</option>
        </Selector>
      )}
      <div className="filas">
        {envasado ? (
          <>
            <Selector etiqueta="Envase" value={pres ? String(pres.id) : ''} onChange={set('id_presentacion')}>{ins.presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
            <Entrada etiqueta="Cantidad de envases" inputMode="decimal" required value={f.envases} onChange={set('envases')} error={errores.cantidad}
              ayuda={cantidadBase > 0 ? `= ${numero(cantidadBase, 2)} ${unidad} en total` : undefined} />
          </>
        ) : (
          <Entrada etiqueta={`Cantidad que entra${ins ? ` (${unidad})` : ''}`} inputMode="decimal" required value={f.cantidad} onChange={set('cantidad')} error={errores.cantidad} />
        )}
        <Selector etiqueta="El precio que cargo es" value={f.modoCosto} onChange={set('modoCosto')}>
          <option value="total">Total de la compra</option>
          {envasado ? <option value="envase">Por envase</option> : <option value="unitario">Por {unidad}</option>}
        </Selector>
        <Entrada etiqueta="Precio ($)" inputMode="decimal" value={f.costo} onChange={set('costo')} error={errores.costo_total || errores.costo_unitario} ayuda={unitario !== null ? `= ${pesosFino(unitario)} por ${unidad}` : 'Opcional, pero sin precio no se actualiza el costo.'} />
      </div>
      <div className="filas">
        <Selector etiqueta="Proveedor" value={f.id_proveedor} onChange={set('id_proveedor')}><option value="">Sin proveedor</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
        <Entrada etiqueta="Fecha de ingreso" type="date" value={f.fecha_ingreso} onChange={set('fecha_ingreso')} error={errores.fecha_ingreso} />
        <Entrada etiqueta="Fecha de vencimiento" type="date" value={f.fecha_vencimiento} onChange={set('fecha_vencimiento')} error={errores.fecha_vencimiento} ayuda="Vacío si no vence." />
      </div>
      <Entrada etiqueta="Nota (opcional)" maxLength={300} value={f.nota} onChange={set('nota')} />
      <Boton tipo="primario" type="submit" cargando={enviando}>Registrar ingreso</Boton>
    </form>
  );
}

function Ajuste({ insumos, onListo }) {
  const avisar = useAviso();
  const vacio = { id_insumo: '', conteos: {}, suelto: '', cantidad_real: '', nota: '' };
  const [f, setF] = useState(vacio);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const ins = insumos.find((i) => String(i.id) === f.id_insumo);
  const envasado = Boolean(ins?.presentaciones.length);
  const unidad = ins ? UNIDADES[ins.unidad] : '';
  // Con envases se cuenta cada presentación y lo que está suelto o abierto; el total sale de sumar todo
  const total = envasado
    ? ins.presentaciones.reduce((s, p) => s + aBase(numeroDe(f.conteos[p.id] ?? ''), p), 0) + numeroDe(f.suelto)
    : numeroDe(f.cantidad_real);
  const algunDato = envasado ? Object.values(f.conteos).some((x) => x !== '') || f.suelto !== '' : f.cantidad_real !== '';

  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    try {
      await post('/stock/ajustes', { id_insumo: Number(f.id_insumo), cantidad_real: Math.round(total * 1000) / 1000, ...(f.nota.trim() ? { nota: f.nota.trim() } : {}) });
      avisar('Stock corregido'); setF(vacio); onListo();
    } catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { cantidad_real: err.message }); }
    finally { setEnviando(false); }
  }
  return (
    <form className="tarjeta modal-cuerpo" onSubmit={enviar} style={{ maxWidth: 520 }}>
      <h3>Conteo físico</h3>
      <p className="ayuda">Contaste lo que hay en el depósito y no coincide con el sistema: cargá lo que realmente hay y el sistema registra la diferencia.</p>
      <Selector etiqueta="Insumo" required value={f.id_insumo} onChange={(e) => setF({ ...vacio, id_insumo: e.target.value, nota: f.nota })}><option value="">Elegí un insumo…</option>{insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}</Selector>
      {ins && <p>El sistema dice que hay <b><Cantidad valor={ins.stock_actual} insumo={ins} /></b>.</p>}
      {envasado ? (
        <>
          {ins.presentaciones.map((p) => (
            <Entrada key={p.id} etiqueta={`${p.nombre} (cerrados)`} inputMode="decimal" value={f.conteos[p.id] ?? ''} onChange={(e) => setF({ ...f, conteos: { ...f.conteos, [p.id]: e.target.value } })} />
          ))}
          <Entrada etiqueta={`Suelto o abierto (${unidad})`} inputMode="decimal" value={f.suelto} onChange={(e) => setF({ ...f, suelto: e.target.value })} ayuda="Lo que queda en botellas abiertas o fuera de un envase." error={errores.cantidad_real} />
          <p className="sumario"><span>Total contado: <b>{Number.isNaN(total) ? '—' : <Cantidad valor={total} insumo={ins} />}</b></span></p>
        </>
      ) : (
        <Entrada etiqueta={`Cantidad real${ins ? ` (${unidad})` : ''}`} inputMode="decimal" required value={f.cantidad_real} onChange={(e) => setF({ ...f, cantidad_real: e.target.value })} error={errores.cantidad_real} />
      )}
      <Entrada etiqueta="Nota (opcional)" maxLength={300} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
      <Boton tipo="primario" type="submit" cargando={enviando} disabled={!ins || !algunDato || Number.isNaN(total)}>Corregir stock</Boton>
    </form>
  );
}

function Lotes({ insumos }) {
  const carga = useCarga(() => get('/stock/lotes'), []);
  const nombre = (id) => insumos.find((i) => i.id === id);
  return (
    <Estado carga={carga} vacio={carga.datos?.length === 0 ? 'No hay lotes con stock.' : null}>
      {(lotes) => (
        <div className="tabla-caja"><table>
          <thead><tr><th>Insumo</th><th className="num">Queda</th><th className="num">Costo unit.</th><th>Ingresó</th><th>Vence</th><th>Proveedor</th></tr></thead>
          <tbody>{lotes.map((l) => { const i = nombre(l.id_insumo); const vencido = l.fecha_vencimiento && l.fecha_vencimiento < hoy(); return (
            <tr key={l.id}><td>{i?.nombre ?? `#${l.id_insumo}`}</td><td className="num">{i ? <Cantidad valor={l.cantidad_actual} insumo={i} /> : numero(l.cantidad_actual, 2)} <small className="ayuda">de {numero(l.cantidad_inicial)}</small></td><td className="num">{pesosFino(l.costo_unitario)}</td>
              <td>{fechaCorta(l.fecha_ingreso)}</td><td>{l.fecha_vencimiento ? <>{fechaCorta(l.fecha_vencimiento)} {vencido && <Chip tono="malo">vencido</Chip>}</> : '—'}</td><td>{l.proveedor ?? '—'}</td></tr>
          ); })}</tbody>
        </table></div>
      )}
    </Estado>
  );
}

const TIPOS = { ingreso: 'Ingreso', merma: 'Merma', ajuste: 'Ajuste', venta: 'Venta', reversion: 'Devolución' };
function Movimientos() {
  const carga = useCarga(() => get('/stock/movimientos', { limite: 100 }), []);
  return (
    <Estado carga={carga} vacio={carga.datos?.length === 0 ? 'Todavía no hay movimientos.' : null}>
      {(mov) => (
        <div className="tabla-caja"><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Insumo</th><th className="num">Cantidad</th><th>Detalle</th><th>Quién</th></tr></thead>
          <tbody>{mov.map((m) => (
            <tr key={m.id}><td>{fechaHora(m.fecha_hora)}</td><td><Chip tono={m.cantidad >= 0 ? 'ok' : 'aviso'}>{TIPOS[m.tipo] ?? m.tipo}</Chip></td><td>{m.insumo}</td>
              <td className="num">{m.cantidad > 0 ? '+' : ''}{numero(m.cantidad, 2)} {UNIDADES[m.unidad]}</td>
              <td>{m.motivo ? MOTIVOS[m.motivo] ?? m.motivo : (m.costo_unitario ? `a ${pesosFino(m.costo_unitario)} c/u` : '')}{m.nota ? ` · ${m.nota}` : ''}</td><td>{m.usuario}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Estado>
  );
}
void pesos;
