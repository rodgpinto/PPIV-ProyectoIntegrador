export const ROLES = Object.freeze({
  ADMIN: 'administrador', // administrador / dueño
  CAJERO: 'cajero',
  BARRA: 'barra',
  CAMARERO: 'camarero',
  HOST: 'host',
  COCINA: 'cocina',
});

export const TODOS = Object.values(ROLES);
export const SOLO_ADMIN = [ROLES.ADMIN];
// Quién ve las mesas; los que cambian su estado están en SALON_EDITA
export const SALON = [ROLES.ADMIN, ROLES.HOST, ROLES.CAMARERO, ROLES.CAJERO, ROLES.BARRA, ROLES.COCINA];
export const SALON_EDITA = [ROLES.ADMIN, ROLES.HOST, ROLES.CAMARERO, ROLES.CAJERO];
// Quién puede registrar mermas (lo que se pierde, se cae o se consume)
export const MERMAS = [ROLES.ADMIN, ROLES.CAMARERO, ROLES.BARRA, ROLES.COCINA];

// Pedidos: quién toma pedidos, entrega y cobra. Pantalla de cocina/barra (KDS): quién la usa.
export const PEDIDOS = [ROLES.ADMIN, ROLES.CAMARERO, ROLES.CAJERO, ROLES.BARRA];
export const KDS = [ROLES.ADMIN, ROLES.BARRA, ROLES.COCINA];

// Caja: quién ve la jornada y la cierra (reabrirla y ver reportes con márgenes es solo del administrador).
export const CAJA = [ROLES.ADMIN, ROLES.CAJERO];
