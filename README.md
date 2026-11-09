# RADAS · Sistema de gestión para un rooftop bar

Aplicación web completa para operar un bar: **pedidos por mesa y barra, pantalla de cocina, cobro, caja, stock con vencimientos, recetas y costos, personal, informes para el dueño, auditoría, copias de seguridad y carta con QR para los clientes**.

Proyecto integrador del **IFTS N.º 29** · Equipo **Dynamis** · Práctica Profesionalizante IV: Proyecto Integrador.

| | |
|---|---|
| **Aplicación publicada** | https://radas.onrender.com |
| **Carta pública (la del QR)** | https://radas.onrender.com/carta |
| **Documentación completa (PDF)** | [`docs/RADAS-Documentacion-Etapa3.pdf`](docs/RADAS-Documentacion-Etapa3.pdf): Manual Técnico, Manual de Usuario, base de datos y CRUD, pruebas unitarias y de integración |
| **Usuario de evaluación** | `admin@radas.test` · clave `radas1234` |

> **Disponibilidad.** La aplicación publicada corre en el plan gratuito de Render, que suspende el servicio tras 15 minutos sin visitas. Para mantenerlo disponible, el equipo usa el plan gratuito de **UptimeRobot**, que consulta `/api/salud` cada 5 minutos. Si de todos modos el servicio estuviera dormido, la primera carga tarda cerca de un minuto y alcanza con esperar y recargar la página.

## Tecnologías

- **Node.js 22.5 o más nuevo**: un solo servicio con la API y la interfaz. Servidor HTTP nativo (sin Express); la única dependencia de ejecución es `pg`.
- **PostgreSQL** (en producción: Neon). En desarrollo, sin instalar nada, se usa **PGlite**: PostgreSQL real compilado a WebAssembly que corre dentro de Node.
- **React 19** compilado con **esbuild**. Interfaz pensada para tablets y celulares.
- Todo gratuito: sin servicios pagos ni claves de terceros.

## Ejecutarlo en tu computadora

Requisito: Node.js 22.5 o más nuevo (`node -v`). No hace falta instalar ninguna base de datos.

```bash
npm install
npm run seed      # carga datos de ejemplo (cuatro semanas de funcionamiento)
npm run dev       # compila la interfaz y arranca en http://localhost:3000
```

Los comandos son los mismos en Windows PowerShell, macOS y Linux. Para empezar de cero se detiene el servidor y se corre `npm run seed:reiniciar`, que borra la base local y la carga de nuevo con fechas de hoy (`npm run seed -- --basico` carga el conjunto reducido). El puerto se cambia con la variable `PORT` (`PORT=3100 npm run dev`; en PowerShell: `$env:PORT=3100; npm run dev`).

**Usuarios de ejemplo** (clave de todos: `radas1234`):

| Email | Rol |
|---|---|
| `admin@radas.test` | Administrador (dueño) |
| `cajero@radas.test` | Cajero |
| `barra@radas.test` | Barra |
| `camarero@radas.test` | Camarero |
| `host@radas.test` | Host |
| `cocina@radas.test` | Cocina |

El escenario completo agrega cuatro usuarios más: `barra2@`, `camarero2@`, `camarero3@` y `cocina2@radas.test`.

**Recorrido sugerido (2 minutos):** con `camarero@radas.test` se toma un pedido en una mesa. En otra ventana, `barra@radas.test` o `cocina@radas.test` lo ven en su pantalla y lo marcan como preparando y listo. El camarero lo entrega y `cajero@radas.test` lo cobra. Con `admin@radas.test` se puede ver después el stock descontado, la caja y las ventas.

### Con tu propio PostgreSQL y los scripts SQL

```bash
createdb radas
psql -d radas -f sql/schema.sql            # crea las 15 tablas (se puede repetir sin romper nada)
psql -d radas -f sql/datos-ejemplo.sql     # datos de ejemplo (opcional)
npm install
npm run build
export DATABASE_URL="postgres://usuario:clave@localhost:5432/radas"   # PowerShell: $env:DATABASE_URL="..."
npm start
```

En este camino no debe definirse `NODE_ENV=production`: en modo producción la aplicación exige `ADMIN_EMAIL` y `ADMIN_PASSWORD` y no permite cargar datos de ejemplo.

### Pruebas

```bash
npm test          # 187 pruebas automáticas (43 unitarias y 144 de integración); no requieren ninguna base instalada
```

