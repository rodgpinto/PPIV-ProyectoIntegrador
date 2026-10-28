// Lógica de scripts/respaldo.js (separada para poder probarla sin una terminal).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { conectarDb, db } from '../../db.js';
import { prepararBase } from '../../bootstrap.js';
import { registrar } from '../auditoria/auditoria.servicio.js';
import { crearRespaldo, depurar, enviarAfuera, interpretar, listar, restaurar } from './respaldo.servicio.js';

export const AYUDA = 'Uso: node scripts/respaldo.js crear | listar | verificar <archivo> | restaurar <archivo> [--si]';

const tamano = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const resumenFilas = (filas) => Object.entries(filas).map(([t, n]) => `${t}: ${n}`).join(', ');

const conectarNormal = async () => {
  await conectarDb(config);
  await prepararBase();
};

/** `conectar` y `cerrar` se pueden reemplazar en las pruebas, que ya tienen su propia base. */
export async function ejecutar(argumentos, { salida = console, conectar = conectarNormal, cerrar = true } = {}) {
  const [orden, archivo, ...resto] = argumentos;
  if (!['crear', 'listar', 'verificar', 'restaurar'].includes(orden)) throw new Error(AYUDA);

  if (orden === 'listar') {
    const copias = listar();
    if (!copias.length) salida.log(`No hay copias en ${path.resolve(config.respaldo.dir)}`);
    for (const c of copias) salida.log(`${c.nombre}  ${tamano(c.bytes).padStart(8)}  ${c.creado_en}`);
    return;
  }

  if (orden === 'verificar') {
    if (!archivo) throw new Error(AYUDA);
    const datos = interpretar(readFileSync(archivo));
    salida.log(`Copia válida. Creada: ${datos.creado_en}. Motor de origen: ${datos.motor}.`);
    salida.log(resumenFilas(datos.filas));
    return;
  }

  await conectar();
  try {
    if (orden === 'crear') {
      const c = await crearRespaldo();
      depurar();
      salida.log(`Copia creada: ${path.resolve(config.respaldo.dir, c.nombre)} (${tamano(c.bytes)})`);
      salida.log(resumenFilas(c.filas));
      const externo = await enviarAfuera(path.resolve(config.respaldo.dir, c.nombre));
      if (externo) salida.log(externo.ok ? 'Enviada a la copia externa.' : `FALLÓ el envío afuera: ${externo.salida}`);
      return;
    }

    // restaurar
    if (!archivo) throw new Error(AYUDA);
    const datos = interpretar(readFileSync(archivo)); // si el archivo está mal, falla ANTES de tocar nada
    salida.log(`Se va a reemplazar TODO lo que hay en "${db.nombre}" por la copia del ${datos.creado_en}:`);
    salida.log(resumenFilas(datos.filas));
    if (!resto.includes('--si')) {
      salida.log('\nPara confirmar, repetí el comando agregando --si al final.');
      return;
    }
    const previa = await crearRespaldo();
    salida.log(`Antes de restaurar se guardó una copia de lo actual: ${previa.nombre}`);
    await restaurar(datos);
    await registrar({ accion: 'respaldo.restaurar', entidad: 'respaldo', id_entidad: path.basename(archivo), detalle: { copia_previa: previa.nombre, creada: datos.creado_en } });
    salida.log('Restauración completa. Reiniciá el servidor si estaba prendido; todos tendrán que volver a iniciar sesión.');
  } finally {
    if (cerrar) await db.cerrar();
  }
}
