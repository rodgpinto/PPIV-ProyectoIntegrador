import { fileURLToPath } from 'node:url';
import { despachar } from './api.js';
import { asegurarAdministrador, prepararBase } from './bootstrap.js';
import { config } from './config.js';
import { conectarDb, db } from './db.js';
import { crearServidor } from './http/servidor.js';
import { iniciarRespaldos } from './modules/respaldo/programador.js';

try {
  await conectarDb(config);
  await prepararBase();
  await asegurarAdministrador(config.admin);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const servidor = crearServidor({
  despachar,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  trustProxy: config.trustProxy,
});

const detenerRespaldos = iniciarRespaldos();
servidor.listen(config.port, () => {
  console.log(`RADAS escuchando en http://localhost:${config.port}  (base: ${db.nombre})`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    detenerRespaldos();
    servidor.close(async () => {
      await db.cerrar();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
