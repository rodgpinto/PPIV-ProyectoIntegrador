# Copias de seguridad

Las ventas, la carta, el stock, las horas del personal y la auditoría están en la base de datos. Si se pierde la base y no hay copia, se pierde todo el historial. Por eso las copias se hacen de tres maneras:

1. **Automáticas, dentro del sistema.** Cada 12 horas la aplicación guarda un archivo en su propio disco. Protege de errores humanos (un cambio mal hecho, datos pisados), pero no de que se pierda el servidor.
2. **Nocturnas, fuera del servidor.** Una acción de GitHub baja la base de Neon todas las noches y guarda el archivo 90 días (ver [`DESPLIEGUE.md`](DESPLIEGUE.md), paso 7). Esta es la que cuenta como respaldo real, sobre todo en Render, donde el disco se borra en cada reinicio.
3. **Descarga manual.** Una vez por semana, el administrador entra a *Sistema → Copias de seguridad*, descarga la última y la guarda en su Drive o en el correo. No depende de ninguna configuración.

Una copia que solo está en el mismo servidor no es una copia de seguridad.

## Qué contiene un archivo de copia

Un archivo `radas-AAAAMMDD-HHMMSS.json.gz` (hora de Buenos Aires) con todas las tablas en JSON comprimido, el motor de origen y la fecha. Incluye usuarios (con las claves ya cifradas), carta, insumos, recetas, lotes, movimientos de stock, pedidos, cierres de caja, fichajes, mesas y auditoría. No incluye las sesiones abiertas: después de restaurar, todos vuelven a iniciar sesión.

No depende del motor: una copia hecha en PostgreSQL se puede restaurar en otra instalación de PostgreSQL (las pruebas del proyecto también la restauran en SQLite). Pesa poco: unos 11 KB con los datos de ejemplo y algunos MB después de un año de uso.

## Cómo se hacen

**Automáticas.** Al arrancar y cada 10 minutos, el servidor mira cuándo fue la última copia y, si pasaron más de `RESPALDO_CADA_HORAS` (12 por defecto), crea otra. Si estuvo apagado, la atrasada se hace apenas vuelve. Se conservan las últimas `RESPALDO_CONSERVAR` (40) y las más viejas se borran. Cada copia deja una línea en la auditoría.

**Desde la aplicación** (administrador): *Sistema → Copias de seguridad* muestra la antigüedad de la última copia, con un aviso en rojo si hace demasiado, y permite crear una ahora y descargar cualquiera. Conviene crear una antes de un cambio grande, como cambiar todos los precios o cargar muchos productos.

**Desde la terminal:**

```bash
node scripts/respaldo.js crear                 # crea una copia ahora
node scripts/respaldo.js listar                # lista las copias guardadas
node scripts/respaldo.js verificar <archivo>   # comprueba que se puede leer y muestra las filas de cada tabla
node scripts/respaldo.js restaurar <archivo>   # muestra lo que haría; con --si, lo hace
```

Con Docker, los mismos comandos van precedidos de `docker compose -f docker-compose.prod.yml exec app`.

## Restaurar

Hace falta restaurar cuando se perdió o dañó la base, o cuando alguien cargó algo mal y se prefiere volver a un momento anterior. La restauración **reemplaza todo** lo que hay por lo que tenía la copia: lo cargado después de esa copia se pierde. Antes de restaurar, el comando guarda una copia de lo actual.

1. Conseguir el archivo: descargarlo desde la pantalla de copias, o desde la sección *Artifacts* de la ejecución en GitHub Actions (viene dentro de un `.zip`).
2. Verificarlo, sin tocar nada: `node scripts/respaldo.js verificar <archivo>`. Muestra la fecha de la copia y las filas por tabla. Si falla acá, no se modificó nada y se puede probar con una copia anterior.
3. Ver qué haría: el mismo comando con `restaurar` en lugar de `verificar` lista lo que se reemplazaría y pide confirmar.
4. Restaurar: repetirlo agregando `--si`. Todo ocurre en una sola transacción: o queda todo restaurado o no cambia nada.
5. Reiniciar la aplicación y volver a entrar.
6. Controlar las ventas de las últimas noches, la carta y el stock.

En Render la restauración se hace desde una computadora, apuntando a la base de Neon (Render gratuito no tiene consola):

```bash
export DATABASE_URL="postgresql://…?sslmode=require"     # PowerShell: $env:DATABASE_URL="..."
export NODE_ENV=production
node scripts/respaldo.js restaurar radas-20261020-031700.json.gz --si
```

Después se reinicia el servicio desde el panel de Render (**Manual Deploy → Restart**).

## Probar la restauración

Una copia que nunca se restauró no es una garantía. Con el sistema andando:

1. Crear una copia y descargarla.
2. En otra instalación (la computadora de desarrollo con `npm run dev` sirve), copiarla a `.data/respaldos/` y correr `verificar` y `restaurar --si`.
3. Entrar y comprobar que están los usuarios, la carta y las ventas.

Las pruebas automáticas (`test/respaldo.test.js`) cubren crear, verificar, restaurar en una transacción, que un archivo dañado no toque nada, el orden de las tablas, que ninguna tabla nueva quede afuera de la copia y el uso desde la terminal. Aun así, conviene ensayarlo con los datos y el servidor reales.

## Variables

| Variable | Por defecto | Qué hace |
|---|---|---|
| `RESPALDO_DIR` | `.data/respaldos` (`/datos/respaldos` en Docker) | Carpeta de las copias |
| `RESPALDO_CADA_HORAS` | `12` | Cada cuánto se hace una copia automática (`0` = ninguna) |
| `RESPALDO_CONSERVAR` | `40` | Cuántas copias se guardan en el servidor |
| `RESPALDO_COMANDO_EXTERNO` | vacío | Comando que se ejecuta después de cada copia, para subirla a otro lado |

## Si algo falla

- «Sin copias» o «última copia hace X días» en rojo: falló el programador o la carpeta no se puede escribir. Se revisan los logs de la aplicación (con Docker, que `respaldos/` pertenezca al usuario 1000).
- «Ninguna copia salió del servidor»: no hay copia externa configurada o el comando falla. La línea fallida queda en la auditoría.
- `verificar` dice que el archivo no es una copia de RADAS: el archivo se cortó al descargarlo o se renombró mal. Probar con otro.
- En GitHub Actions no aparece el adjunto: el secreto `DATABASE_URL` no está cargado o es incorrecto; el log de la ejecución lo indica.

## Alternativa para un servidor propio

Fuera de Render se puede subir cada copia a otro lugar con rclone, por ejemplo a un bucket privado de Backblaze B2 (que ofrece 10 GB gratis; las copias pesan unos pocos MB). Se configura rclone con una clave limitada a ese bucket y se agrega una de estas dos opciones:

```bash
# con Docker, en el crontab del servidor (las copias quedan en ./respaldos)
*/30 * * * *  rclone copy /opt/radas/respaldos b2radas:radas-copias --max-age 2d

# sin Docker, en el .env: el sistema lo ejecuta después de cada copia ({archivo} es la ruta completa)
RESPALDO_COMANDO_EXTERNO=rclone copy {archivo} b2radas:radas-copias
```

Se usa `rclone copy` y no `rclone sync`, porque `sync` borraría en el bucket lo que la aplicación depura en el servidor, y el bucket tiene que guardar más historia que el servidor. Si el comando falla, queda registrado en la auditoría como «Copia enviada fuera del servidor — fallido».

También se puede volcar la base completa con las herramientas de PostgreSQL (`pg_dump`) como segunda red de seguridad, aunque las copias de RADAS alcanzan por sí solas.
