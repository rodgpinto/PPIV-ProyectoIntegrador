# Despliegue

RADAS está publicado en https://radas.onrender.com. Usamos servicios gratuitos que no piden tarjeta de crédito:

- **GitHub** guarda el código y, con GitHub Actions, hace una copia de la base cada noche.
- **Render** corre el servidor Node (API e interfaz).
- **Neon** aloja la base PostgreSQL.
- **UptimeRobot** consulta el sistema cada 5 minutos para que Render no lo suspenda.

```
git push ──▶ GitHub ──▶ Render (servidor Node) ──▶ Neon (PostgreSQL)
               │               ▲                        ▲
               │               │ /api/salud             │
               │          UptimeRobot                   │
               └── Actions (copia nocturna) ────────────┘
```

La base no está en Render porque su PostgreSQL gratuito vence a los 30 días. Neon no tiene vencimiento.

## Armado paso a paso

### 1. Repositorio en GitHub

Se crea un repositorio vacío y se sube el proyecto:

```bash
git init
git add .
git commit -m "RADAS"
git branch -M main
git remote add origin https://github.com/rodgpinto/PPIV-ProyectoIntegrador.git
git push -u origin main
```

El `.gitignore` deja afuera `node_modules`, `.env`, `.data`, `public` y `respaldos`, así que no se sube ninguna clave.

### 2. Base en Neon

En neon.com se crea un proyecto (PostgreSQL 16, región del este de EE. UU. para quedar cerca de Render). En el botón **Connect** se desactiva *Connection pooling* y se copia la dirección que empieza con `postgresql://` y termina en `?sslmode=require`. Esa dirección incluye la clave de la base.

No hay que crear tablas: la aplicación las crea sola al arrancar con `sql/schema.sql`.

### 3. Servicio en Render

En render.com: **New → Blueprint** y se elige el repositorio. Render lee `render.yaml` y pide tres valores:

| Variable | Qué va |
|---|---|
| `DATABASE_URL` | La dirección de Neon |
| `ADMIN_EMAIL` | Email del usuario administrador |
| `ADMIN_PASSWORD` | Clave del administrador (mínimo 8 caracteres) |

El resto de las variables (`NODE_ENV=production`, `TRUST_PROXY=1`, `DB_POOL_MAX=3`) ya vienen en el archivo. El primer despliegue tarda unos minutos. La versión de Node (22.22.0) la fija `.node-version`.

Si el Blueprint da problemas, el servicio se puede crear a mano con **New → Web Service**: *Build Command* `npm install --include=dev && npm run build`, *Start Command* `npm start`, *Health Check Path* `/api/salud`, plan *Free* y las mismas variables. Se instala con `--include=dev` porque la interfaz se compila con esbuild y React, que son dependencias de desarrollo.

### 4. Comprobar

Cuando Render muestra **Live**:

- `/api/salud` responde `{"ok":true}`
- `/` muestra el login
- `/carta` muestra la carta pública, sin login

Si el despliegue falla, la pestaña **Logs** de Render muestra el motivo; los mensajes de la aplicación están en castellano («Falta DATABASE_URL…», «No se pudo conectar a la base de datos…»).

### 5. Datos de ejemplo

`npm run seed` está bloqueado en producción porque crea usuarios con claves conocidas. Para tener datos de demostración en la base de Neon se hizo una copia en una computadora y se restauró en Neon:

1. En el sistema local: **Sistema → Copias de seguridad → Crear una copia ahora → Descargar**.
2. Desde la carpeta del proyecto, apuntando a Neon (en PowerShell: `$env:DATABASE_URL="..."`):
   ```bash
   export DATABASE_URL="postgresql://…?sslmode=require"
   export NODE_ENV=production
   node scripts/respaldo.js verificar copia/radas-20261020-031700.json.gz
   node scripts/respaldo.js restaurar copia/radas-20261020-031700.json.gz --si
   ```
3. En Render, **Manual Deploy → Restart**. Todos tienen que volver a iniciar sesión.

Los datos de ejemplo simulan cuatro semanas de funcionamiento con fechas relativas al día en que se cargan. Pasado un tiempo los lotes figuran vencidos y la última noche queda lejos; para renovarlos se corre `npm run seed:reiniciar` en la computadora y se repiten estos tres pasos con una copia nueva.

La restauración reemplaza todo lo que hay en la base, incluidos los usuarios. Después se entra con los usuarios de la copia (`admin@radas.test`, etc.). El procedimiento completo está en [`COPIAS.md`](COPIAS.md).

### 6. QR de la carta

En **Sistema → Carta con QR** se escribe la dirección de Render, se imprimen los cartelitos y se prueba uno con un celular con datos móviles. Si la dirección cambia, el QR hay que volver a imprimirlo.

### 7. Copias nocturnas

