// Servidor de verificación: la API real sobre SQLite en memoria con datos de ejemplo.
// Sirve para probar la interfaz en un navegador cuando no hay PostgreSQL a mano. No usar en producción.
import { fileURLToPath } from 'node:url';
import { despachar } from '../src/api.js';
import { crearServidor } from '../src/http/servidor.js';
import { sembrarDemo } from '../src/seed-demo.js';
import { iniciarBase } from './ayuda.js';

await iniciarBase();
await sembrarDemo(new Date());
const puerto = Number(process.env.PORT ?? 3100);
crearServidor({ despachar, publicDir: fileURLToPath(new URL('../public', import.meta.url)) })
  .listen(puerto, '127.0.0.1', () => console.log(`Servidor de prueba en http://127.0.0.1:${puerto}`));
