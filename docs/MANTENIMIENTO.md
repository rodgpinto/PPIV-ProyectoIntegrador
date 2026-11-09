# Guía para desarrolladores

Notas para quien tenga que modificar o ampliar RADAS. Cubre cómo está organizado el código, cómo agregar rutas, tablas y pantallas, y los detalles que más fácil se pasan por alto.

## Cómo está armado

Es un solo servicio Node.js (22.5 o más nuevo) que sirve tres cosas: la API (`/api/...`), la interfaz del personal (React compilado) y la carta pública para los clientes (`/carta`). La base es PostgreSQL. No usamos Express ni otro framework de servidor: alcanza con el módulo `http` de Node y la única dependencia de ejecución es `pg`. En desarrollo no hace falta instalar una base, porque sin `DATABASE_URL` se usa PGlite (PostgreSQL embebido).

El texto que ve el usuario y los nombres del código (tablas, funciones, variables) están en castellano.

```bash
npm install
npm run seed      # datos de ejemplo (solo en desarrollo); npm run seed:reiniciar los vuelve a cargar de cero
npm run dev       # http://localhost:3000
npm test          # todas las pruebas, sin instalar ninguna base
```

Los usuarios de ejemplo son `admin@radas.test`, `cajero@`, `barra@`, `camarero@`, `host@` y `cocina@`, todos con la clave `radas1234`.

## Estructura

```
sql/schema.sql            Esquema completo; se aplica en cada arranque, por eso es idempotente
sql/datos-ejemplo.sql     Datos de demostración para un PostgreSQL común
src/
  server.js               Arranque: base, tablas, administrador inicial, copias, puerto
  config.js               Variables de entorno
  db.js                   Acceso a la base (pg o PGlite): db.query y db.transaction
  api.js                  Lista de todas las rutas
  roles.js                Grupos de roles (PEDIDOS, KDS, CAJA, MERMAS…)
  http/                   Servidor HTTP, despachador de rutas, validación, errores y carta pública
  domain/                 Reglas de negocio puras (sin base ni HTTP)
  modules/<área>/         <área>.rutas.js y <área>.servicio.js
web/
  src/app.jsx             Menú y pantallas
  src/pantallas/          Una pantalla por archivo
  src/ui.jsx, fmt.js, api.js   Componentes comunes, formatos y cliente de la API
  estilos.css
scripts/                  seed.js, build-web.js, respaldo.js
test/                     Pruebas automáticas y test/e2e (navegador)
deploy/                   Caddyfile y servicio de systemd
```

Las cuentas de costos, fechas, vencimientos, caja o informes viven en `src/domain/` como funciones puras. Los módulos solo traen datos de la base, llaman a esas funciones y guardan el resultado. Así esas reglas se prueban sin base de datos y la interfaz puede importar las mismas funciones (por ejemplo, `informes.jsx` usa `src/domain/informes.js`).

## Conceptos del dominio

**Noche comercial.** Va de 06:00 a 06:00 (`JORNADA_INICIO_HORA`): lo vendido a la 01:00 del sábado cuenta en la noche del viernes. Las fechas se calculan siempre en hora de Buenos Aires (`ZONA_HORARIA`) con `src/domain/fechas.js`, nunca con la zona del servidor.

**Unidades de los insumos.** Todo se guarda en la unidad base (ml, g o unidad). Las presentaciones («Botella 750 ml») son solo una ayuda para cargar y leer cantidades (`domain/presentaciones.js`).

**Stock.** Cada ingreso es un lote y la salida sigue FEFO: primero lo que vence antes. Cada venta descarga lotes según la receta y deja un `movimiento_stock` que referencia la línea (`item:ID`). El stock del insumo y la suma de sus lotes tienen que coincidir; hay pruebas que lo controlan. El stock puede quedar negativo a propósito (se vendió antes de cargar la compra) y el siguiente ingreso lo cubre.

**Pedidos.** Una cuenta pasa de abierta a cerrada (cobrada) o cancelada. Cada línea tiene su estado (pendiente, preparando, listo, entregado, anulado) y un destino, barra o cocina, que decide en qué pantalla aparece.

**Caja.** Un cierre por noche y por canal: `todos`, o `mesa` y `barra` por separado, sin mezclar modos en la misma noche. Con la caja de un canal cerrada ya no se cobra en ese canal.

**Baja y eliminación.** `DELETE /<recurso>/:id` da de baja (`activo = false`) y conserva el historial. `DELETE /<recurso>/:id/definitivo` borra la fila de verdad, pero solo si nada la usa; si tiene ventas, compras o movimientos responde 409 con un mensaje que explica el motivo. La lógica común está en `eliminarSinHistorial` (`src/modules/catalogo/util.js`). Los usuarios solo se dan de baja.