El archivo `.github/workflows/respaldo.yml` hace una copia de la base todas las noches a las 03:17 (hora de Buenos Aires) y la guarda 90 días como adjunto de la ejecución. Para activarlo hay que cargar la dirección de Neon como secreto del repositorio: **Settings → Secrets and variables → Actions → New repository secret**, con el nombre `DATABASE_URL`.

Para probarlo sin esperar a la noche: pestaña **Actions → Copia de seguridad de RADAS → Run workflow**. Al terminar, el adjunto aparece al final de la página de esa ejecución, en la sección **Artifacts**. Se descarga, se descomprime y se comprueba con `node scripts/respaldo.js verificar <archivo>`.

GitHub puede desactivar las ejecuciones programadas de un repositorio sin actividad durante meses; la pestaña Actions permite verlo y reactivarlas.

### 8. Que no se duerma

En UptimeRobot (plan gratuito) hay un monitor de tipo HTTP(s) sobre `https://radas.onrender.com/api/salud`, con intervalo de 5 minutos. Esa ruta no consulta la base, así que Neon sigue durmiendo cuando nadie usa el sistema. El plan gratuito de UptimeRobot es solo para uso personal y no comercial, lo que alcanza para este proyecto.

## Límites del plan gratuito

Datos consultados el 21/10/2026; conviene revisarlos antes de depender de ellos.

- Render suspende el servicio tras 15 minutos sin visitas y tarda cerca de un minuto en volver. Con el monitor de UptimeRobot casi no ocurre.
- Render da 750 horas por mes: alcanza para una sola aplicación encendida todo el mes.
- El disco de Render se borra en cada reinicio o despliegue. Las copias que el sistema guarda en su propio disco no sirven como respaldo; por eso existen las de GitHub Actions.
- Render gratuito no tiene consola, por eso las restauraciones se hacen desde una computadora.
- Neon gratuito ofrece 1 GB y 100 horas de cómputo por mes, y se duerme tras 5 minutos sin consultas (la primera consulta tarda 1 a 3 segundos más). Solo guarda 6 horas de historia, así que no reemplaza a las copias.
- Render aclara que las instancias gratuitas no son para producción. Para un bar que opera todas las noches hace falta otra opción (ver abajo).

## Actualizar el sistema

Cada `git push` a `main` hace que Render compile y despliegue de nuevo. Si el despliegue falla, Render deja funcionando la versión anterior. Antes de subir un cambio grande conviene correr la copia a mano desde Actions.

## Si el bar lo usara de verdad: servidor propio

Para operar todas las noches, el servidor tiene que estar siempre encendido y no ser la computadora de nadie. Lo razonable es una máquina virtual gratuita (por ejemplo Oracle Cloud «Always Free») o un mini PC o Raspberry Pi en el local. El proyecto incluye lo necesario para las dos:

- `Dockerfile` y `docker-compose.prod.yml`: la aplicación, PostgreSQL y Caddy (HTTPS automático) en un solo comando.
- `deploy/radas.service` y `deploy/Caddyfile`: para correrlo sin Docker, con systemd.

Con Docker, en el servidor:

```bash
git clone https://github.com/rodgpinto/PPIV-ProyectoIntegrador.git /opt/radas && cd /opt/radas
cp .env.example .env        # completar DB_PASSWORD, DOMINIO, ADMIN_NOMBRE, ADMIN_EMAIL y ADMIN_PASSWORD
mkdir respaldos && sudo chown 1000:1000 respaldos
docker compose -f docker-compose.prod.yml up -d --build
```

El dominio tiene que apuntar a la IP del servidor antes de arrancar, porque Caddy lo necesita para pedir el certificado. Para actualizar: copia de seguridad, `git pull` y `docker compose -f docker-compose.prod.yml up -d --build`.

Sin Docker hacen falta Node 22 y PostgreSQL 16; después se crea la base, se completa el `.env`, se corre `npm install --include=dev && npm run build` y se instala `deploy/radas.service` con systemd.

Si el equipo está en el local, funciona aunque se caiga internet, pero el QR de la carta solo abre desde el WiFi del bar, salvo que se publique el servicio con un túnel o con puertos abiertos. En cualquier caso las copias tienen que salir del servidor (ver [`COPIAS.md`](COPIAS.md)).

Estos archivos de servidor propio no se pudieron probar en el entorno de desarrollo (no tenía Docker ni acceso a servidores). Conviene hacer un ensayo completo antes de usarlos: un pedido de punta a punta desde un celular y una tablet, un reinicio de la máquina, una restauración de copia y el escaneo del QR con datos móviles.

## Fuentes

- Render, límites del plan gratuito: https://render.com/docs/free
- Render, versión de Node: https://render.com/docs/node-version
- Render, Blueprints: https://render.com/docs/blueprint-spec
- Neon, planes y límites: https://neon.com/pricing
- UptimeRobot, plan gratuito: https://uptimerobot.com/pricing
