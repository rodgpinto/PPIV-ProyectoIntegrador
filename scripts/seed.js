// Carga datos de ejemplo en la base de desarrollo.
//   npm run seed                      escenario completo: 4 semanas de funcionamiento (el que se usa para probar y demostrar)
//   npm run seed -- --dias=14         cambia cuántos días hacia atrás se simulan
//   npm run seed -- --basico          el conjunto chico de siempre (una semana, pocos productos)
//   npm run seed -- --reiniciar       borra la base de desarrollo local y la carga de cero (con el servidor apagado)
import { rmSync } from 'node:fs';
import { config } from '../src/config.js';
import { conectarDb, db } from '../src/db.js';
import { prepararBase } from '../src/bootstrap.js';
import { CLAVE_DEMO, sembrarDemo, USUARIOS_DEMO } from '../src/seed-demo.js';
import { sembrarCompleto, USUARIOS_COMPLETO } from '../src/seed-completo.js';

const args = process.argv.slice(2);
const basico = args.includes('--basico');
const reiniciar = args.includes('--reiniciar');
const dias = Number(args.find((a) => a.startsWith('--dias='))?.split('=')[1] ?? 28);

if (config.produccion) {
  console.error('No se cargan datos de ejemplo en producción: crean usuarios con claves conocidas.');
  process.exit(1);
}
if (!Number.isInteger(dias) || dias < 1 || dias > 120) {
  console.error('--dias tiene que ser un número entre 1 y 120.');
  process.exit(1);
}
if (reiniciar) {
  if (config.databaseUrl) {
    console.error('--reiniciar solo funciona con la base local (sin DATABASE_URL): no se borra una base de PostgreSQL desde acá.');
    process.exit(1);
  }
  if (config.pgliteDir !== 'memory') {
    rmSync(config.pgliteDir, { recursive: true, force: true });
    console.log('Base local borrada.');
  }
}

await conectarDb(config);
await prepararBase();
const inicio = Date.now();
const resultado = basico ? await sembrarDemo() : await sembrarCompleto({ dias, avisar: () => process.stdout.write('.') });
if (!resultado) {
  console.log('Ya hay datos cargados: no se cambió nada. Para empezar de cero: npm run seed -- --reiniciar');
} else {
  console.log(`\nDatos de ejemplo cargados en ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
  if (!basico) {
    console.log(`Se simularon ${resultado.dias} días hasta el ${resultado.hoy}: ${resultado.cuentas} cuentas cobradas por $ ${Math.round(resultado.ventas).toLocaleString('es-AR')},`);
    console.log(`${resultado.cierres} cierres de caja, ${resultado.ingresos} ingresos de mercadería, ${resultado.mermas} mermas y ${resultado.fichajes} fichajes.`);
  }
  console.log('Usuarios (clave para todos: %s):', CLAVE_DEMO);
  for (const [nombre, email, rol] of basico ? USUARIOS_DEMO : USUARIOS_COMPLETO) console.log(`  ${email.padEnd(22)} ${rol}  (${nombre})`);
}
await db.cerrar();
