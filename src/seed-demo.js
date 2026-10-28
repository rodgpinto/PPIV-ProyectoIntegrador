// Datos de ejemplo para desarrollo y pruebas. NUNCA ejecutar en producción: crea usuarios con claves conocidas.
import { config } from './config.js';
import { db } from './db.js';
import { fechaEn, inicioDeDia, sumarDias } from './domain/fechas.js';
import { hashearPassword } from './modules/auth/seguridad.js';
import { listarConCostos } from './modules/catalogo/productos.servicio.js';
import * as pedidos from './modules/pedidos/pedidos.servicio.js';
import { registrarIngreso } from './modules/stock/stock.servicio.js';

export const CLAVE_DEMO = 'radas1234';
export const USUARIOS_DEMO = [
  ['Admin Demo', 'admin@radas.test', 'administrador'],
  ['Cecilia Cajera', 'cajero@radas.test', 'cajero'],
  ['Bruno Barra', 'barra@radas.test', 'barra'],
  ['Camila Camarera', 'camarero@radas.test', 'camarero'],
  ['Hugo Host', 'host@radas.test', 'host'],
  ['Carlos Cocina', 'cocina@radas.test', 'cocina'],
];

const PROVEEDORES = [
  ['Distribuidora Río', 'Marcos', '11 5555-0101'],
  ['Mayorista del Puerto', 'Lucía', '11 5555-0202'],
  ['Verdulería Central', 'Don Ramón', '11 5555-0303'],
];

// [nombre, unidad, mínimo, máximo|null, días de aviso de vencimiento]
const INSUMOS = [
  ['Gin', 'ml', 1500, 12000, 7], ['Vermut rojo', 'ml', 1500, 6000, 7], ['Campari', 'ml', 1500, 6000, 7],
  ['Aperol', 'ml', 1500, 6000, 7], ['Prosecco', 'ml', 3000, 12000, 30], ['Agua tónica', 'ml', 5000, 24000, 14],
  ['Soda', 'ml', 5000, 24000, 14], ['Naranja', 'unidad', 10, 60, 3], ['Pan de campo', 'unidad', 10, 40, 2],
  ['Tomate', 'g', 2000, 8000, 3], ['Aceite de oliva', 'ml', 500, 5000, 30], ['Garbanzos cocidos', 'g', 2000, 10000, 3],
  ['Tahini', 'g', 500, 3000, 30], ['Pan pita', 'unidad', 10, 80, 3], ['Croquetas de jamón', 'unidad', 24, 120, 5],
];

// Envases de cada insumo: [insumo, [[nombre, cantidad en la unidad base]]]; el primero es el principal
const PRESENTACIONES = [
  ['Gin', [['Botella 750 ml', 750]]], ['Vermut rojo', [['Botella 900 ml', 900]]], ['Campari', [['Botella 750 ml', 750], ['Botella 1 L', 1000]]],
  ['Aperol', [['Botella 750 ml', 750]]], ['Prosecco', [['Botella 750 ml', 750]]],
  ['Agua tónica', [['Botella 1,5 L', 1500], ['Botella 500 cc', 500]]], ['Soda', [['Sifón 1 L', 1000], ['Botella 500 cc', 500]]],
  ['Aceite de oliva', [['Botella 1 L', 1000], ['Bidón 5 L', 5000]]], ['Croquetas de jamón', [['Caja x 24', 24]]],
];

// [insumo, cantidad, costo total, proveedor, días atrás que ingresó, días hasta que vence | null]
const INGRESOS = [
  ['Gin', 6000, 144000, 0, 10, null], ['Gin', 750, 19500, 1, 3, null],
  ['Vermut rojo', 900, 5400, 0, 6, null], ['Campari', 3000, 54000, 0, 6, null], ['Aperol', 3000, 39000, 0, 6, null],
  ['Prosecco', 6000, 39000, 1, 12, 20], ['Agua tónica', 12000, 18000, 1, 8, 90], ['Soda', 12000, 6000, 1, 8, 60],
  ['Naranja', 30, 6000, 2, 5, 2], ['Pan de campo', 20, 6000, 2, 1, 1],
  ['Tomate', 800, 1200, 2, 8, -1], ['Tomate', 5000, 7500, 2, 1, 6],
  ['Aceite de oliva', 2000, 14000, 1, 15, null], ['Garbanzos cocidos', 4000, 6000, 2, 2, 4],
  ['Tahini', 800, 9600, 1, 10, null], ['Pan pita', 40, 8000, 1, 1, 6], ['Croquetas de jamón', 300, 45000, 1, 25, 60],
];

