import { useState } from 'react';
import { get } from '../api.js';
import { CLASES_MENU, textoDePedido } from '../../../src/domain/informes.js';
import { diaYFecha, hoy, MOTIVOS, numero, pesos, porc, UNIDADES } from '../fmt.js';
import { Boton, Chip, Encabezado, Entrada, Estado, Pestanas, Selector, useAviso, useCarga } from '../ui.jsx';
import { BarrasH, Kpi, PERIODOS, rangoDe } from './ventas.jsx';

const cant = (n, u) => `${numero(n, 2)} ${UNIDADES[u] ?? u}`;
const signo = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');

function SelectorPeriodo({ clave, rango, onElegir, onFecha }) {
  return (
    <div className="herramientas">
      <div className="periodos" role="group" aria-label="Período">
        {PERIODOS.map(([c, t]) => <button type="button" key={c} className={`btn btn-chico ${clave === c ? 'btn-primario' : ''}`} aria-pressed={clave === c} onClick={() => onElegir(c)}>{t}</button>)}
      </div>
      <Entrada etiqueta="Desde" type="date" value={rango.desde} max={rango.hasta} onChange={onFecha('desde')} />
      <Entrada etiqueta="Hasta" type="date" value={rango.hasta} min={rango.desde} max={hoy()} onChange={onFecha('hasta')} />
    </div>
  );
}

const PESTANAS = [['rentabilidad', 'Rentabilidad'], ['comparar', 'Comparar períodos'], ['consumo', 'Consumo real vs teórico'], ['stock', 'Stock y mermas'], ['compras', 'Qué comprar']];

/** Informes para decidir: qué deja ganancia, cómo vamos contra antes, dónde se pierde plata y qué hay que comprar. */
export function Informes() {
  const [pestana, setPestana] = useState('rentabilidad');
  const [clave, setClave] = useState('30');
  const [rango, setRango] = useState(() => rangoDe('30'));
  const elegir = (c) => { setClave(c); setRango(rangoDe(c)); };
  const fecha = (campo) => (e) => { if (e.target.value) { setClave(null); setRango({ ...rango, [campo]: e.target.value }); } };
  const periodo = pestana !== 'compras' && <SelectorPeriodo clave={clave} rango={rango} onElegir={elegir} onFecha={fecha} />;
  return (
    <>
      <Encabezado titulo="Informes" sub="Para decidir precios, compras y qué cuidar. La noche cuenta de 06:00 a 06:00." />
      <Pestanas valor={pestana} onCambio={setPestana} opciones={PESTANAS} />
      {periodo}
      {pestana === 'rentabilidad' && <Rentabilidad rango={rango} />}
      {pestana === 'comparar' && <Comparar rango={rango} />}
      {pestana === 'consumo' && <Consumo rango={rango} />}
      {pestana === 'stock' && <StockYMermas rango={rango} />}
      {pestana === 'compras' && <Compras />}
    </>
  );
}

/* ---------- rentabilidad ---------- */
const CLASE = { estrella: ['Estrella', 'ok'], caballo: ['Caballo de batalla', 'aviso'], rompecabezas: ['Rompecabezas', 'agua'], perro: ['Perro', 'malo'] };

