-- RADAS · esquema de PostgreSQL. Es idempotente: se ejecuta en cada arranque sin romper nada.
-- Se mantiene en el subconjunto de SQL común a PostgreSQL y SQLite para poder probarlo rápido.

DO $$ BEGIN CREATE TYPE rol_usuario AS ENUM ('administrador', 'cajero', 'barra', 'camarero', 'host', 'cocina');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE destino_producto AS ENUM ('barra', 'cocina');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE zona_mesa AS ENUM ('interior', 'exterior');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_mesa AS ENUM ('libre', 'ocupada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE turno_trabajo AS ENUM ('produccion', 'servicio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tipo_movimiento AS ENUM ('ingreso', 'venta', 'merma', 'ajuste', 'reversion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE motivo_merma AS ENUM ('vencido', 'devolucion', 'se_cayo', 'consumo_interno');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- acceso ----------

CREATE TABLE IF NOT EXISTS usuario (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,      -- siempre en minúsculas
  contrasena  VARCHAR(200) NOT NULL,             -- hash scrypt, nunca la clave
  rol         rol_usuario  NOT NULL,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Sesiones: el navegador guarda un token aleatorio; acá solo queda su hash. Se pueden revocar.
CREATE TABLE IF NOT EXISTS sesion (
  token_hash  VARCHAR(64) PRIMARY KEY,
  id_usuario  INT         NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sesion_usuario ON sesion (id_usuario);

-- ---------- catálogo ----------

CREATE TABLE IF NOT EXISTS proveedor (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(100) NOT NULL UNIQUE,
  contacto  VARCHAR(100) NOT NULL DEFAULT '',
  telefono  VARCHAR(40)  NOT NULL DEFAULT '',
  notas     VARCHAR(300) NOT NULL DEFAULT '',
  activo    BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS producto (
  id           SERIAL PRIMARY KEY,
  nombre       VARCHAR(100)     NOT NULL UNIQUE,
  descripcion  TEXT             NOT NULL DEFAULT '',
  categoria    VARCHAR(50)      NOT NULL,
  precio       NUMERIC(10, 2)   NOT NULL CHECK (precio >= 0),
  destino      destino_producto NOT NULL,
  activo       BOOLEAN          NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS insumo (
  id                     SERIAL PRIMARY KEY,
  nombre                 VARCHAR(100)   NOT NULL UNIQUE,
  unidad                 VARCHAR(10)    NOT NULL CHECK (unidad IN ('ml', 'g', 'unidad')),
  costo_unitario         NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),  -- por ml, g o unidad; 0 = sin cargar
  stock_actual           NUMERIC(14, 3) NOT NULL DEFAULT 0,   -- puede quedar negativo (S-16): ventas sin ingreso registrado
  stock_minimo           NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  stock_maximo           NUMERIC(14, 3),
  dias_aviso_vencimiento INT            NOT NULL DEFAULT 7 CHECK (dias_aviso_vencimiento >= 0),
  id_proveedor           INT REFERENCES proveedor (id),       -- proveedor habitual (el de la última compra)
  activo                 BOOLEAN        NOT NULL DEFAULT TRUE,
  CHECK (stock_maximo IS NULL OR stock_maximo >= stock_minimo)
);

CREATE TABLE IF NOT EXISTS detalle_receta (
  id           SERIAL PRIMARY KEY,
  id_producto  INT            NOT NULL REFERENCES producto (id),
  id_insumo    INT            NOT NULL REFERENCES insumo (id),
  cantidad     NUMERIC(14, 3) NOT NULL CHECK (cantidad > 0),   -- por porción, en la unidad del insumo
  UNIQUE (id_producto, id_insumo)
);

-- ---------- stock ----------

-- Cada ingreso de mercadería es un lote con su fecha de ingreso, vencimiento y costo.
CREATE TABLE IF NOT EXISTS lote_insumo (
  id                 SERIAL PRIMARY KEY,
  id_insumo          INT            NOT NULL REFERENCES insumo (id),
  id_proveedor       INT REFERENCES proveedor (id),
  origen             VARCHAR(10)    NOT NULL DEFAULT 'compra' CHECK (origen IN ('compra', 'ajuste')),
  cantidad_inicial   NUMERIC(14, 3) NOT NULL CHECK (cantidad_inicial > 0),
  cantidad_actual    NUMERIC(14, 3) NOT NULL CHECK (cantidad_actual >= 0),
  costo_unitario     NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  fecha_ingreso      DATE           NOT NULL,
  fecha_vencimiento  DATE,
  id_usuario         INT REFERENCES usuario (id),
  creado_en          TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lote_insumo_insumo ON lote_insumo (id_insumo);

-- El stock solo cambia mediante movimientos: cantidad positiva entra, negativa sale.
CREATE TABLE IF NOT EXISTS movimiento_stock (
  id              SERIAL PRIMARY KEY,
  fecha_hora      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  tipo            tipo_movimiento NOT NULL,
  id_insumo       INT             NOT NULL REFERENCES insumo (id),
  id_lote         INT REFERENCES lote_insumo (id),
  cantidad        NUMERIC(14, 3)  NOT NULL,
  costo_unitario  NUMERIC(14, 4),
  motivo          motivo_merma,
  referencia      VARCHAR(60),
  nota            VARCHAR(300),
  id_usuario      INT REFERENCES usuario (id)
);
CREATE INDEX IF NOT EXISTS movimiento_insumo ON movimiento_stock (id_insumo, fecha_hora DESC);

-- ---------- salón ----------

CREATE TABLE IF NOT EXISTS mesa (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(30) NOT NULL UNIQUE,
  zona          zona_mesa   NOT NULL,
  capacidad     INT         NOT NULL CHECK (capacidad > 0),
  estado        estado_mesa NOT NULL DEFAULT 'libre',
  estado_desde  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activo        BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ---------- personal ----------

CREATE TABLE IF NOT EXISTS fichaje (
  id           SERIAL PRIMARY KEY,
  id_usuario   INT           NOT NULL REFERENCES usuario (id),
  turno        turno_trabajo NOT NULL,
  ingreso      TIMESTAMPTZ   NOT NULL,
  egreso       TIMESTAMPTZ,                          -- NULL = jornada abierta
  nota         VARCHAR(300)  NOT NULL DEFAULT '',
  manual       BOOLEAN       NOT NULL DEFAULT FALSE, -- cargado o corregido por un administrador
  editado_por  INT REFERENCES usuario (id),
  creado_en    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (egreso IS NULL OR egreso >= ingreso)
);
-- Una sola jornada abierta por persona
CREATE UNIQUE INDEX IF NOT EXISTS fichaje_abierto_unico ON fichaje (id_usuario) WHERE egreso IS NULL;
CREATE INDEX IF NOT EXISTS fichaje_ingreso ON fichaje (ingreso);

-- ---------- pedidos, cobro y pantalla de cocina ----------

DO $$ BEGIN CREATE TYPE canal_venta AS ENUM ('mesa', 'barra');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_pedido AS ENUM ('abierto', 'cerrado', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE estado_item AS ENUM ('pendiente', 'preparando', 'listo', 'entregado', 'anulado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE medio_pago AS ENUM ('efectivo', 'tarjeta', 'mercado_pago', 'transferencia');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Una cuenta: de una mesa, o de la barra (canal propio, con su propio cierre de caja).
CREATE TABLE IF NOT EXISTS pedido (
  id           SERIAL PRIMARY KEY,
  canal        canal_venta   NOT NULL,
  id_mesa      INT REFERENCES mesa (id),
  etiqueta     VARCHAR(40)   NOT NULL DEFAULT '',          -- en la barra: a nombre de quién / en qué lugar
  estado       estado_pedido NOT NULL DEFAULT 'abierto',
  id_usuario   INT           NOT NULL REFERENCES usuario (id),
  creado_en    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  cerrado_en   TIMESTAMPTZ,
  total        NUMERIC(14, 2),                             -- se fija al cobrar
  medio_pago   medio_pago,
  id_cobrador  INT REFERENCES usuario (id),
  CHECK ((canal = 'mesa' AND id_mesa IS NOT NULL) OR (canal = 'barra' AND id_mesa IS NULL))
);
-- Una sola cuenta abierta por mesa
CREATE UNIQUE INDEX IF NOT EXISTS pedido_mesa_abierto ON pedido (id_mesa) WHERE estado = 'abierto' AND id_mesa IS NOT NULL;
CREATE INDEX IF NOT EXISTS pedido_estado ON pedido (estado, creado_en);

-- Cada línea guarda una "foto" del nombre, precio y costo del momento: cambiar la carta después no altera lo ya vendido.
CREATE TABLE IF NOT EXISTS item_pedido (
  id               SERIAL PRIMARY KEY,
  id_pedido        INT              NOT NULL REFERENCES pedido (id),
  id_producto      INT              NOT NULL REFERENCES producto (id),
  nombre           VARCHAR(100)     NOT NULL,
  destino          destino_producto NOT NULL,
  cantidad         INT              NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(14, 2)   NOT NULL,
  costo_unitario   NUMERIC(14, 2),                         -- costo de la receta al pedir (NULL si no tiene receta)
  nota             VARCHAR(200)     NOT NULL DEFAULT '',
  estado           estado_item      NOT NULL DEFAULT 'pendiente',
  creado_en        TIMESTAMPTZ      NOT NULL DEFAULT now(),
  preparando_en    TIMESTAMPTZ,
  listo_en         TIMESTAMPTZ,
  entregado_en     TIMESTAMPTZ,
  id_usuario       INT REFERENCES usuario (id)
);
CREATE INDEX IF NOT EXISTS item_pedido_pedido ON item_pedido (id_pedido);
CREATE INDEX IF NOT EXISTS item_pedido_cola ON item_pedido (destino, estado);
CREATE INDEX IF NOT EXISTS movimiento_referencia ON movimiento_stock (referencia);

-- Cierre de caja: una foto de la jornada comercial (de las 06:00 de un día a las 06:00 del siguiente, para que
-- lo vendido de madrugada cuente en la noche que corresponde). Una por jornada y por caja (salón, barra o todo junto);
-- el administrador puede reabrirla.
CREATE TABLE IF NOT EXISTS cierre_caja (
  id                   SERIAL PRIMARY KEY,
  fecha_jornada        DATE           NOT NULL,
  canal                VARCHAR(10)    NOT NULL DEFAULT 'todos' CHECK (canal IN ('todos', 'mesa', 'barra')),  -- qué caja se cerró: el salón, la barra o todo junto
  cerrado_en           TIMESTAMPTZ    NOT NULL DEFAULT now(),
  id_usuario           INT            NOT NULL REFERENCES usuario (id),
  cuentas              INT            NOT NULL,
  ventas_total         NUMERIC(14, 2) NOT NULL,
  ventas_efectivo      NUMERIC(14, 2) NOT NULL,
  ventas_tarjeta       NUMERIC(14, 2) NOT NULL,
  ventas_mercado_pago  NUMERIC(14, 2) NOT NULL,
  ventas_transferencia NUMERIC(14, 2) NOT NULL,
  fondo_inicial        NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- efectivo con el que se abrió la caja (para dar vuelto)
  retiros              NUMERIC(14, 2) NOT NULL DEFAULT 0,   -- efectivo que salió de la caja (pagos a proveedores, propinas, etc.)
  efectivo_esperado    NUMERIC(14, 2) NOT NULL,             -- fondo + ventas en efectivo - retiros
  efectivo_contado     NUMERIC(14, 2) NOT NULL,
  diferencia           NUMERIC(14, 2) NOT NULL,             -- contado - esperado (negativo = falta plata)
  nota                 VARCHAR(300)   NOT NULL DEFAULT '',
  CONSTRAINT cierre_caja_jornada_canal UNIQUE (fecha_jornada, canal)
);
-- Bases creadas antes de existir `canal`: se agrega la columna y se cambia la unicidad (una por jornada y por caja)
DO $$ BEGIN
  ALTER TABLE cierre_caja ADD COLUMN IF NOT EXISTS canal VARCHAR(10) NOT NULL DEFAULT 'todos';
  ALTER TABLE cierre_caja DROP CONSTRAINT IF EXISTS cierre_caja_fecha_jornada_key;
  CREATE UNIQUE INDEX IF NOT EXISTS cierre_caja_jornada_canal ON cierre_caja (fecha_jornada, canal);
END $$;

-- Presentaciones (envases) de un insumo: "Botella 750 ml", "Caja x 24", "Bidón 5 L". El stock, las recetas y los costos
-- siguen yendo en la unidad base (ml, g o unidad); las presentaciones sirven para cargar, contar y mostrar en envases.
CREATE TABLE IF NOT EXISTS presentacion_insumo (
  id         SERIAL PRIMARY KEY,
  id_insumo  INT            NOT NULL REFERENCES insumo (id),
  nombre     VARCHAR(60)    NOT NULL,
  cantidad   NUMERIC(14, 3) NOT NULL CHECK (cantidad > 0),   -- cuánto trae un envase, en la unidad base del insumo
  principal  BOOLEAN        NOT NULL DEFAULT FALSE,          -- la que se usa para mostrar «3 botellas + 200 ml»
  UNIQUE (id_insumo, nombre)
);

-- ---------- auditoría ----------

-- Registro de quién hizo qué y cuándo. Solo se agrega: la aplicación nunca modifica ni borra estas filas.
-- No tiene claves foráneas a propósito: el registro tiene que sobrevivir aunque se cambie o desactive al usuario.
CREATE TABLE IF NOT EXISTS auditoria (
  id          SERIAL PRIMARY KEY,
  fecha_hora  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  id_usuario  INT,                                   -- NULL si todavía no se sabía quién era (login fallido)
  usuario     VARCHAR(150) NOT NULL DEFAULT '',      -- nombre y rol al momento de la acción (foto, no vínculo)
  rol         VARCHAR(20)  NOT NULL DEFAULT '',
  accion      VARCHAR(60)  NOT NULL,                 -- código estable: 'producto.precio', 'pedido.mover'...
  entidad     VARCHAR(40)  NOT NULL DEFAULT '',
  id_entidad  VARCHAR(40)  NOT NULL DEFAULT '',
  resultado   VARCHAR(10)  NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok', 'denegado', 'fallido')),
  detalle     TEXT         NOT NULL DEFAULT '',      -- JSON con datos relevantes (antes/después), sin claves ni tokens
  ip          VARCHAR(64)  NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS auditoria_fecha ON auditoria (fecha_hora DESC);
CREATE INDEX IF NOT EXISTS auditoria_accion ON auditoria (accion, fecha_hora DESC);
CREATE INDEX IF NOT EXISTS auditoria_usuario ON auditoria (id_usuario, fecha_hora DESC);