// [nombre, descripción, categoría, precio, destino, [[insumo, cantidad por porción]]]
const PRODUCTOS = [
  ['Negroni', 'Gin, vermut rojo y Campari, con twist de naranja.', 'Coctelería de autor', 9500, 'barra', [['Gin', 30], ['Vermut rojo', 30], ['Campari', 30], ['Naranja', 0.1]]],
  ['Aperol Spritz', 'Aperol, prosecco y soda, con rodaja de naranja.', 'Coctelería de autor', 8800, 'barra', [['Aperol', 60], ['Prosecco', 90], ['Soda', 30], ['Naranja', 0.1]]],
  ['Gin tonic', 'Gin y agua tónica bien fría.', 'Clásicos', 8200, 'barra', [['Gin', 50], ['Agua tónica', 150]]],
  ['Bruschetta de tomate', 'Pan de campo tostado, tomate y aceite de oliva.', 'Tapeo', 7200, 'cocina', [['Pan de campo', 2], ['Tomate', 80], ['Aceite de oliva', 10]]],
  ['Hummus con pita', 'Crema de garbanzos y tahini con pan pita tibio.', 'Tapeo', 7800, 'cocina', [['Garbanzos cocidos', 120], ['Tahini', 20], ['Pan pita', 1]]],
  ['Croquetas de jamón', 'Seis unidades, crocantes por fuera.', 'Tapeo', 8400, 'cocina', [['Croquetas de jamón', 6]]],
  ['Agua con gas', 'Botella individual.', 'Sin alcohol', 3000, 'barra', []],
];

// Aforo de 32 lugares: 16 adentro y 16 afuera
const MESAS = [
  ['Mesa 1', 'interior', 2], ['Mesa 2', 'interior', 2], ['Mesa 3', 'interior', 2], ['Mesa 4', 'interior', 2],
  ['Living interior', 'interior', 8], ['Living A', 'exterior', 8], ['Living B', 'exterior', 8],
];