**Ticket.** `web/src/pantallas/ticket.jsx` no es un comprobante fiscal y los datos del local están en `NEGOCIO`. Al imprimir, una regla `@media print` oculta la aplicación y deja solo el ticket. La facturación electrónica no está implementada; el diseño está en [`FACTURACION.md`](FACTURACION.md).

Los precios son finales, con IVA incluido.

## Cómo agregar cosas

### Una ruta en la API

En `src/modules/<área>/<área>.rutas.js` se agrega un objeto a la lista:

```js
{
  metodo: 'POST', ruta: '/cosas/:id/algo', roles: PEDIDOS, status: 200,
  handler: ({ params, body, usuario, ahora }) =>
    servicio.hacerAlgo(idDe(params.id), validar(esquemaAlgo, body), usuario, ahora),
},
```

`roles` viene de `src/roles.js`; `publico: true` se usa solo en rutas sin sesión (login y `/api/salud`). El cuerpo se valida con `validar` y los ids con `idDe`.

Si la ruta modifica datos (POST, PUT, PATCH o DELETE) también hay que agregar su etiqueta en `ETIQUETAS`, dentro de `src/domain/auditoria.js`:

```js
'POST /cosas/:id/algo': ['cosa.algo', 'Hizo algo con una cosa', 'cosa'],
```

Una prueba falla si falta una etiqueta o si sobra una sin ruta. Para que la auditoría guarde el antes y el después se agrega una línea en `src/modules/auditoria/instantaneas.js`, o se llama a `auditar({ detalle })` dentro del handler.

### Una tabla o una columna

Se edita `sql/schema.sql`. Como se ejecuta en cada arranque, todo tiene que poder correr dos veces: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Para una columna nueva en una tabla que ya existe se agrega un bloque `DO $$ … ALTER TABLE … ADD COLUMN IF NOT EXISTS … $$;` (hay ejemplos en `cierre_caja` y `auditoria`). Las pruebas con SQLite ignoran los bloques `DO`, así que la columna o tabla también tiene que figurar en el `CREATE TABLE` base.

La tabla nueva hay que agregarla a `TABLAS` en `src/modules/respaldo/respaldo.servicio.js`, respetando el orden de las claves foráneas. Si no, la copia de seguridad no la incluye; la prueba `el respaldo cubre todas las tablas del esquema` falla para avisarlo. Las tablas de datos efímeros, como `sesion`, van en `TABLAS_EXCLUIDAS`.

En producción no se borran ni renombran columnas en un solo paso: se agrega la nueva, se migran los datos y la vieja se retira en una versión posterior.

### Una pantalla

Se crea `web/src/pantallas/cosa.jsx` con un componente que use los de `ui.jsx` (`Encabezado`, `Estado` y `useCarga`, `Boton`, `Modal`, `Pestanas`, `useAviso`) y `fmt.js` para los formatos. Se registra en `PANTALLAS`, en `web/src/app.jsx`, con su ruta, título y roles, y se compila con `npm run build` (o con `npm run dev`).

Los números se escriben a la argentina (`5.000` es cinco mil y `1.500,50` mil quinientos con cincuenta). Para leerlos de un formulario se usan `aNumero` o `numeroDe`, de `fmt.js`, y no `Number()` ni `parseFloat()`.

El personal trabaja de pie con una tablet o un celular, así que las pantallas se diseñan para esos tamaños: se revisan a 390, 768 y 1024 px, con botones de al menos 40 px y sin scroll horizontal de la página (las tablas anchas van dentro de `.tabla-caja`).

### Un permiso

Los grupos están en `src/roles.js`. Para cambiar quién puede hacer algo se cambia el grupo, o la lista `roles` de la ruta si tiene una propia. La interfaz oculta lo que no corresponde, pero el control real está en el servidor.

### Un informe

El cálculo va como función pura en `src/domain/informes.js` (con su prueba en `test/informes.test.js`), la consulta en `src/modules/informes/informes.servicio.js`, la ruta en `informes.rutas.js` (solo administrador) y una pestaña en `web/src/pantallas/informes.jsx`.

## Auditoría

Toda ruta que modifica datos y tiene etiqueta queda registrada sola, sin que cada handler tenga que acordarse: quién, cuándo, desde qué IP, qué hizo, sobre qué registro y con qué resultado (correcto, sin permiso o fallido). Los accesos denegados (403) se registran como `sistema.acceso_denegado` y los errores 5xx como `sistema.error`.

Claves, tokens y hashes se borran antes de guardar (`limpiar`, en `domain/auditoria.js`); si se agrega un campo secreto con otro nombre, hay que sumarlo a esa lista. La tabla `auditoria` no tiene claves foráneas a propósito, para que el registro sobreviva aunque se borre a la persona o al registro afectado. Los códigos de acción no se renombran porque quedan guardados en la base; los textos sí se pueden cambiar. Se consulta en *Sistema → Auditoría* (con filtros y CSV) y no se puede borrar desde el sistema.

## Pruebas

