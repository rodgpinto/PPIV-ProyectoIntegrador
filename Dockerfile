# OPCIONAL: no hace falta Docker para usar el proyecto (ver docs/DESPLIEGUE.md).
# Esta receta NO se pudo probar en el entorno donde se armó el proyecto (ahí no había Docker): es un punto de partida.
FROM node:22-alpine AS compilar
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY sql ./sql
COPY scripts ./scripts
COPY --from=compilar /app/public ./public
# Las copias de seguridad se guardan en /datos/respaldos, que es un volumen: sobreviven a reconstruir el contenedor
ENV RESPALDO_DIR=/datos/respaldos
RUN mkdir -p /datos/respaldos && chown -R node:node /datos
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/salud >/dev/null || exit 1
CMD ["node", "--max-old-space-size=192", "src/server.js"]