Las mismas pruebas pasan contra **PostgreSQL 16 real** (`RADAS_PSQL="-h localhost -U postgres -d radas_test" npm test`; esa ejecución borra el esquema `public` de la base indicada, por lo que debe usarse una base descartable). Hay además un recorrido de 62 pasos en un navegador real con Playwright (`test/e2e/navegador.mjs`). El detalle, con el resultado de cada prueba, está en los capítulos 16 y 17 del PDF.

## Qué hace el sistema

- **Usuarios y roles**: administrador, cajero, barra, camarero, host y cocina. Los permisos se aplican en el servidor, no solo ocultando botones. Una baja o un cambio de clave cierra las sesiones abiertas de esa persona.
- **Carta, precios y márgenes**: costo de cada plato calculado con su receta y el último precio de compra. Precios editables uno a uno, por porcentaje o por margen deseado, con vista previa antes de confirmar.
- **Insumos, proveedores y stock**: cada ingreso es un lote con vencimiento y costo; el stock sale por FEFO (primero lo que vence antes). Alertas de reposición, sobrestock, por vencer y vencidos. Presentaciones (botellas, cajas), mermas y conteo físico.
- **Pedidos y cobro**: una cuenta por mesa o por cliente en la barra, con notas por línea («sin hielo»). Cada línea va a la pantalla de su destino y descuenta del stock lo que lleva la receta. Se cobra con efectivo, tarjeta, Mercado Pago o transferencia, y se imprime un ticket **no fiscal**.
- **Pantalla de cocina y barra (KDS)**: cola en tres columnas (en espera, preparando, listo), con alertas por demora y aviso sonoro opcional.
- **Pasar cuentas entre mesas**: toda la cuenta, o solo algunos productos para dividirla.
- **Caja**: cierre por noche comercial (de 06:00 a 06:00), con fondo, retiros, efectivo contado y diferencia. Se puede cerrar el salón y la barra por separado.
- **Personal**: fichaje de ingreso y egreso, horas por empleado y por turno, corrección de fichajes olvidados, planilla CSV.
- **Mesas**: el host ve cuántos de los 32 lugares están libres; la pantalla se actualiza sola.
- **Informes del dueño**: rentabilidad e ingeniería de menú, comparación de períodos, consumo real contra teórico, valor del stock y mermas, y lista de compras sugerida.
- **Auditoría**: registra quién hizo qué, cuándo y con qué resultado (con el valor anterior y el nuevo en los cambios). Nunca guarda claves.
- **Copias de seguridad**: automáticas cada 12 horas, descargables y restaurables en una sola transacción.
- **Carta para clientes con QR**: página aparte, sin login, que carga rápido en cualquier celular. El QR lo genera el propio proyecto.

### Permisos por rol

| | Admin | Cajero | Barra | Camarero | Host | Cocina |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver la carta, fichar y ver sus horas, ver mesas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Marcar mesas libres u ocupadas | ✅ | ✅ | — | ✅ | ✅ | — |
| Tomar pedidos, entregar, cobrar y pasar cuentas | ✅ | ✅ | ✅ | ✅ | — | — |
| Pantalla de cocina / barra | ✅ ambas | — | ✅ barra | — | — | ✅ cocina |
| Ver la caja y cerrarla | ✅ | ✅ | — | — | — | — |
| Registrar mermas | ✅ | — | ✅ | ✅ | — | ✅ |
| Anular un pedido ya iniciado, reabrir una caja | ✅ | — | — | — | — | — |
| Productos, precios, insumos, proveedores, stock | ✅ | — | — | — | — | — |
| Ventas, informes, horas del personal, usuarios | ✅ | — | — | — | — | — |
| Auditoría, copias de seguridad, QR de la carta | ✅ | — | — | — | — | — |

Los costos y márgenes nunca viajan a quien no es administrador.

## Base de datos y CRUD

15 tablas en PostgreSQL, definidas en [`sql/schema.sql`](sql/schema.sql) (se crea sola al arrancar la aplicación). El diagrama entidad-relación y el diccionario de campos están en el capítulo 6 del PDF.

Las cuatro operaciones se hacen desde la interfaz, con validaciones y mensajes claros:

