import { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { fechaHora, hora, horas, minutosDesde, TURNOS } from '../fmt.js';
import { Boton, Chip, Encabezado, Estado, useAviso, useCarga } from '../ui.jsx';

/** Cada empleado registra su propio ingreso y egreso, y ve las horas que lleva. */
export function Fichar() {
  const avisar = useAviso();
  const carga = useCarga(() => get('/fichajes/mio'), []);
  const [turno, setTurno] = useState('servicio');
  const [enviando, setEnviando] = useState(false);
  const [, setLatido] = useState(0);
  useEffect(() => { const t = setInterval(() => setLatido((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  async function accion(ruta, cuerpo, ok) {
    setEnviando(true);
    try { await post(ruta, cuerpo); avisar(ok); await carga.recargar(); }
    catch (e) { avisar(e.message, 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <>
      <Encabezado titulo="Mi jornada" />
      <Estado carga={carga}>
        {(d) => (
          <>
            <div className="tarjeta jornada">
              {d.abierto ? (
                <>
                  <Chip tono="ok">En jornada · {TURNOS[d.abierto.turno]}</Chip>
                  <div className="reloj">{horas(minutosDesde(d.abierto.ingreso))}</div>
                  <p>Ingresaste a las {hora(d.abierto.ingreso)}.</p>
                  <Boton tipo="primario" cargando={enviando} onClick={() => accion('/fichajes/egreso', {}, 'Egreso registrado. ¡Buen descanso!')}>Registrar egreso</Boton>
                </>
              ) : (
                <>
                  <h2>¿Empezás tu turno?</h2>
                  <div className="opciones-turno" role="radiogroup" aria-label="Turno">
                    {Object.entries(TURNOS).map(([k, t]) => (
                      <label key={k} className="opcion-turno"><input type="radio" name="turno" checked={turno === k} onChange={() => setTurno(k)} />{t}</label>
                    ))}
                  </div>
                  <Boton tipo="primario" cargando={enviando} onClick={() => accion('/fichajes/ingreso', { turno }, 'Ingreso registrado. ¡Buen turno!')}>Registrar ingreso</Boton>
                </>
              )}
            </div>
            <div className="tarjeta">
              <h3>Mis horas del {d.desde.split('-').reverse().slice(0, 2).join('/')} al {d.hasta.split('-').reverse().slice(0, 2).join('/')}</h3>
              <p className="sub" style={{ fontSize: '1.4rem', margin: '.3rem 0 .8rem' }}><b>{horas(d.minutos_total)}</b> trabajadas</p>
              {d.historial.length === 0 ? <p className="vacio">Todavía no hay jornadas en este período.</p> : (
                <div className="tabla-caja"><table>
                  <thead><tr><th>Ingreso</th><th>Egreso</th><th>Turno</th><th className="num">Horas</th></tr></thead>
                  <tbody>{d.historial.map((j) => (
                    <tr key={j.id}><td>{fechaHora(j.ingreso)}</td><td>{j.egreso ? fechaHora(j.egreso) : <Chip tono="agua">en curso</Chip>}</td><td>{TURNOS[j.turno]}</td><td className="num">{horas(j.minutos)}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          </>
        )}
      </Estado>
    </>
  );
}