```bash
npm test
```

Son 187 pruebas que corren en unos 10 segundos con SQLite en memoria, sin instalar ninguna base. Para correrlas contra PostgreSQL real (conviene hacerlo después de tocar consultas o el esquema) hacen falta PostgreSQL, el cliente `psql` y una base de pruebas, porque se borra su esquema `public`:

```bash
RADAS_PSQL="-h localhost -U postgres -d radas_test" npm test
```

El recorrido en navegador real (62 pasos) necesita Playwright: `npm i -D playwright`, `node test/servidor-prueba.js`, `npm run build` y `node test/e2e/navegador.mjs`.

Así se escribe una prueba de API (hay ejemplos en cualquier `test/*.test.js`):

```js
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, conSesion, esperar, iniciarBase } from './ayuda.js';

before(iniciarBase);
test('crea una cosa', async () => {
  const { token } = await conSesion('administrador');
  const r = esperar(await api('POST', '/cosas', { token, body: { nombre: 'Algo' } }), 201);
  assert.equal(r.nombre, 'Algo');
});
```

Los cálculos de plata, stock y fechas llevan prueba con valores donde un error de redondeo o de zona horaria se notaría. Los permisos se prueban con los roles que no deben poder. Y como SQLite acepta cosas que PostgreSQL rechaza, y al revés, después de cambiar consultas o esquema se corre la suite en los dos motores.

Algunas pruebas controlan reglas del proyecto: que toda ruta que modifica tenga etiqueta de auditoría, que la copia de seguridad cubra todas las tablas y que el QR se decodifique bien. Si fallan, hay que arreglar lo que señalan y no la prueba.

## Cosas a tener en cuenta

- `schema.sql` corre en cada arranque: cualquier sentencia nueva tiene que poder ejecutarse dos veces sin error.
- Dentro de una transacción se usa siempre `tx.query`; `db.query` abre otra conexión y no ve lo que hace la transacción.
- PostgreSQL devuelve `numeric` como texto. `db.js` lo convierte a número; si aparecen strings con decimales, falta pasar por ahí.
- Las columnas `date` se manejan como texto `AAAA-MM-DD` para evitar corrimientos de zona horaria. No conviene convertirlas con `new Date()` sin pensar en la zona.
- Las pruebas que dependen de la hora de los movimientos de stock usan la fecha real, porque `movimiento_stock.fecha_hora` toma el `now()` de la base.
- El QR lo genera el proyecto (`src/domain/qr.js`, hasta 213 bytes, corrección M): una dirección más larga no entra.
- La carta pública no tiene JavaScript ni enlaces al sistema del personal, a propósito. Una prueba lo exige.
- El límite de intentos de login depende de `TRUST_PROXY`: detrás de Caddy o de Render tiene que valer `1`, o todos los intentos parecen venir de la misma IP.
- No hay tiempo real: las pantallas consultan cada 5 a 15 segundos, lo que alcanza para unas 60 personas por noche. Si no alcanzara, habría que tocar `web/src/pantallas/kds.jsx` y `pedidos.jsx`.
- En Render gratuito el disco no persiste, así que las copias guardadas en el servidor se pierden en cada reinicio. Valen las de GitHub Actions (ver [`COPIAS.md`](COPIAS.md)).

## Pendiente

- Facturación electrónica con ARCA (ex AFIP): hay un diseño en [`FACTURACION.md`](FACTURACION.md) y ningún código. Es lo más grande que falta y necesita un CUIT con certificado propio.
- Pedidos hechos por el cliente desde el QR (hoy el QR solo muestra la carta).
- Cobro integrado con Mercado Pago o posnet, dividir una cuenta entre medios de pago y propinas como dato propio.
- Avisos por mail de stock bajo (hoy las alertas se ven en el Resumen).
- Reportes en PDF (hay CSV).

Sin probar: Safari/iOS, carga con muchos usuarios simultáneos, Docker y el despliegue en un servidor propio (ver [`DESPLIEGUE.md`](DESPLIEGUE.md)).

## Por qué está así

- PostgreSQL y no MySQL: el código usa `RETURNING`, tipos enumerados y restricciones `CHECK`, y migrar implicaría reescribir consultas.
- Sin framework de servidor ni de pruebas (`node:http` y `node:test`): menos dependencias y menos actualizaciones obligadas.
- Las copias son archivos JSON y no `pg_dump`, para poder restaurarlas desde la propia aplicación, verificarlas y probarlas en los dos motores.
- La auditoría se hace en el despachador y no en cada ruta, para que no se pueda olvidar; si alguien la omite, una prueba falla.
- El borrado definitivo solo se permite sin historial, para que los informes, la caja y la auditoría nunca apunten a algo que ya no existe.
- La carta pública se arma en el servidor y no con React, para que cargue rápido con datos móviles, funcione sin JavaScript y no exponga nada del sistema del personal.