/** Carga los datos de ejemplo una sola vez. Devuelve false si ya había datos. */
export async function sembrarDemo(ahora = new Date()) {
  if ((await db.query('SELECT id FROM producto LIMIT 1')).rows[0]) return false;
  const zona = config.zonaHoraria;
  const hoy = fechaEn(zona, ahora);
  const hash = await hashearPassword(CLAVE_DEMO);

  for (const [nombre, email, rol] of USUARIOS_DEMO) {
    await db.query('INSERT INTO usuario (nombre, email, contrasena, rol) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING', [nombre, email, hash, rol]);
  }
  const admin = (await db.query("SELECT id, nombre, rol FROM usuario WHERE email = 'admin@radas.test'")).rows[0];

  const proveedores = [];
  for (const [nombre, contacto, telefono] of PROVEEDORES) {
    proveedores.push((await db.query('INSERT INTO proveedor (nombre, contacto, telefono) VALUES ($1, $2, $3) RETURNING id', [nombre, contacto, telefono])).rows[0].id);
  }
  const idInsumo = new Map();
  for (const [nombre, unidad, minimo, maximo, aviso] of INSUMOS) {
    idInsumo.set(nombre, (await db.query(
      'INSERT INTO insumo (nombre, unidad, stock_minimo, stock_maximo, dias_aviso_vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [nombre, unidad, minimo, maximo, aviso])).rows[0].id);
  }
  for (const [nombre, lista] of PRESENTACIONES) {
    for (const [i, [presentacion, cantidad]] of lista.entries()) {
      await db.query('INSERT INTO presentacion_insumo (id_insumo, nombre, cantidad, principal) VALUES ($1, $2, $3, $4)', [idInsumo.get(nombre), presentacion, cantidad, i === 0]);
    }
  }
  for (const [nombre, cantidad, costoTotal, prov, atras, vence] of INGRESOS) {
    await registrarIngreso({
      id_insumo: idInsumo.get(nombre), cantidad, costo_total: costoTotal, id_proveedor: proveedores[prov],
      fecha_ingreso: sumarDias(hoy, -atras), fecha_vencimiento: vence === null ? null : sumarDias(hoy, vence),
    }, admin, hoy);
  }
  for (const [nombre, descripcion, categoria, precio, destino, receta] of PRODUCTOS) {
    const { rows } = await db.query('INSERT INTO producto (nombre, descripcion, categoria, precio, destino) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nombre, descripcion, categoria, precio, destino]);
    for (const [insumo, cantidad] of receta) {
      await db.query('INSERT INTO detalle_receta (id_producto, id_insumo, cantidad) VALUES ($1, $2, $3)', [rows[0].id, idInsumo.get(insumo), cantidad]);
    }
  }
  for (const [nombre, zonaMesa, capacidad] of MESAS) {
    await db.query('INSERT INTO mesa (nombre, zona, capacidad) VALUES ($1, $2, $3) ON CONFLICT (nombre) DO NOTHING', [nombre, zonaMesa, capacidad]);
  }

  // Fichajes de los últimos días: servicio 19:00 a 02:30 (cocina también hace producción de 12:00 a 18:00)
  const empleados = (await db.query("SELECT id, rol FROM usuario WHERE rol <> 'administrador'")).rows;
  const hora = (fecha, h, m = 0) => new Date(inicioDeDia(fecha, zona).getTime() + (h * 60 + m) * 60000).toISOString();
  for (let atras = 4; atras >= 1; atras -= 1) {
    const dia = sumarDias(hoy, -atras);
    for (const e of empleados) {
      if (e.rol === 'cocina') {
        await db.query("INSERT INTO fichaje (id_usuario, turno, ingreso, egreso) VALUES ($1, 'produccion', $2, $3)", [e.id, hora(dia, 12), hora(dia, 18)]);
      }
      await db.query("INSERT INTO fichaje (id_usuario, turno, ingreso, egreso) VALUES ($1, 'servicio', $2, $3)", [e.id, hora(dia, 19), hora(sumarDias(dia, 1), 2, 30)]);
    }
  }
  // Dos personas con la jornada abierta ahora
  for (const e of empleados.filter((x) => x.rol === 'camarero' || x.rol === 'host')) {
    await db.query("INSERT INTO fichaje (id_usuario, turno, ingreso) VALUES ($1, 'servicio', $2)", [e.id, new Date(ahora.getTime() - 2 * 3600000).toISOString()]);
  }
  // Algunas cuentas abiertas para que la pantalla de cocina y la de pedidos no arranquen vacías
  const usuario = async (email) => (await db.query('SELECT id, nombre, rol FROM usuario WHERE email = $1', [email])).rows[0];
  const [camarera, barra, cocina] = await Promise.all([usuario('camarero@radas.test'), usuario('barra@radas.test'), usuario('cocina@radas.test')]);
  const prod = async (nombre) => (await db.query('SELECT id FROM producto WHERE nombre = $1', [nombre])).rows[0].id;
  const mesa = async (nombre) => (await db.query('SELECT id FROM mesa WHERE nombre = $1', [nombre])).rows[0].id;
  const hace = (min) => new Date(ahora.getTime() - min * 60000);
  const linea = async (nombre, cantidad, nota) => ({ id_producto: await prod(nombre), cantidad, ...(nota ? { nota } : {}) });

  const m1 = await pedidos.crear({ canal: 'mesa', id_mesa: await mesa('Mesa 1'), items: [await linea('Negroni', 2), await linea('Bruschetta de tomate', 1, 'sin aceite')] }, camarera, hace(14));
  await pedidos.cambiarEstado([m1.items[1].id], 'preparando', cocina, hace(9));

  const m3 = await pedidos.crear({ canal: 'mesa', id_mesa: await mesa('Mesa 3'), items: [await linea('Gin tonic', 1), await linea('Croquetas de jamón', 1)] }, camarera, hace(22));
  await pedidos.cambiarEstado([m3.items[1].id], 'listo', cocina, hace(12));
  await pedidos.cambiarEstado([m3.items[1].id], 'entregado', camarera, hace(10));
  await pedidos.cambiarEstado([m3.items[0].id], 'listo', barra, hace(3));

  await pedidos.crear({ canal: 'barra', etiqueta: 'Barra 2', items: [await linea('Aperol Spritz', 2), await linea('Negroni', 1)] }, barra, hace(4));
  await pedidos.crear({ canal: 'mesa', id_mesa: await mesa('Living A'), items: [await linea('Hummus con pita', 2), await linea('Aperol Spritz', 1), await linea('Bruschetta de tomate', 1, 'sin aceite')] }, camarera, hace(2));
  // Ventas de las noches anteriores (cuentas ya cobradas), para que Ventas y Caja tengan historia. Se cargan directo,
  // sin tocar el stock: es un pasado simulado. Es determinístico: siempre salen los mismos números.
  let semilla = 20261014;
  const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
  const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
  const carta = (await listarConCostos()).filter((p) => p.activo);
  const cobrador = await usuario('cajero@radas.test');
  const mesasIds = (await db.query('SELECT id FROM mesa WHERE activo ORDER BY id')).rows.map((m) => m.id);
  const MEDIOS = ['efectivo', 'efectivo', 'tarjeta', 'tarjeta', 'tarjeta', 'mercado_pago', 'transferencia'];
  const ultimaNoche = fechaEn(zona, new Date(ahora.getTime() - 6 * 3600000));
  for (let atras = 1; atras <= 8; atras += 1) {
    const noche = sumarDias(ultimaNoche, -atras);
    if (new Date(`${noche}T12:00:00Z`).getUTCDay() === 1) continue; // los lunes no se abre
    const tope = [5, 6].includes(new Date(`${noche}T12:00:00Z`).getUTCDay()) ? 18 : 12;
    for (let n = 0; n < entre(tope - 4, tope); n += 1) {
      const minutosDesdeApertura = entre(30, 400); // de las 19:30 a la 02:10
      const cobro = new Date(new Date(hora(noche, 19)).getTime() + minutosDesdeApertura * 60000);
      const pidio = new Date(cobro.getTime() - entre(25, 70) * 60000);
      const enBarra = azar() < 0.3;
      const mozo = enBarra ? barra : camarera;
      const lineas = Array.from({ length: entre(1, 4) }, () => ({ p: carta[Math.floor(azar() * carta.length)], cantidad: entre(1, 3) }));
      const total = lineas.reduce((t, l) => t + l.p.precio * l.cantidad, 0);
      const { rows } = await db.query(
        `INSERT INTO pedido (canal, id_mesa, etiqueta, estado, id_usuario, creado_en, cerrado_en, total, medio_pago, id_cobrador)
         VALUES ($1, $2, $3, 'cerrado', $4, $5, $6, $7, $8, $9) RETURNING id`,
        [enBarra ? 'barra' : 'mesa', enBarra ? null : mesasIds[Math.floor(azar() * mesasIds.length)], enBarra ? `Barra ${entre(1, 6)}` : '',
          mozo.id, pidio.toISOString(), cobro.toISOString(), total, MEDIOS[Math.floor(azar() * MEDIOS.length)], cobrador.id],
      );
      for (const l of lineas) {
        await db.query(
          `INSERT INTO item_pedido (id_pedido, id_producto, nombre, destino, cantidad, precio_unitario, costo_unitario, estado, creado_en, entregado_en, id_usuario)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'entregado', $8, $9, $10)`,
          [rows[0].id, l.p.id, l.p.nombre, l.p.destino, l.cantidad, l.p.precio, l.p.tiene_receta ? l.p.costo : null, pidio.toISOString(), cobro.toISOString(), mozo.id],
        );
      }
    }
  }
  return true;
}
