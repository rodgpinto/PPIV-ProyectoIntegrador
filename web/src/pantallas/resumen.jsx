import { get } from '../api.js';
import { fechaCorta, hora, horas, numero, pesos, UNIDADES, ROLES } from '../fmt.js';
import { Chip, Encabezado, Estado, useCarga } from '../ui.jsx';

export function Resumen() {
  const carga = useCarga(async () => {
    const [alertas, presentes, mesas, cuentas, caja] = await Promise.all([get('/stock/alertas'), get('/fichajes/presentes'), get('/mesas'), get('/pedidos'), get('/caja/jornada')]);
    return { alertas, presentes, mesas, cuentas, caja };
  }, [], { cada: 30000 });

  return (
    <>
      <Encabezado titulo="Resumen" sub="Lo que necesita tu atención ahora." />
      <Estado carga={carga}>
        {({ alertas: a, presentes, mesas, cuentas, caja }) => (
          <div className="rejilla">
            <section className="tarjeta">
              <h2>Stock {a.total ? <Chip tono="malo">{a.total} alertas</Chip> : <Chip tono="ok">todo en orden</Chip>}</h2>
              {a.vencidos.length > 0 && <Bloque titulo="Vencidos" tono="malo" items={a.vencidos.map((x) => [x.nombre, `${numero(x.cantidad)} ${UNIDADES[x.unidad]} · venció hace ${x.dias_vencido} d`])} />}
              {a.por_vencer.length > 0 && <Bloque titulo="Por vencer" tono="aviso" items={a.por_vencer.map((x) => [x.nombre, `${numero(x.cantidad)} ${UNIDADES[x.unidad]} · ${fechaCorta(x.fecha_vencimiento)} (${x.dias_restantes === 0 ? 'hoy' : `${x.dias_restantes} d`})`])} />}
              {a.reponer.length > 0 && <Bloque titulo="Reponer" tono="malo" items={a.reponer.map((x) => [x.nombre, `quedan ${numero(x.stock_actual)} ${UNIDADES[x.unidad]} · faltan ${numero(x.faltante)}`])} />}
              {a.sobrestock.length > 0 && <Bloque titulo="Sobrestock" tono="aviso" items={a.sobrestock.map((x) => [x.nombre, `${numero(x.exceso)} ${UNIDADES[x.unidad]} de más · ${x.dias_en_stock} d en depósito`])} />}
              {a.total > 0 && <p><a href="#/stock">Ver todas las alertas →</a></p>}
            </section>
            <section className="tarjeta">
              <h2>Trabajando ahora <Chip tono="agua">{presentes.length}</Chip></h2>
              {presentes.length === 0 ? <p className="vacio">Nadie registró ingreso.</p> : (
                <ul className="lista-simple">
                  {presentes.map((p) => (
                    <li key={p.id}><span>{p.nombre} <small className="ayuda">{ROLES[p.rol]}</small></span>
                      <span>{p.posible_olvido ? <Chip tono="malo">¿olvidó el egreso?</Chip> : `desde ${hora(p.ingreso)} · ${horas(p.minutos)}`}</span></li>
                  ))}
                </ul>
              )}
              <p><a href="#/personal">Horas del personal →</a></p>
            </section>
            <section className="tarjeta">
              <h2>Caja de esta noche {caja.cerrada ? <Chip tono="ok">cerrada</Chip> : <Chip tono="agua">abierta</Chip>}</h2>
              <p style={{ fontSize: '1.6rem', fontFamily: 'var(--titulo)' }}><b>{pesos(caja.ventas_total)}</b> <small className="ayuda">cobrado</small></p>
              <p className="ayuda">{caja.cuentas} {caja.cuentas === 1 ? 'cuenta cobrada' : 'cuentas cobradas'} · {pesos(caja.ventas_efectivo)} en efectivo</p>
              <p><a href="#/caja">Caja →</a> · <a href="#/ventas">Ventas →</a></p>
            </section>
            <section className="tarjeta">
              <h2>Cuentas abiertas <Chip tono="agua">{cuentas.length}</Chip></h2>
              <p style={{ fontSize: '1.6rem', fontFamily: 'var(--titulo)' }}><b>{pesos(cuentas.reduce((s, c) => s + c.total, 0))}</b> <small className="ayuda">por cobrar</small></p>
              <p className="ayuda">{cuentas.reduce((s, c) => s + c.items.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando').length, 0)} pedidos en preparación · {cuentas.reduce((s, c) => s + c.items.filter((i) => i.estado === 'listo').length, 0)} listos para llevar</p>
              <p><a href="#/pedidos">Ver pedidos →</a> · <a href="#/kds">Cocina y barra →</a></p>
            </section>
            <section className="tarjeta">
              <h2>Salón</h2>
              <p style={{ fontSize: '1.6rem', fontFamily: 'var(--titulo)' }}><b>{mesas.resumen.lugares_libres}</b> <small className="ayuda">lugares libres de {mesas.resumen.aforo}</small></p>
              <p className="ayuda">{mesas.resumen.ocupadas} de {mesas.resumen.mesas} mesas ocupadas</p>
              <p><a href="#/mesas">Ver mesas →</a></p>
            </section>
          </div>
        )}
      </Estado>
    </>
  );
}

function Bloque({ titulo, tono, items }) {
  return (
    <div style={{ marginBottom: '.8rem' }}>
      <h3 className={`tono-${tono}`}>{titulo}</h3>
      <ul className="lista-simple">{items.map(([n, d], i) => <li key={i}><span>{n}</span><span className="ayuda">{d}</span></li>)}</ul>
    </div>
  );
}