| Operación | Cómo funciona |
|---|---|
| **Crear** | Formularios con campos obligatorios validados en pantalla y en el servidor. Los nombres no se repiten (restricción `UNIQUE`: respuesta 409 con mensaje). |
| **Leer** | Listados con filtros y búsqueda, y detalle de cada registro. |
| **Actualizar** | Edición con los mismos controles que el alta. Los cambios de precio y de rol guardan el valor anterior en la auditoría. |
| **Eliminar** | Siempre pide confirmación. Un registro **sin historial** se elimina de verdad (productos, insumos, proveedores y mesas). Uno **con historial** (ventas, stock, compras) no se puede borrar y se da de baja, para que los informes y la caja nunca apunten a algo inexistente; el mensaje explica el motivo. Los usuarios solo se dan de baja. |

## Estructura del proyecto

```
src/            Servidor
  http/           Servidor HTTP nativo, despachador de rutas, validación y manejo de errores
  modules/        Un módulo por área: auth, catálogo, stock, pedidos, ventas, caja, fichajes, mesas, informes, auditoría, respaldo
  domain/         Reglas de negocio puras (FEFO, costos, márgenes, caja, informes, QR), sin base de datos
web/            Interfaz React (web/src/pantallas: una pantalla por archivo)
sql/            schema.sql (esquema) y datos-ejemplo.sql (datos de demostración)
scripts/        Compilar la interfaz, cargar datos de ejemplo, copias de seguridad por terminal
test/           Pruebas unitarias, de integración y de navegador
docs/           Guías y el PDF de documentación
deploy/         Configuración para un servidor propio (systemd, Caddy)
```

## Documentación adicional

| Documento | Contenido |
|---|---|
| [`docs/RADAS-Documentacion-Etapa3.pdf`](docs/RADAS-Documentacion-Etapa3.pdf) | Manual Técnico, Manual de Usuario, CRUD, pruebas e instalación paso a paso |
| [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) | Cómo está publicado (Render, Neon, GitHub Actions, UptimeRobot) y qué hacer para un servidor propio |
| [`docs/COPIAS.md`](docs/COPIAS.md) | Copias de seguridad y cómo restaurar |
| [`docs/MANTENIMIENTO.md`](docs/MANTENIMIENTO.md) | Guía para desarrolladores: estructura del código, cómo agregar rutas, tablas y pantallas |
| [`docs/FACTURACION.md`](docs/FACTURACION.md) | Diseño de la facturación electrónica (no está implementada) |

## Despliegue

La versión publicada usa **Render** (aplicación) + **Neon** (PostgreSQL). Cada `git push` a la rama `main` redespliega solo. UptimeRobot (plan gratuito) consulta `/api/salud` cada 5 minutos para que el servicio no se duerma, y una acción de GitHub (`.github/workflows/respaldo.yml`) hace una copia de la base cada noche. El paso a paso, con los límites del plan gratuito, está en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