function Rentabilidad({ rango }) {
  const carga = useCarga(() => get('/informes/rentabilidad', rango), [rango.desde, rango.hasta]);
  return (
    <Estado carga={carga} vacio={carga.datos && carga.datos.resumen.cuentas === 0 ? 'No hay ventas cobradas en este período.' : null}>
      {(d) => (
        <>
          <div className="kpis">
            <Kpi titulo="Ganancia bruta" valor={pesos(d.margen_total)} detalle="ventas − costo de recetas" />
            <Kpi titulo="Margen" valor={porc(d.resumen.margen_pct)} detalle="sobre lo vendido con receta" />
            <Kpi titulo="Productos «A»" valor={numero(d.filas.filter((f) => f.abc === 'A').length)} detalle="juntan el 80 % de la ganancia" />
            <Kpi titulo="Sin receta" valor={numero(d.sin_costo.length)} detalle={d.sin_costo.length ? 'no entran en el cálculo' : 'todos con costo'} aviso={d.sin_costo.length ? d.sin_costo.join(', ') : null} />
          </div>
          <section className="tarjeta" style={{ marginTop: '1rem' }}>
            <h2>Aporte de cada producto a la ganancia</h2>
            <div className="tabla-caja"><table>
              <thead><tr><th>Producto</th><th className="num solo-ancho">Unidades</th><th className="num solo-ancho">Ventas</th><th className="num">Ganancia</th><th>Aporte</th><th className="solo-ancho">ABC</th><th>En el menú</th></tr></thead>
              <tbody>{d.filas.map((p) => (
                <tr key={p.id_producto}>
                  <td><b>{p.nombre}</b><br /><small className="ayuda">{p.categoria}</small></td>
                  <td className="num solo-ancho">{numero(p.unidades)}</td>
                  <td className="num solo-ancho">{pesos(p.ventas)}</td>
                  <td className="num">{p.clase_menu ? <>{pesos(p.margen)}<br /><small className="ayuda">{pesos(p.cm_unitario)} c/u</small></> : '—'}</td>
                  <td style={{ minWidth: 110 }}>{p.aporte_pct === null ? <Chip tono="aviso">sin receta</Chip> : <div title={`${numero(p.aporte_pct, 1)} % de la ganancia`}><div className="barra-h-pista"><span style={{ width: `${Math.min(100, p.aporte_pct)}%` }} /></div><small className="ayuda">{numero(p.aporte_pct, 1)} %</small></div>}</td>
                  <td className="solo-ancho">{p.abc && <Chip tono={p.abc === 'A' ? 'ok' : p.abc === 'B' ? 'neutro' : 'aviso'}>{p.abc}</Chip>}</td>
                  <td>{p.clase_menu && <Chip tono={CLASE[p.clase_menu][1]}>{CLASE[p.clase_menu][0]}</Chip>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="tarjeta" style={{ marginTop: '1rem' }}>
            <h2>Cómo leerlo</h2>
            <p><b>ABC:</b> los «A» son los pocos productos que juntan el 80 % de la ganancia; los «C», el último 5 %.</p>
            <ul className="lista-simple">{Object.entries(CLASES_MENU).map(([k, t]) => <li key={k}><span><Chip tono={CLASE[k][1]}>{CLASE[k][0]}</Chip></span><span style={{ textAlign: 'right' }}>{t.split(': ')[1]}</span></li>)}</ul>
            <p className="ayuda">«Se vende mucho» = al menos el {numero(d.umbrales.popularidad_pct, 1)} % de las unidades. «Buen margen» = deja más que el promedio, {pesos(d.umbrales.cm_promedio)} por unidad.</p>
          </section>
        </>
      )}
    </Estado>
  );
}

/* ---------- comparar ---------- */
function Variacion({ m, formato = pesos, inverso = false }) {
  if (m.diferencia === 0) return <small className="ayuda">igual</small>;
  const sube = m.diferencia > 0;
  const bien = inverso ? !sube : sube;
  return <small className={bien ? 'var-bien' : 'var-mal'}>{sube ? '▲' : '▼'} {signo(m.diferencia)}{formato(Math.abs(m.diferencia))}{m.diferencia_pct !== null && m.diferencia_pct !== undefined ? ` (${signo(m.diferencia_pct)}${numero(Math.abs(m.diferencia_pct), 1)} %)` : ''}</small>;
}

function Comparar({ rango }) {
  const [propio, setPropio] = useState(false);
  const [ant, setAnt] = useState({ desde: '', hasta: '' });
  const consulta = propio && ant.desde && ant.hasta ? { ...rango, desde_ant: ant.desde, hasta_ant: ant.hasta } : rango;
  const carga = useCarga(() => get('/informes/comparar', consulta), [consulta.desde, consulta.hasta, consulta.desde_ant, consulta.hasta_ant]);
  return (
    <>
      <div className="herramientas">
        <div className="fila-check"><input id="ant-propio" type="checkbox" checked={propio} onChange={(e) => setPropio(e.target.checked)} /><label htmlFor="ant-propio">Elegir yo con qué período comparar</label></div>
        {propio && <>
          <Entrada etiqueta="Anterior desde" type="date" value={ant.desde} onChange={(e) => setAnt({ ...ant, desde: e.target.value })} />
          <Entrada etiqueta="Anterior hasta" type="date" value={ant.hasta} onChange={(e) => setAnt({ ...ant, hasta: e.target.value })} />
        </>}
      </div>
      <Estado carga={carga}>
        {(d) => {
          const m = d.metricas;
          return (
            <>
              <p className="ayuda">{diaYFecha(d.actual.desde)} al {diaYFecha(d.actual.hasta)} ({d.noches.actual} {d.noches.actual === 1 ? 'noche' : 'noches'} con ventas) contra {diaYFecha(d.previo.desde)} al {diaYFecha(d.previo.hasta)} ({d.noches.previo} {d.noches.previo === 1 ? 'noche' : 'noches'}).</p>
              <div className="kpis">
                <div className="kpi"><span className="kpi-titulo">Ventas</span><b className="kpi-valor">{pesos(m.ventas.actual)}</b><span className="ayuda">antes {pesos(m.ventas.previo)}</span><Variacion m={m.ventas} /></div>
                <div className="kpi"><span className="kpi-titulo">Por noche</span><b className="kpi-valor">{pesos(m.ventas_por_noche.actual)}</b><span className="ayuda">antes {pesos(m.ventas_por_noche.previo)}</span><Variacion m={m.ventas_por_noche} /></div>
                <div className="kpi"><span className="kpi-titulo">Ticket promedio</span><b className="kpi-valor">{pesos(m.ticket_promedio.actual)}</b><span className="ayuda">antes {pesos(m.ticket_promedio.previo)}</span><Variacion m={m.ticket_promedio} /></div>
                <div className="kpi"><span className="kpi-titulo">Margen</span><b className="kpi-valor">{porc(m.margen_pct.actual)}</b><span className="ayuda">antes {porc(m.margen_pct.previo)}</span>{m.margen_pct.diferencia !== null && <small className={m.margen_pct.diferencia >= 0 ? 'var-bien' : 'var-mal'}>{m.margen_pct.diferencia >= 0 ? '▲' : '▼'} {signo(m.margen_pct.diferencia)}{numero(Math.abs(m.margen_pct.diferencia), 1)} puntos</small>}</div>
                <div className="kpi"><span className="kpi-titulo">Cuentas</span><b className="kpi-valor">{numero(m.cuentas.actual)}</b><span className="ayuda">antes {numero(m.cuentas.previo)}</span><Variacion m={m.cuentas} formato={numero} /></div>
                <div className="kpi"><span className="kpi-titulo">Unidades</span><b className="kpi-valor">{numero(m.unidades.actual)}</b><span className="ayuda">antes {numero(m.unidades.previo)}</span><Variacion m={m.unidades} formato={numero} /></div>
              </div>
              <TablaVariacion titulo="Categorías" filas={d.categorias} />
              <TablaVariacion titulo="Productos" filas={d.productos} />
            </>
          );
        }}
      </Estado>
    </>
  );
}

function TablaVariacion({ titulo, filas }) {
  if (!filas.length) return null;
  return (
    <section className="tarjeta" style={{ marginTop: '1rem' }}>
      <h2>{titulo}</h2>
      <div className="tabla-caja"><table>
        <thead><tr><th>{titulo === 'Productos' ? 'Producto' : 'Categoría'}</th><th className="num">Ahora</th><th className="num solo-ancho">Antes</th><th className="num">Cambio</th></tr></thead>
        <tbody>{filas.map((f) => (
          <tr key={f.id_producto ?? f.categoria}>
            <td><b>{f.nombre}</b> {f.estado === 'nuevo' && <Chip tono="agua">nuevo</Chip>} {f.estado === 'sin_ventas' && <Chip tono="aviso">sin ventas</Chip>}</td>
            <td className="num">{pesos(f.actual.ventas)}<br /><small className="ayuda">{numero(f.actual.unidades)} u.</small></td>
            <td className="num solo-ancho">{pesos(f.previo.ventas)}<br /><small className="ayuda">{numero(f.previo.unidades)} u.</small></td>
            <td className="num"><Variacion m={f} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

/* ---------- consumo real vs teórico ---------- */
function Consumo({ rango }) {
  const carga = useCarga(() => get('/informes/consumo', rango), [rango.desde, rango.hasta]);
  return (
    <Estado carga={carga} vacio={carga.datos && carga.datos.filas.length === 0 ? 'No hubo movimientos de stock en este período.' : null}>
      {(d) => (
        <>
          <p className="nota nota-agua"><b>Teórico</b> es lo que las recetas dicen que se gastó con lo que se vendió. <b>Real</b> suma además lo que se registró como merma y lo que el conteo físico encontró de menos. Cuanto más grande la diferencia, más producto se va sin cobrarse (derrames, porciones generosas, errores de carga, robo).</p>
          <div className="kpis">
            <Kpi titulo="Gastado según recetas" valor={pesos(d.resumen.valor_teorico)} detalle="costo de lo vendido" />
            <Kpi titulo="Gastado en realidad" valor={pesos(d.resumen.valor_real)} detalle="incluye mermas y conteos" />
            <Kpi titulo="Diferencia" valor={pesos(d.resumen.valor_diferencia)} detalle={d.resumen.diferencia_pct === null ? '' : `${numero(d.resumen.diferencia_pct, 1)} % sobre lo teórico`} aviso={d.resumen.insumos_sin_costo ? `${d.resumen.insumos_sin_costo} insumos sin costo cargado: su valor figura en $0.` : null} />
          </div>
          <div className="tabla-caja" style={{ marginTop: '1rem' }}><table>
            <thead><tr><th>Insumo</th><th className="num">Teórico</th><th className="num solo-ancho">Merma</th><th className="num solo-ancho">Conteo</th><th className="num">Real</th><th className="num">Diferencia</th></tr></thead>
            <tbody>{d.filas.map((f) => (
              <tr key={f.id_insumo}>
                <td><b>{f.nombre}</b></td>
                <td className="num">{cant(f.teorico, f.unidad)}</td>
                <td className="num solo-ancho">{f.merma ? cant(f.merma, f.unidad) : '—'}</td>
                <td className="num solo-ancho">{f.conteo ? `${f.conteo < 0 ? 'sobran ' : ''}${cant(Math.abs(f.conteo), f.unidad)}` : '—'}</td>
                <td className="num">{cant(f.real, f.unidad)}</td>
                <td className="num"><b className={f.valor_diferencia > 0 ? 'var-mal' : f.valor_diferencia < 0 ? 'var-bien' : ''}>{pesos(f.valor_diferencia)}</b>{f.diferencia_pct !== null && <><br /><small className="ayuda">{numero(f.diferencia_pct, 1)} %</small></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </Estado>
  );
}

/* ---------- stock valorizado y mermas ---------- */
function StockYMermas({ rango }) {
  const carga = useCarga(() => get('/informes/stock', rango), [rango.desde, rango.hasta]);
  return (
    <Estado carga={carga}>
      {(d) => (
        <>
          <div className="kpis">
            <Kpi titulo="Plata en el depósito" valor={pesos(d.stock.total)} detalle="stock de hoy, al costo de cada compra" aviso={d.stock.sin_costo ? `${d.stock.sin_costo} insumos con stock pero sin costo cargado: no suman.` : null} />
            <Kpi titulo="Mermas del período" valor={pesos(d.mermas.total)} detalle={d.mermas.pct_de_ventas === null ? 'sin ventas para comparar' : `${numero(d.mermas.pct_de_ventas, 1)} % de las ventas`} />
          </div>
          <div className="rejilla" style={{ marginTop: '1rem' }}>
            <section className="tarjeta ancha">
              <h2>Qué hay y cuánto vale</h2>
              {d.stock.filas.length === 0 ? <p className="vacio">No hay stock cargado.</p> : (
                <div className="tabla-caja"><table>
                  <thead><tr><th>Insumo</th><th className="num">Hay</th><th className="num">Vale</th><th className="num solo-ancho">% del total</th></tr></thead>
                  <tbody>{d.stock.filas.map((f) => (
                    <tr key={f.id_insumo}><td><b>{f.nombre}</b></td><td className="num">{cant(f.stock_actual, f.unidad)}</td><td className="num">{f.sin_costo ? <Chip tono="aviso">sin costo</Chip> : pesos(f.valor)}</td><td className="num solo-ancho">{f.participacion_pct === null ? '—' : `${numero(f.participacion_pct, 1)} %`}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
              {d.stock.negativos.length > 0 && <p className="nota" style={{ marginTop: '.8rem' }}>Stock en negativo (se vendió sin cargar el ingreso): {d.stock.negativos.map((n) => `${n.nombre} ${cant(n.stock_actual, n.unidad)}`).join(' · ')}. No suma al valor hasta que se cargue la compra o se haga un conteo.</p>}
            </section>
            <section className="tarjeta">
              <h2>Mermas por motivo</h2>
              <BarrasH datos={d.mermas.por_motivo.map((m) => ({ etiqueta: MOTIVOS[m.motivo] ?? m.motivo, valor: m.valor, extra: `${m.movimientos} ${m.movimientos === 1 ? 'registro' : 'registros'}` }))} total={d.mermas.total} />
            </section>
            <section className="tarjeta">
              <h2>Mermas por insumo</h2>
              <BarrasH datos={d.mermas.por_insumo.slice(0, 10).map((m) => ({ etiqueta: m.nombre, valor: m.valor, extra: cant(m.cantidad, m.unidad) }))} total={d.mermas.total} />
            </section>
          </div>
        </>
      )}
    </Estado>
  );
}

/* ---------- qué comprar ---------- */
function Compras() {
  const avisar = useAviso();
  const [ventana, setVentana] = useState('14');
  const [cobertura, setCobertura] = useState('7');
  const carga = useCarga(() => get('/informes/compras', { dias: ventana, cobertura }), [ventana, cobertura]);

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); avisar('Pedido copiado'); } catch { avisar('No se pudo copiar: seleccioná el texto a mano', 'error'); }
  }
  return (
    <>
      <p className="nota nota-agua">Entra en la lista lo que está en su mínimo o por debajo, y lo que al ritmo de venta reciente dura menos de 3 días. Se pide hasta el máximo cargado (o lo que cubra los días elegidos) y, si el insumo tiene envases, en envases enteros.</p>
      <div className="herramientas">
        <Selector etiqueta="Mirar el consumo de los últimos" value={ventana} onChange={(e) => setVentana(e.target.value)}>
          {[7, 14, 30].map((n) => <option key={n} value={n}>{n} días</option>)}
        </Selector>
        <Selector etiqueta="Pedir para cubrir" value={cobertura} onChange={(e) => setCobertura(e.target.value)}>
          {[3, 7, 10, 14].map((n) => <option key={n} value={n}>{n} días</option>)}
        </Selector>
      </div>
      <Estado carga={carga} vacio={carga.datos && carga.datos.total_items === 0 ? 'Por ahora no hace falta comprar nada: todo está por encima del mínimo.' : null}>
        {(d) => (
          <>
            <p><b>{d.total_items}</b> {d.total_items === 1 ? 'producto' : 'productos'} para pedir · costo estimado <b>{pesos(d.costo_estimado)}</b></p>
            {d.proveedores.map((g) => {
              const texto = textoDePedido(g, (n) => numero(n, 2));
              return (
                <section className="tarjeta" key={g.id_proveedor ?? 'sin'} style={{ marginBottom: '1rem' }}>
                  <h2>{g.nombre} {g.urgentes > 0 && <Chip tono="malo">{g.urgentes} urgente{g.urgentes === 1 ? '' : 's'}</Chip>} <span className="ayuda" style={{ marginLeft: 'auto', fontSize: '.9rem' }}>{pesos(g.costo_estimado)}{g.sin_costo ? ' + sin costo cargado' : ''}</span></h2>
                  {(g.contacto || g.telefono) && <p className="ayuda">{[g.contacto, g.telefono].filter(Boolean).join(' · ')}</p>}
                  <div className="tabla-caja"><table>
                    <thead><tr><th>Insumo</th><th className="num">Hay</th><th className="num solo-ancho">Dura</th><th className="num">Pedir</th><th className="num solo-ancho">Costo</th></tr></thead>
                    <tbody>{g.items.map((it) => (
                      <tr key={it.id_insumo}>
                        <td><b>{it.nombre}</b> {it.urgente && <Chip tono="malo">{it.motivo === 'sin_stock' ? 'sin stock' : 'urgente'}</Chip>}</td>
                        <td className="num">{cant(it.stock_actual, it.unidad)}</td>
                        <td className="num solo-ancho">{it.dias_de_stock === null ? '—' : `${numero(it.dias_de_stock, 1)} días`}</td>
                        <td className="num"><b>{it.presentacion ? `${it.presentacion.envases} × ${it.presentacion.nombre}` : cant(it.sugerida, it.unidad)}</b>{it.presentacion && <><br /><small className="ayuda">{cant(it.sugerida, it.unidad)}</small></>}</td>
                        <td className="num solo-ancho">{it.costo_estimado === null ? <Chip tono="aviso">sin costo</Chip> : pesos(it.costo_estimado)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  <div className="acciones" style={{ marginTop: '.7rem' }}>
                    <Boton onClick={() => copiar(texto)}>Copiar pedido</Boton>
                    <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
                  </div>
                </section>
              );
            })}
          </>
        )}
      </Estado>
    </>
  );
}
