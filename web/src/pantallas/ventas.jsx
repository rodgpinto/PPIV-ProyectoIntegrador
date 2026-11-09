import { useState } from 'react';
import { get } from '../api.js';
import { CANALES, diaYFecha, hoy, jornadaActual, MEDIOS, numero, pesos, porc, sumarDias } from '../fmt.js';
import { Boton, Chip, Encabezado, Entrada, Estado, useCarga } from '../ui.jsx';

export const PERIODOS = [
  ['hoy', 'Esta noche'],
  ['ayer', 'Anoche'],
  ['7', 'Últimas 7'],
  ['30', 'Últimas 30'],
  ['mes', 'Este mes'],
];

export function rangoDe(clave) {
  const j = jornadaActual();
  if (clave === 'hoy') return { desde: j, hasta: j };
  if (clave === 'ayer') { const a = sumarDias(j, -1); return { desde: a, hasta: a }; }
  if (clave === '7') return { desde: sumarDias(j, -6), hasta: j };
  if (clave === '30') return { desde: sumarDias(j, -29), hasta: j };
  return { desde: `${j.slice(0, 8)}01`, hasta: j };
}

export function Ventas() {
  const [clave, setClave] = useState('7');
  const [rango, setRango] = useState(() => rangoDe('7'));
  const carga = useCarga(() => get('/reportes/ventas', rango), [rango.desde, rango.hasta], { cada: 60000 });
  const elegir = (c) => { setClave(c); setRango(rangoDe(c)); };
  const fecha = (campo) => (e) => { if (e.target.value) { setClave(null); setRango({ ...rango, [campo]: e.target.value }); } };

  return (
    <>
      <Encabezado titulo="Ventas" sub="Lo cobrado, por noche, producto y medio de pago. La noche cuenta de 06:00 a 06:00." />
      <div className="herramientas">
        <div className="periodos" role="group" aria-label="Período">
          {PERIODOS.map(([c, t]) => <button type="button" key={c} className={`btn btn-chico ${clave === c ? 'btn-primario' : ''}`} aria-pressed={clave === c} onClick={() => elegir(c)}>{t}</button>)}
        </div>
        <Entrada etiqueta="Desde" type="date" value={rango.desde} max={rango.hasta} onChange={fecha('desde')} />
        <Entrada etiqueta="Hasta" type="date" value={rango.hasta} min={rango.desde} max={hoy()} onChange={fecha('hasta')} />
      </div>
      <Estado carga={carga} vacio={carga.datos && carga.datos.resumen.cuentas === 0 ? 'No hay ventas cobradas en este período.' : null}>
        {(d) => <Reporte d={d} />}
      </Estado>
    </>
  );
}

