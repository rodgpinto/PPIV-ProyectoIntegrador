// Copias de seguridad desde la terminal (sirve con el servidor apagado o prendido).
//   node scripts/respaldo.js crear                 crea una copia ahora
//   node scripts/respaldo.js listar                lista las copias guardadas
//   node scripts/respaldo.js verificar <archivo>   comprueba que un archivo se puede leer y muestra su contenido
//   node scripts/respaldo.js restaurar <archivo>   REEMPLAZA todos los datos por los de la copia (hace antes una copia de lo actual)
// Con Docker:  docker compose exec app node scripts/respaldo.js crear
import { ejecutar } from '../src/modules/respaldo/cli.js';

ejecutar(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