Variables de entorno de producción:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Dirección de PostgreSQL (`postgresql://…?sslmode=require`) |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` · `ADMIN_NOMBRE` | Primer administrador; se crea solo si todavía no hay ninguno |
| `TRUST_PROXY` | `1` si hay un proxy delante (Render, Caddy) |

Compilar requiere las dependencias de desarrollo (`npm install --include=dev && npm run build`) y se inicia con `npm start`. En producción `npm run seed` está bloqueado a propósito.

## API

Todas las rutas están bajo `/api`; la autenticación es `Authorization: Bearer <token>` (se obtiene en `POST /api/auth/login`; 5 intentos fallidos bloquean 15 minutos). Los errores tienen la forma `{ "error": "mensaje", "detalles": [{ "campo", "mensaje" }] }`. Hay 74 rutas; `GET /api/salud` responde `{"ok":true}` sin consultar la base.

| Área | Rutas | Quién |
|---|---|---|
| Sesión | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/cambiar-contrasena` | Público / todos |
| Usuarios | `GET/POST /usuarios` · `PATCH /usuarios/:id` | Admin |
| Carta | `GET /carta` | Público |
| Productos | `GET /productos` · `GET/PATCH/DELETE /productos/:id` · `POST /productos` · `DELETE /productos/:id/definitivo` · `PUT /productos/:id/receta` | Lectura: todos; resto: admin |
| Precios | `PATCH /productos/:id/precio` · `PUT /productos/precios` · `POST /productos/ajuste-precios` | Admin |
| Insumos | `GET/POST /insumos` · `PATCH/DELETE /insumos/:id` · `DELETE /insumos/:id/definitivo` · `PUT /insumos/:id/presentaciones` · `GET /insumos/:id/compras` | Admin (el personal que registra mermas ve una lista reducida) |
| Proveedores | `GET/POST /proveedores` · `PATCH /proveedores/:id` · `DELETE /proveedores/:id/definitivo` | Admin |
| Stock | `POST /stock/ingresos` · `POST /stock/ajustes` · `GET /stock/alertas` · `/stock/lotes` · `/stock/movimientos` | Admin |
| Mermas | `POST /stock/mermas` | Admin, camarero, barra, cocina |
| Fichajes | `POST /fichajes/ingreso` · `POST /fichajes/egreso` · `GET /fichajes/mio` | Todos |
| Fichajes (gestión) | `GET /fichajes` · `/fichajes/presentes` · `/fichajes/resumen` · `POST /fichajes` · `PATCH /fichajes/:id` · `POST /fichajes/:id/cerrar` | Admin |
| Mesas | `GET /mesas` · `PATCH /mesas/:id/estado` · `POST /mesas` · `PATCH /mesas/:id` · `DELETE /mesas/:id/definitivo` | Lectura: todos; estado: admin, host, camarero, cajero; resto: admin |
| Pedidos | `GET/POST /pedidos` · `GET /pedidos/:id` · `POST /pedidos/:id/items` · `/cerrar` · `/cancelar` · `/mover` · `/mover-items` · `DELETE /pedido-items/:id` | Admin, cajero, barra, camarero |
| Cocina y barra | `PATCH /pedido-items/estado` · `GET /kds` | Según el paso y el destino de cada línea |
| Caja | `GET /caja/jornada` · `GET/POST /caja/cierres` · `DELETE /caja/cierres/:id` | Admin y cajero (reabrir: solo admin) |
| Ventas | `GET /reportes/ventas` | Admin |
| Informes | `GET /informes/rentabilidad` · `/comparar` · `/consumo` · `/stock` · `/compras` | Admin |
| Auditoría | `GET /auditoria` | Admin |
| Copias | `GET/POST /respaldos` · `GET /respaldos/:nombre` | Admin |

## Decisiones técnicas

- **PostgreSQL y no MySQL**: el código usa `RETURNING`, tipos enumerados y restricciones `CHECK`.
- **Bajo consumo de recursos**: pool de 5 conexiones, respuestas con gzip y `ETag`, archivos estáticos cacheados un año, sin WebSockets (las pantallas consultan cada 5 a 10 segundos).
- **Seguridad**: contraseñas con scrypt; sesiones con token aleatorio guardado como hash y revocables; cabeceras de seguridad con CSP estricta; límite de tamaño del cuerpo de los pedidos; validación de todas las entradas en el servidor.
- **Fechas** en hora de Buenos Aires, sin depender de la zona del servidor. La noche comercial va de las 06:00 a las 06:00, así lo cobrado a la 01:30 pertenece a la noche anterior.
- **Stock negativo permitido**: si se vende algo antes de cargar la compra, el sistema avisa qué falta y el próximo ingreso lo compensa.
- **Auditoría obligatoria**: una prueba falla si una ruta nueva que modifica datos no tiene su etiqueta de auditoría.

## Alcance y límites

**Incluido:** todo lo descripto arriba, funcionando de punta a punta y probado.

**No incluido:**
- Facturación electrónica (ARCA): solo existe el diseño documentado; el bar del proyecto es ficticio y el ticket dice «comprobante no válido como factura».
- Pedidos hechos por el cliente desde el QR: hoy el QR solo muestra la carta.
- Integración con Mercado Pago o POS: el sistema registra el medio de pago, el cobro se hace por fuera.
- Dividir una cuenta entre varios medios de pago y propinas como dato propio.
- Reportes en PDF (se exportan en CSV).

**Verificación:**
- Las 187 pruebas pasan con SQLite en memoria y contra PostgreSQL 16 real.
- El recorrido de navegador (62 pasos) pasó con Chromium contra PostgreSQL 16, sin scroll horizontal a 768, 1024 y 390 px de ancho.
- `npm install`, `npm run seed` y el despliegue en Render + Neon se hicieron y funcionan.
- **Sin verificar:** Docker (los archivos están como punto de partida), la carga con muchos usuarios simultáneos y la interfaz en Safari/iOS.

## Equipo

**Dynamis** · IFTS N.º 29

Ximena Facal · Franco Guarachi · Rodrigo Pinto · Mara Skaarup

Docentes: Emir García · Kevin del Bello