function Reporte({ d }) {
  const r = d.resumen;
  return (
    <div className="reporte">
      <div className="kpis">
        <Kpi titulo="Ventas" valor={pesos(r.ventas)} detalle={`${numero(r.unidades)} unidades`} />
        <Kpi titulo="Cuentas cobradas" valor={numero(r.cuentas)} detalle={`${numero(d.por_jornada.length)} ${d.por_jornada.length === 1 ? 'noche' : 'noches'} con ventas`} />
        <Kpi titulo="Ticket promedio" valor={pesos(r.ticket_promedio)} detalle="por cuenta" />
        <Kpi titulo="Margen" valor={porc(r.margen_pct)} detalle={r.margen_pct === null ? 'faltan costos' : `${pesos(r.margen)} de ganancia bruta`}
          aviso={r.margen_incompleto ? `Hay ${r.lineas_sin_costo} ${r.lineas_sin_costo === 1 ? 'línea' : 'líneas'} de productos sin receta: no entran en el margen.` : null} />
      </div>

      {r.anulado.lineas > 0 && <p className="nota">Se anularon {r.anulado.lineas} {r.anulado.lineas === 1 ? 'línea' : 'líneas'} por {pesos(r.anulado.monto)} en cuentas cobradas. No suman a las ventas.</p>}

      <div className="rejilla">
        <section className="tarjeta ancha">
          <h2>Ventas por noche</h2>
          <Columnas datos={d.por_jornada.map((j) => ({ clave: j.fecha, etiqueta: diaYFecha(j.fecha), valor: j.ventas, titulo: `${diaYFecha(j.fecha)}: ${pesos(j.ventas)} en ${j.cuentas} cuentas (ticket ${pesos(j.ticket_promedio)})` }))} formato={pesos} vacio="Sin ventas." />
        </section>
        <section className="tarjeta ancha">
          <h2>Pedidos por hora</h2>
          <Columnas datos={d.por_hora.map((h) => ({ clave: h.hora, etiqueta: `${String(h.hora).padStart(2, '0')} h`, valor: h.ventas, titulo: `${String(h.hora).padStart(2, '0')}:00 — ${numero(h.unidades)} unidades, ${pesos(h.ventas)}` }))} formato={pesos} />
          <p className="ayuda">Cuándo se piden las cosas (no cuándo se cobran): sirve para armar los turnos.</p>
        </section>
        <section className="tarjeta">
          <h2>Medio de pago</h2>
          <BarrasH datos={d.por_medio.map((m) => ({ etiqueta: MEDIOS[m.medio_pago], valor: m.ventas, extra: `${m.cuentas} ${m.cuentas === 1 ? 'cuenta' : 'cuentas'}` }))} total={r.ventas} />
        </section>
        <section className="tarjeta">
          <h2>Canal</h2>
          <BarrasH datos={d.por_canal.map((c) => ({ etiqueta: CANALES[c.canal], valor: c.ventas, extra: `${c.cuentas} ${c.cuentas === 1 ? 'cuenta' : 'cuentas'}` }))} total={r.ventas} />
          <h3 style={{ margin: '1rem 0 .4rem' }}>Quién abrió la cuenta</h3>
          <BarrasH datos={d.por_usuario.map((u) => ({ etiqueta: u.nombre, valor: u.ventas, extra: `${u.cuentas} cuentas` }))} total={r.ventas} />
        </section>
        <section className="tarjeta">
          <h2>Categorías</h2>
          <BarrasH datos={d.por_categoria.map((c) => ({ etiqueta: c.categoria, valor: c.ventas, extra: c.margen_pct === null ? 'sin costo' : `margen ${porc(c.margen_pct)}` }))} total={r.ventas} />
        </section>
      </div>

      <section className="tarjeta" style={{ marginTop: '1rem' }}>
        <h2>Productos <Boton className="btn-chico" onClick={() => descargarCsv(d)} style={{ marginLeft: 'auto' }}>Descargar CSV</Boton></h2>
        <div className="tabla-caja"><table>
          <thead><tr><th>Producto</th><th className="solo-ancho">Categoría</th><th className="num">Unidades</th><th className="num">Ventas</th><th className="num solo-ancho">Costo</th><th className="num">Margen</th></tr></thead>
          <tbody>{d.por_producto.map((p) => (
            <tr key={p.id_producto}>
              <td><b>{p.nombre}</b></td><td className="solo-ancho">{p.categoria}</td>
              <td className="num">{numero(p.unidades)}</td><td className="num">{pesos(p.ventas)}</td>
              <td className="num solo-ancho">{p.sin_costo && p.costo === 0 ? '—' : pesos(p.costo)}</td>
              <td className="num">{p.margen_pct === null ? <Chip tono="aviso">sin receta</Chip> : <>{porc(p.margen_pct)}{p.sin_costo && <> <Chip tono="aviso">parcial</Chip></>}</>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="ayuda" style={{ marginTop: '.5rem' }}>El costo es el de la receta al momento de cada venta. Margen = (ventas − costo) ÷ ventas.</p>
      </section>
    </div>
  );
}

export function Kpi({ titulo, valor, detalle, aviso }) {
  return (
    <div className="kpi">
      <span className="kpi-titulo">{titulo}</span>
      <b className="kpi-valor">{valor}</b>
      <span className="ayuda">{detalle}</span>
      {aviso && <small className="kpi-aviso">{aviso}</small>}
    </div>
  );
}

/** Barras verticales de una sola serie: la altura es el monto; el valor se lee al pasar el cursor o en la tabla de abajo. */
export function Columnas({ datos, formato, vacio = 'Sin datos.' }) {
  if (!datos.length) return <p className="vacio">{vacio}</p>;
  const max = Math.max(...datos.map((x) => x.valor), 1);
  return (
    <div className="columnas" role="img" aria-label={datos.map((x) => `${x.etiqueta}: ${formato(x.valor)}`).join('. ')}>
      {datos.map((x) => (
        <div className="columna" key={x.clave} title={x.titulo}>
          <span className="columna-valor">{formato(x.valor)}</span>
          <span className="columna-barra" style={{ height: `${Math.max(2, (x.valor / max) * 100)}%` }} />
          <span className="columna-etiqueta">{x.etiqueta}</span>
        </div>
      ))}
    </div>
  );
}

/** Barras horizontales con el monto y su parte del total. */
export function BarrasH({ datos, total }) {
  const con = datos.filter((x) => x.valor > 0 || datos.length <= 4);
  if (!con.length) return <p className="vacio">Sin datos.</p>;
  const max = Math.max(...con.map((x) => x.valor), 1);
  return (
    <ul className="barras-h">
      {con.map((x) => (
        <li key={x.etiqueta}>
          <div className="barra-h-cab"><span>{x.etiqueta}</span><b>{pesos(x.valor)}</b></div>
          <div className="barra-h-pista"><span style={{ width: `${(x.valor / max) * 100}%` }} /></div>
          <small className="ayuda">{total > 0 ? `${numero((x.valor / total) * 100, 1)} % · ` : ''}{x.extra}</small>
        </li>
      ))}
    </ul>
  );
}

function descargarCsv(d) {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = [['Producto', 'Categoría', 'Unidades', 'Ventas', 'Costo', 'Margen', 'Margen %'],
    ...d.por_producto.map((p) => [p.nombre, p.categoria, p.unidades, p.ventas, p.costo, p.margen, p.margen_pct ?? ''])];
  const texto = `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `ventas-${d.desde}_${d.hasta}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
