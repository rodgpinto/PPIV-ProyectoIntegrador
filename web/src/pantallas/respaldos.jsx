import { useState } from 'react';
import { descargar, get, guardarArchivo, post } from '../api.js';
import { fechaHora } from '../fmt.js';
import { Boton, Chip, Estado, useAviso, useCarga } from '../ui.jsx';

const tamano = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const hace = (h) => (h === null ? '—' : h < 1 ? 'hace menos de una hora' : h < 48 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} días`);

/** Avisos que importan: sin copias, copias atrasadas, o copias que nunca salieron del servidor. */
export function avisosDeRespaldo(e) {
  const avisos = [];
  if (e.ultima_copia_horas === null) avisos.push({ tono: 'malo', texto: 'Todavía no hay ninguna copia de seguridad. Creá una ahora.' });
  else if (e.automaticas_cada_horas > 0 && e.ultima_copia_horas > e.automaticas_cada_horas * 2 + 1) {
    avisos.push({ tono: 'malo', texto: `La última copia es ${hace(e.ultima_copia_horas)} y deberían hacerse cada ${e.automaticas_cada_horas} h: revisá que el servidor esté funcionando.` });
  } else if (e.automaticas_cada_horas === 0) {
    avisos.push({ tono: 'aviso', texto: 'Las copias automáticas están desactivadas. Solo se hacen las que creás a mano.' });
  }
  if (e.ultima_copia_horas !== null && (e.ultima_salida_horas === null || e.ultima_salida_horas > 24 * 7)) {
    avisos.push({
      tono: 'aviso',
      texto: e.ultima_salida_horas === null
        ? 'Ninguna copia salió todavía del servidor. Si el disco se rompe o se borra el servicio, se pierden también las copias: descargá una y guardala en otro lado (tu Drive, por ejemplo).'
        : `La última copia que salió del servidor fue ${hace(e.ultima_salida_horas)}. Descargá una y guardala en otro lado.`,
    });
  }
  return avisos;
}

export function Respaldos() {
  const aviso = useAviso();
  const carga = useCarga(() => get('/respaldos'), [], { cada: 60000 });
  const [creando, setCreando] = useState(false);
  const [bajando, setBajando] = useState(null);

  const crear = async () => {
    setCreando(true);
    try {
      const c = await post('/respaldos');
      aviso(`Copia creada (${tamano(c.bytes)})`);
      carga.recargar();
    } catch (e) { aviso(e.message, 'error'); } finally { setCreando(false); }
  };
  const bajar = async (nombre) => {
    setBajando(nombre);
    try {
      const { blob, nombre: n } = await descargar(`/respaldos/${encodeURIComponent(nombre)}`);
      guardarArchivo(blob, n);
      carga.recargar();
    } catch (e) { aviso(e.message, 'error'); } finally { setBajando(null); }
  };

  return (
    <Estado carga={carga}>
      {(e) => (
        <>
          {avisosDeRespaldo(e).map((a) => <p key={a.texto} className={`nota ${a.tono === 'malo' ? 'nota-mala' : ''}`} role="status">{a.texto}</p>)}
          <div className="tarjeta">
            <h2>Copias de seguridad <Chip tono={e.ultima_copia_horas !== null ? 'ok' : 'malo'}>{e.copias.length ? `última ${hace(e.ultima_copia_horas)}` : 'sin copias'}</Chip></h2>
            <p>
              {e.automaticas_cada_horas > 0 ? `El sistema hace una copia solo cada ${e.automaticas_cada_horas} h y guarda las últimas ${e.conservar}.` : 'Las copias automáticas están desactivadas.'}
              {e.copia_externa_configurada ? ' Después de cada una la envía a la copia externa configurada.' : ' Estas copias quedan en el mismo servidor: para estar a salvo, descargá una de vez en cuando.'}
            </p>
            <div className="acciones"><Boton tipo="primario" cargando={creando} onClick={crear}>Crear una copia ahora</Boton></div>
            {e.copias.length > 0 && (
              <div className="tabla-caja respaldo-lista">
                <table>
                  <thead><tr><th>Cuándo</th><th>Archivo</th><th className="num">Tamaño</th><th /></tr></thead>
                  <tbody>
                    {e.copias.map((c) => (
                      <tr key={c.nombre}>
                        <td>{fechaHora(c.creado_en)}</td>
                        <td className="archivo">{c.nombre}</td>
                        <td className="num">{tamano(c.bytes)}</td>
                        <td className="num"><Boton tipo="secundario" className="btn-chico" cargando={bajando === c.nombre} onClick={() => bajar(c.nombre)}>Descargar</Boton></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <details className="tarjeta ayuda-restaurar">
            <summary><b>Cómo restaurar una copia</b></summary>
            <p>Restaurar <b>reemplaza todos los datos</b> por los de la copia. Se hace desde la terminal del servidor, con el sistema apagado o en mantenimiento, y antes guarda automáticamente una copia de lo que había.</p>
            <ol>
              <li>Subí el archivo <code>radas-AAAAMMDD-HHMMSS.json.gz</code> a la carpeta de copias del servidor (o usá una que ya esté ahí).</li>
              <li>Comprobá que sirve: <code>npm run respaldo -- verificar ruta/al/archivo</code></li>
              <li>Restaurá: <code>npm run respaldo -- restaurar ruta/al/archivo --si</code></li>
              <li>Reiniciá el sistema. Todos tendrán que volver a iniciar sesión.</li>
            </ol>
            <p>Con Docker: <code>docker compose exec app node scripts/respaldo.js restaurar /respaldos/archivo.json.gz --si</code>. La guía completa está en <code>docs/COPIAS.md</code>.</p>
          </details>
        </>
      )}
    </Estado>
  );
}
