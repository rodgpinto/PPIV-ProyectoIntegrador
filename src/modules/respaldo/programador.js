import { config } from '../../config.js';
import { hacerRespaldoAutomatico, listar } from './respaldo.servicio.js';

const REVISAR_CADA_MS = 10 * 60 * 1000;

/**
 * Cada 10 minutos mira si la última copia es más vieja que RESPALDO_CADA_HORAS y, si es así, hace otra.
 * Al arrancar también revisa: si el servidor estuvo apagado, la copia atrasada se hace enseguida.
 * Usa la fecha de la última copia en disco, así reiniciar el servidor muchas veces no genera copias de más.
 */
export function iniciarRespaldos({ log = console } = {}) {
  const { cadaHoras, dir } = config.respaldo;
  if (!(cadaHoras > 0)) {
    log.log('Copias automáticas desactivadas (RESPALDO_CADA_HORAS=0).');
    return () => {};
  }
  let ocupado = false;
  const revisar = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const ultima = listar(dir)[0];
      const vencida = !ultima || Date.now() - new Date(ultima.creado_en).getTime() >= cadaHoras * 3_600_000;
      if (vencida) {
        const r = await hacerRespaldoAutomatico();
        log.log(`Copia de seguridad: ${r.nombre} (${Math.round(r.bytes / 1024)} KB)${r.externo ? (r.externo.ok ? ', enviada afuera' : `, FALLÓ el envío afuera: ${r.externo.salida}`) : ''}`);
      }
    } catch (error) {
      log.error('No se pudo hacer la copia de seguridad:', error.message);
    } finally {
      ocupado = false;
    }
  };
  const inicial = setTimeout(revisar, 15_000);
  const timer = setInterval(revisar, REVISAR_CADA_MS);
  inicial.unref();
  timer.unref();
  return () => { clearTimeout(inicial); clearInterval(timer); };
}
