// .env es opcional: las variables también pueden venir del entorno (process.loadEnvFile: Node 20.12+).
try {
  process.loadEnvFile();
} catch {
  /* sin archivo .env */
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  produccion: env.NODE_ENV === 'production',
  databaseUrl: env.DATABASE_URL || null, // sin esto, en desarrollo se usa PGlite
  dbPoolMax: Number(env.DB_POOL_MAX ?? 5),
  pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
  zonaHoraria: env.ZONA_HORARIA ?? 'America/Argentina/Buenos_Aires',
  jornadaInicioHora: Number(env.JORNADA_INICIO_HORA ?? 6), // la noche comercial va de esta hora a la misma del día siguiente
  sesionHoras: Number(env.SESION_HORAS ?? 14), // cubre un turno completo (19:00 a 02:30)
  // Copias de seguridad (ver docs/COPIAS.md)
  respaldo: {
    dir: env.RESPALDO_DIR ?? '.data/respaldos',
    cadaHoras: Number(env.RESPALDO_CADA_HORAS ?? 12), // 0 = sin copias automáticas
    conservar: Number(env.RESPALDO_CONSERVAR ?? 40), // cantidad de archivos que se guardan; los más viejos se borran
    comandoExterno: env.RESPALDO_COMANDO_EXTERNO || null, // se ejecuta después de cada copia: sirve para subirla a otro lado
  },
  trustProxy: Number(env.TRUST_PROXY ?? 0),
  admin: {
    nombre: env.ADMIN_NOMBRE ?? 'Administrador',
    email: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    password: env.ADMIN_PASSWORD || null,
  },
};
