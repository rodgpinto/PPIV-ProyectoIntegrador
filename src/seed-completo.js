// Datos de ejemplo grandes: simula varias semanas de funcionamiento del bar usando los mismos servicios que usa la
// aplicación (pedidos, stock, caja), así que stock, lotes, ventas y caja quedan coherentes entre sí.
// Las fechas son relativas al día en que se ejecuta. NUNCA ejecutar en producción: crea usuarios con claves conocidas.
import { config } from './config.js';
import { db } from './db.js';
import { calcularArqueo, jornadaDe } from './domain/ventas.js';
import { inicioDeDia, sumarDias } from './domain/fechas.js';
import { registrar as auditar } from './modules/auditoria/auditoria.servicio.js';
import { hashearPassword } from './modules/auth/seguridad.js';
import * as pedidos from './modules/pedidos/pedidos.servicio.js';
import { registrarAjuste, registrarIngreso, registrarMerma } from './modules/stock/stock.servicio.js';
import { cerrarCaja, jornada } from './modules/ventas/ventas.servicio.js';
import { CLAVE_DEMO } from './seed-demo.js';

export const USUARIOS_COMPLETO = [
  ['Admin Demo', 'admin@radas.test', 'administrador'],
  ['Cecilia Cajera', 'cajero@radas.test', 'cajero'],
  ['Bruno Barra', 'barra@radas.test', 'barra'],
  ['Camila Camarera', 'camarero@radas.test', 'camarero'],
  ['Hugo Host', 'host@radas.test', 'host'],
  ['Carlos Cocina', 'cocina@radas.test', 'cocina'],
  ['Tomás Barra', 'barra2@radas.test', 'barra'],
  ['Mateo Mozo', 'camarero2@radas.test', 'camarero'],
  ['Julieta Mozas', 'camarero3@radas.test', 'camarero'],
  ['Elena Cocina', 'cocina2@radas.test', 'cocina'],
];

const PROVEEDORES = [
  ['Distribuidora Río', 'Marcos', '11 5555-0101'],
  ['Mayorista del Puerto', 'Lucía', '11 5555-0202'],
  ['Verdulería Central', 'Don Ramón', '11 5555-0303'],
  ['Carnes y Fiambres Alsina', 'Pablo', '11 5555-0404'],
  ['Panificados San Telmo', 'Marta', '11 5555-0505'],
  ['Cervecería Delta', 'Nicolás', '11 5555-0606'],
  ['Lácteos del Sur', 'Graciela', '11 5555-0707'],
  ['Bodega Los Andes', 'Federico', '11 5555-0808'],
];

// [nombre, unidad, mínimo, máximo, días de aviso de vencimiento, vida útil en días (null = no vence), cantidad por envase, precio del envase, proveedor]
const INSUMOS = [
  ['Gin', 'ml', 1500, 6000, 7, null, 750, 19500, 0], ['Vodka', 'ml', 1500, 4500, 7, null, 750, 14500, 0],
  ['Ron', 'ml', 1500, 6000, 7, null, 750, 15500, 0], ['Whisky', 'ml', 1500, 4500, 7, null, 750, 27000, 0],
  ['Tequila', 'ml', 1500, 4500, 7, null, 750, 24500, 0], ['Fernet', 'ml', 1500, 6000, 7, null, 750, 15500, 0],
  ['Vermut rojo', 'ml', 1500, 4500, 7, null, 900, 6000, 0], ['Campari', 'ml', 1500, 6000, 7, null, 750, 14000, 0],
  ['Aperol', 'ml', 1500, 6000, 7, null, 750, 13000, 0], ['Prosecco', 'ml', 3000, 12000, 30, 180, 750, 6500, 7],
  ['Vino tinto Malbec', 'ml', 3000, 9000, 30, null, 750, 5200, 7], ['Vino blanco', 'ml', 3000, 9000, 30, null, 750, 4800, 7],
  ['Cerveza IPA lata', 'unidad', 24, 120, 14, 120, 24, 36000, 5], ['Cerveza rubia lata', 'unidad', 24, 144, 14, 120, 24, 26400, 5],
  ['Agua tónica', 'ml', 5000, 18000, 14, 180, 1500, 2250, 1], ['Soda', 'ml', 5000, 24000, 14, 60, 1000, 500, 1],
  ['Gaseosa cola', 'ml', 5000, 18000, 14, 180, 2250, 2600, 1], ['Agua mineral con gas', 'unidad', 12, 72, 14, 365, 12, 7200, 1],
  ['Limón', 'unidad', 20, 100, 3, 12, 50, 5000, 2], ['Naranja', 'unidad', 10, 60, 3, 6, 30, 6000, 2],
  ['Menta', 'g', 50, 300, 2, 5, 100, 1500, 2], ['Azúcar', 'g', 1000, 6000, 30, null, 1000, 1100, 1],
  ['Pan de campo', 'unidad', 10, 60, 2, 3, 20, 6000, 4], ['Pan pita', 'unidad', 10, 80, 3, 5, 40, 8000, 4],
  ['Pan de hamburguesa', 'unidad', 12, 72, 3, 4, 24, 9600, 4], ['Carne molida', 'g', 2000, 10000, 2, 3, 2000, 13000, 3],
  ['Queso cheddar (fetas)', 'unidad', 20, 100, 7, 20, 50, 6500, 6], ['Queso muzzarella', 'g', 1500, 6000, 5, 14, 2000, 14000, 6],
  ['Jamón cocido', 'g', 1000, 4000, 4, 10, 1000, 9500, 3], ['Papas', 'g', 3000, 15000, 3, 10, 5000, 6500, 2],
  ['Tomate', 'g', 1500, 6000, 2, 5, 2000, 3000, 2], ['Lechuga', 'g', 500, 2500, 2, 4, 500, 1500, 2],
  ['Aceite de oliva', 'ml', 500, 4000, 30, null, 1000, 7000, 1], ['Aceite de girasol', 'ml', 1000, 10000, 30, null, 5000, 9000, 1],
  ['Garbanzos cocidos', 'g', 2000, 8000, 3, 5, 2000, 3000, 2], ['Tahini', 'g', 400, 2400, 30, 180, 800, 9600, 1],
  ['Croquetas de jamón', 'unidad', 24, 144, 5, 60, 24, 3600, 3], ['Huevos', 'unidad', 12, 90, 7, 20, 30, 6000, 6],
  ['Crema de leche', 'ml', 1000, 5000, 5, 12, 1000, 4200, 6], ['Dulce de leche', 'g', 800, 4000, 20, 120, 1000, 4500, 6],
  ['Chocolate', 'g', 600, 3000, 30, 180, 1000, 9000, 1],
];

// Envases con que se carga cada insumo: [insumo, [[nombre, cantidad en la unidad base]]]; el primero es el principal
const PRESENTACIONES = [
  ['Gin', [['Botella 750 ml', 750]]], ['Vodka', [['Botella 750 ml', 750]]], ['Ron', [['Botella 750 ml', 750]]],
  ['Whisky', [['Botella 750 ml', 750]]], ['Tequila', [['Botella 750 ml', 750]]], ['Fernet', [['Botella 750 ml', 750], ['Botella 1 L', 1000]]],
  ['Vermut rojo', [['Botella 900 ml', 900]]], ['Campari', [['Botella 750 ml', 750], ['Botella 1 L', 1000]]], ['Aperol', [['Botella 750 ml', 750]]],
  ['Prosecco', [['Botella 750 ml', 750]]], ['Vino tinto Malbec', [['Botella 750 ml', 750]]], ['Vino blanco', [['Botella 750 ml', 750]]],
  ['Cerveza IPA lata', [['Pack x 24', 24]]], ['Cerveza rubia lata', [['Pack x 24', 24]]],
  ['Agua tónica', [['Botella 1,5 L', 1500], ['Botella 500 cc', 500]]], ['Soda', [['Sifón 1 L', 1000], ['Botella 500 cc', 500]]],
  ['Gaseosa cola', [['Botella 2,25 L', 2250]]], ['Aceite de oliva', [['Botella 1 L', 1000]]], ['Aceite de girasol', [['Bidón 5 L', 5000]]],
  ['Croquetas de jamón', [['Caja x 24', 24]]], ['Huevos', [['Maple x 30', 30]]],
];

// [nombre, descripción, categoría, precio, destino, popularidad (peso en las ventas), [[insumo, cantidad por porción]]]
const PRODUCTOS = [
  ['Negroni', 'Gin, vermut rojo y Campari, con twist de naranja.', 'Coctelería de autor', 9500, 'barra', 6, [['Gin', 30], ['Vermut rojo', 30], ['Campari', 30], ['Naranja', 0.1]]],
  ['Aperol Spritz', 'Aperol, prosecco y soda, con rodaja de naranja.', 'Coctelería de autor', 8800, 'barra', 8, [['Aperol', 60], ['Prosecco', 90], ['Soda', 30], ['Naranja', 0.1]]],
  ['Campari Spritz', 'Campari, prosecco y soda.', 'Coctelería de autor', 8800, 'barra', 3, [['Campari', 60], ['Prosecco', 90], ['Soda', 30], ['Naranja', 0.1]]],
  ['Mojito', 'Ron, lima, menta y soda.', 'Coctelería de autor', 9000, 'barra', 6, [['Ron', 50], ['Limón', 0.5], ['Menta', 8], ['Azúcar', 15], ['Soda', 60]]],
  ['Margarita', 'Tequila, limón y azúcar.', 'Coctelería de autor', 9200, 'barra', 4, [['Tequila', 50], ['Limón', 1], ['Azúcar', 5]]],
  ['Old Fashioned', 'Whisky, azúcar y naranja.', 'Coctelería de autor', 10500, 'barra', 3, [['Whisky', 60], ['Azúcar', 8], ['Naranja', 0.1]]],
  ['Daiquiri', 'Ron, limón y azúcar.', 'Coctelería de autor', 8900, 'barra', 3, [['Ron', 50], ['Limón', 1], ['Azúcar', 15]]],
  ['Gin tonic', 'Gin y agua tónica bien fría.', 'Clásicos', 8200, 'barra', 8, [['Gin', 50], ['Agua tónica', 150]]],
  ['Vodka tonic', 'Vodka y agua tónica.', 'Clásicos', 7800, 'barra', 4, [['Vodka', 50], ['Agua tónica', 150]]],
  ['Fernet con cola', 'El de siempre.', 'Clásicos', 7000, 'barra', 9, [['Fernet', 70], ['Gaseosa cola', 200]]],
  ['Cuba libre', 'Ron, cola y limón.', 'Clásicos', 7600, 'barra', 4, [['Ron', 50], ['Gaseosa cola', 150], ['Limón', 0.25]]],
  ['Cerveza IPA (lata)', 'Lata de 473 ml.', 'Cervezas y vinos', 5200, 'barra', 6, [['Cerveza IPA lata', 1]]],
  ['Cerveza rubia (lata)', 'Lata de 473 ml.', 'Cervezas y vinos', 4200, 'barra', 6, [['Cerveza rubia lata', 1]]],
  ['Copa de Malbec', 'Copa de 150 ml.', 'Cervezas y vinos', 5600, 'barra', 4, [['Vino tinto Malbec', 150]]],
  ['Copa de vino blanco', 'Copa de 150 ml.', 'Cervezas y vinos', 5200, 'barra', 2, [['Vino blanco', 150]]],
  ['Copa de prosecco', 'Copa de 125 ml.', 'Cervezas y vinos', 6200, 'barra', 3, [['Prosecco', 125]]],
  ['Agua con gas', 'Botella individual.', 'Sin alcohol', 3000, 'barra', 5, [['Agua mineral con gas', 1]]],
  ['Limonada con menta', 'Limón, menta y soda.', 'Sin alcohol', 4800, 'barra', 3, [['Limón', 1.5], ['Menta', 8], ['Azúcar', 25], ['Soda', 150]]],
  ['Gaseosa cola', 'Vaso de 350 ml.', 'Sin alcohol', 3500, 'barra', 3, [['Gaseosa cola', 350]]],
  ['Bruschetta de tomate', 'Pan de campo tostado, tomate y aceite de oliva.', 'Tapeo', 7200, 'cocina', 4, [['Pan de campo', 2], ['Tomate', 80], ['Aceite de oliva', 10]]],
  ['Hummus con pita', 'Crema de garbanzos y tahini con pan pita tibio.', 'Tapeo', 7800, 'cocina', 3, [['Garbanzos cocidos', 120], ['Tahini', 20], ['Pan pita', 1], ['Aceite de oliva', 5]]],
  ['Croquetas de jamón', 'Seis unidades, crocantes por fuera.', 'Tapeo', 8400, 'cocina', 4, [['Croquetas de jamón', 6], ['Aceite de girasol', 40]]],
  ['Papas fritas', 'Porción para compartir.', 'Tapeo', 6800, 'cocina', 6, [['Papas', 300], ['Aceite de girasol', 60]]],
  ['Tabla de fiambres y quesos', 'Jamón cocido, muzzarella y pan de campo.', 'Tapeo', 16500, 'cocina', 3, [['Jamón cocido', 100], ['Queso muzzarella', 150], ['Pan de campo', 3], ['Aceite de oliva', 15]]],
  ['Hamburguesa clásica', 'Carne, cheddar, lechuga y tomate.', 'Principales', 12800, 'cocina', 6, [['Pan de hamburguesa', 1], ['Carne molida', 180], ['Queso cheddar (fetas)', 1], ['Lechuga', 20], ['Tomate', 40]]],
  ['Hamburguesa doble', 'Doble carne y doble cheddar.', 'Principales', 15800, 'cocina', 3, [['Pan de hamburguesa', 1], ['Carne molida', 360], ['Queso cheddar (fetas)', 2], ['Lechuga', 20], ['Tomate', 40]]],
  ['Tostado de jamón y queso', 'Pan de campo, jamón cocido y muzzarella.', 'Principales', 8900, 'cocina', 3, [['Pan de campo', 2], ['Jamón cocido', 60], ['Queso muzzarella', 80]]],
  ['Flan con dulce de leche', 'Casero, con crema.', 'Postres', 6200, 'cocina', 2, [['Huevos', 1], ['Crema de leche', 60], ['Dulce de leche', 40]]],
  ['Brownie con crema', 'Chocolate intenso.', 'Postres', 6800, 'cocina', 2, [['Chocolate', 60], ['Huevos', 1], ['Crema de leche', 50]]],
];

// Aforo de 32 lugares: 16 adentro y 16 afuera
const MESAS = [
  ['Mesa 1', 'interior', 2], ['Mesa 2', 'interior', 2], ['Mesa 3', 'interior', 2], ['Mesa 4', 'interior', 2],
  ['Living interior', 'interior', 8], ['Living A', 'exterior', 8], ['Living B', 'exterior', 8],
];

const MEDIOS = [['efectivo', 25], ['tarjeta', 35], ['mercado_pago', 25], ['transferencia', 15]];
const NOTAS = ['sin hielo', 'bien frío', 'sin azúcar', 'sin cebolla', 'para compartir', 'con poco hielo', 'sin aceite'];

/**
 * Carga el escenario. Devuelve null si ya había datos; si no, un resumen de lo cargado.
 * `dias`: cuántos días hacia atrás se simulan (por defecto 28). `avisar`: función para ir informando el avance.
 */
export async function sembrarCompleto({ ahora = new Date(), dias = 28, avisar = () => {} } = {}) {
  if ((await db.query('SELECT id FROM producto LIMIT 1')).rows[0]) return null;
  const zona = config.zonaHoraria;
  const inicioJornada = config.jornadaInicioHora;
  const hoy = jornadaDe(ahora, zona, inicioJornada); // la noche en curso (o la que acaba de terminar)
  const primera = sumarDias(hoy, -dias);

  // Números pseudoaleatorios repetibles: siempre salen los mismos valores (cambian solo las fechas)
  let semilla = 20261108;
  const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
  const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
  const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
  const ponderado = (lista, peso) => {
    let r = azar() * lista.reduce((s, x) => s + peso(x), 0);
    for (const x of lista) { r -= peso(x); if (r < 0) return x; }
    return lista[lista.length - 1];
  };
  const diaSemana = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 domingo ... 1 lunes
  const instante = (fecha, minutos) => new Date(inicioDeDia(fecha, zona).getTime() + minutos * 60000);

  // --- Catálogo ---
  const hash = await hashearPassword(CLAVE_DEMO);
  const usuarios = new Map();
  for (const [nombre, email, rol] of USUARIOS_COMPLETO) {
    const { rows } = await db.query('INSERT INTO usuario (nombre, email, contrasena, rol, creado_en) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nombre, email, hash, rol, instante(primera, -600).toISOString()]);
    usuarios.set(email, { id: rows[0].id, nombre, rol, email });
  }
  const admin = usuarios.get('admin@radas.test');
  const cajero = usuarios.get('cajero@radas.test');
  const delRol = (rol) => [...usuarios.values()].filter((u) => u.rol === rol);

  const idProveedor = [];
  for (const [nombre, contacto, telefono] of PROVEEDORES) {
    idProveedor.push((await db.query('INSERT INTO proveedor (nombre, contacto, telefono) VALUES ($1, $2, $3) RETURNING id', [nombre, contacto, telefono])).rows[0].id);
  }
  const insumos = new Map(); // nombre → datos del insumo
  for (const [nombre, unidad, minimo, maximo, aviso, vida, envase, precioEnvase, prov] of INSUMOS) {
    const { rows } = await db.query(
      'INSERT INTO insumo (nombre, unidad, stock_minimo, stock_maximo, dias_aviso_vencimiento) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [nombre, unidad, minimo, maximo, aviso],
    );
    insumos.set(nombre, { id: rows[0].id, nombre, minimo, maximo, vida, envase, precioEnvase, prov: idProveedor[prov] });
  }
  for (const [nombre, lista] of PRESENTACIONES) {
    for (const [i, [presentacion, cantidad]] of lista.entries()) {
      await db.query('INSERT INTO presentacion_insumo (id_insumo, nombre, cantidad, principal) VALUES ($1, $2, $3, $4)', [insumos.get(nombre).id, presentacion, cantidad, i === 0]);
    }
  }
  const carta = [];
  for (const [nombre, descripcion, categoria, precio, destino, peso, receta] of PRODUCTOS) {
    const { rows } = await db.query('INSERT INTO producto (nombre, descripcion, categoria, precio, destino) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nombre, descripcion, categoria, precio, destino]);
    for (const [insumo, cantidad] of receta) {
      await db.query('INSERT INTO detalle_receta (id_producto, id_insumo, cantidad) VALUES ($1, $2, $3)', [rows[0].id, insumos.get(insumo).id, cantidad]);
    }
    carta.push({ id: rows[0].id, nombre, categoria, precio, destino, peso });
  }
  // Un plato que ya no se ofrece, para mostrar la baja
  await db.query("INSERT INTO producto (nombre, descripcion, categoria, precio, destino, activo) VALUES ('Tabla de verano', 'Plato de temporada, ya fuera de carta.', 'Tapeo', 14500, 'cocina', false)");
  const idMesas = [];
  for (const [nombre, zonaMesa, capacidad] of MESAS) {
    idMesas.push((await db.query('INSERT INTO mesa (nombre, zona, capacidad) VALUES ($1, $2, $3) RETURNING id', [nombre, zonaMesa, capacidad])).rows[0].id);
  }

  // --- Ayudas: todo lo que se registra "en el pasado" lleva la fecha de ese momento ---
  const conFecha = async (momento, accion) => {
    const { rows: [m] } = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM movimiento_stock');
    const { rows: [l] } = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM lote_insumo');
    const resultado = await accion();
    await db.query('UPDATE movimiento_stock SET fecha_hora = $1 WHERE id > $2', [momento.toISOString(), Number(m.id)]);
    await db.query('UPDATE lote_insumo SET creado_en = $1 WHERE id > $2', [momento.toISOString(), Number(l.id)]);
    return resultado;
  };
  const resumen = { dias, cuentas: 0, ventas: 0, cierres: 0, ingresos: 0, mermas: 0, fichajes: 0, sin_stock: 0 };
  const semanasDesde = (fecha) => (new Date(`${fecha}T12:00:00Z`) - new Date(`${primera}T12:00:00Z`)) / (7 * 86400000);

  async function reponer(dia, { final }) {
    const momento = new Date(Math.min(instante(dia, 9 * 60 + entre(0, 90)).getTime(), ahora.getTime()));
    // Lo vencido antes de hoy se tira (el último día se deja a la vista, como alerta)
    if (!final) {
      const { rows: vencidos } = await db.query('SELECT id, id_insumo, cantidad_actual FROM lote_insumo WHERE cantidad_actual > 0 AND fecha_vencimiento < $1 ORDER BY id', [dia]);
      for (const l of vencidos) {
        await conFecha(momento, () => registrarMerma({ id_insumo: l.id_insumo, cantidad: l.cantidad_actual, motivo: 'vencido', nota: 'Vencido', id_lote: l.id }, admin));
        await auditar({ ahora: momento, usuario: admin, accion: 'stock.merma', entidad: 'insumo', id_entidad: l.id_insumo, detalle: { motivo: 'vencido', cantidad: l.cantidad_actual } });
        resumen.mermas += 1;
      }
    }
    for (const ins of insumos.values()) {
      const { rows: [s] } = await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [ins.id]);
      const stock = Number(s.stock_actual);
      // Se repone cuando queda poco más de la mitad del rango, para no quedarse sin stock en plena noche
      if (stock >= ins.minimo + (ins.maximo - ins.minimo) * 0.55) continue;
      const envases = Math.max(1, Math.ceil((ins.maximo * 0.85 - stock) / ins.envase));
      const precio = Math.round(ins.precioEnvase * (1 + 0.01 * semanasDesde(dia)) * (0.97 + azar() * 0.06) / 10) * 10; // sube de a poco, con algo de variación
      const vence = ins.vida === null ? null : sumarDias(dia, ins.vida + entre(0, 2));
      await conFecha(momento, () => registrarIngreso({
        id_insumo: ins.id, cantidad: envases * ins.envase, costo_total: precio * envases, id_proveedor: ins.prov,
        fecha_ingreso: dia, fecha_vencimiento: vence,
      }, admin, dia));
      await auditar({ ahora: momento, usuario: admin, accion: 'stock.ingreso', entidad: 'insumo', id_entidad: ins.id, detalle: { cantidad: envases * ins.envase, costo_total: precio * envases } });
      resumen.ingresos += 1;
    }
  }

  async function fichar(dia) {
    // Cada persona trabaja casi todas las noches; los fines de semana, todas
    const finde = [5, 6].includes(diaSemana(dia));
    for (const u of usuarios.values()) {
      if (u.rol === 'administrador') continue;
      if (!finde && azar() < (diaSemana(dia) === 0 ? 0.15 : 0.4)) continue;
      const tramos = [];
      if (u.rol === 'cocina' && (finde || azar() < 0.6)) tramos.push(['produccion', instante(dia, 12 * 60 + entre(-10, 10)), instante(dia, 18 * 60 + entre(-10, 20))]);
      tramos.push(['servicio', instante(dia, 19 * 60 + entre(-20, 10)), instante(dia, 26 * 60 + entre(5, 60))]);
      for (const [turno, entra, sale] of tramos) {
        if (entra > ahora) continue;
        const cerrado = sale <= ahora;
        const { rows: [f] } = await db.query('INSERT INTO fichaje (id_usuario, turno, ingreso, egreso, creado_en) VALUES ($1, $2, $3, $4, $3) RETURNING id', [u.id, turno, entra.toISOString(), cerrado ? sale.toISOString() : null]);
        const idFichaje = f.id;
        await auditar({ ahora: entra, usuario: u, accion: 'fichaje.ingreso', entidad: 'fichaje', id_entidad: String(idFichaje), detalle: { turno } });
        if (cerrado) await auditar({ ahora: sale, usuario: u, accion: 'fichaje.egreso', entidad: 'fichaje', id_entidad: String(idFichaje), detalle: { turno } });
        resumen.fichajes += 1;
      }
    }
  }

  async function noche(dia, completa) {
    const dow = diaSemana(dia);
    const [desde, hasta] = [5, 6].includes(dow) ? [34, 48] : dow === 0 ? [22, 30] : [14, 22];
    const salidas = Array.from({ length: entre(desde, hasta) }, () => entre(30, 150) + entre(0, 180)).sort((a, b) => a - b);
    let total = 0;
    let cuentas = 0;
    for (const minuto of salidas) {
      const t0 = instante(dia, 19 * 60 + minuto);
      const enBarra = azar() < 0.3;
      const mozo = elegir(delRol(enBarra ? 'barra' : 'camarero'));
      const rondas = [{ t: t0, nuevas: lineas() }];
      if (azar() < 0.2) rondas.push({ t: new Date(t0.getTime() + entre(25, 45) * 60000), nuevas: lineas(1, 2) });
      const plan = rondas.map((r) => ({ ...r, tiempos: r.nuevas.map((l) => tiemposDe(l.p.destino, r.t)) }));
      const ultimaEntrega = Math.max(...plan.flatMap((r) => r.tiempos.map((x) => x.entregado.getTime())));
      const cobro = new Date(ultimaEntrega + (enBarra ? entre(3, 15) : entre(15, 60)) * 60000);
      if (cobro > ahora) continue; // todavía no pasó: no se carga como vendido

      const conocidos = new Set();
      let id = null;
      let mesa = null;
      for (const [i, r] of plan.entries()) {
        const pedido = await conFecha(r.t, async () => {
          if (i === 0) {
            mesa = enBarra ? null : elegir(idMesas);
            return pedidos.crear({ canal: enBarra ? 'barra' : 'mesa', id_mesa: mesa ?? undefined, etiqueta: enBarra ? `Barra ${entre(1, 6)}` : '', items: r.nuevas.map(itemDe) }, mozo, r.t);
          }
          return pedidos.agregar(id, r.nuevas.map(itemDe), mozo, r.t);
        });
        id = pedido.id;
        if (pedido.sin_stock?.length) resumen.sin_stock += 1;
        const nuevos = pedido.items.filter((it) => !conocidos.has(it.id));
        nuevos.forEach((it) => conocidos.add(it.id));
        for (const destino of ['cocina', 'barra']) {
          const delDestino = nuevos.filter((it) => it.destino === destino);
          if (!delDestino.length) continue;
          const t = tiemposDe(destino, r.t, r.tiempos[r.nuevas.findIndex((l) => l.p.destino === destino)]);
          const quien = elegir(delRol(destino));
          const ids = delDestino.map((it) => it.id);
          await pedidos.cambiarEstado(ids, 'preparando', quien, t.preparando);
          await pedidos.cambiarEstado(ids, 'listo', quien, t.listo);
          await pedidos.cambiarEstado(ids, 'entregado', mozo, t.entregado);
        }
      }
      const medio = ponderado(MEDIOS, (m) => m[1])[0];
      const cerrada = await pedidos.cerrar(id, { medio_pago: medio }, cajero, cobro);
      await auditar({ ahora: cobro, usuario: cajero, accion: 'pedido.cobrar', entidad: 'pedido', id_entidad: String(id), detalle: { medio_pago: medio, total: cerrada.total } });
      total += cerrada.total;
      cuentas += 1;
    }
    // Alguna anulación y alguna cuenta cancelada por noche de mucho movimiento
    if (cuentas > 20) await anulaciones(dia);
    resumen.cuentas += cuentas;
    resumen.ventas += total;
    if (completa) await cerrarNoche(dia);
    avisar(`${dia}: ${cuentas} cuentas, $ ${Math.round(total).toLocaleString('es-AR')}`);
  }

  // Una línea anulada antes de prepararse (vuelve al stock) y una cuenta cancelada sin consumos
  async function anulaciones(dia) {
    const t = instante(dia, 21 * 60 + entre(0, 120));
    if (t > ahora) return;
    const mozo = elegir(delRol('camarero'));
    const producto = ponderado(carta, (p) => p.peso);
    const p = await conFecha(t, () => pedidos.crear({ canal: 'mesa', id_mesa: elegir(idMesas), items: [{ id_producto: producto.id, cantidad: 1 }] }, mozo, t));
    await conFecha(t, () => pedidos.anularItem(p.items[0].id, mozo, new Date(t.getTime() + 60000), dia));
    await pedidos.cancelar(p.id, new Date(t.getTime() + 120000));
  }

  async function cerrarNoche(dia) {
    const t = instante(dia, 26 * 60 + entre(20, 50));
    const j = await jornada(dia, t);
    const retiros = [5, 6].includes(diaSemana(dia)) ? entre(0, 3) * 10000 : 0;
    const diferencias = [0, 0, 0, 0, 0, -500, -1000, 500, -2000, 1000, -300];
    const todo = azar() < 0.7;
    for (const canal of todo ? ['todos'] : ['mesa', 'barra']) {
      const ef = j.por_caja[canal].ventas_efectivo;
      const fondo = canal === 'barra' ? 8000 : 20000;
      const { efectivo_esperado: esperado } = calcularArqueo({ ventas_efectivo: ef, fondo_inicial: fondo, retiros: canal === 'barra' ? 0 : retiros });
      const dif = elegir(diferencias);
      await cerrarCaja({ fecha: dia, canal, fondo_inicial: fondo, retiros: canal === 'barra' ? 0 : retiros, efectivo_contado: esperado + dif, nota: dif < 0 ? 'Diferencia por vuelto mal dado' : '' }, cajero, t);
      await auditar({ ahora: t, usuario: cajero, accion: 'caja.cerrar', entidad: 'cierre_caja', id_entidad: dia, detalle: { canal } });
      resumen.cierres += 1;
    }
  }

  function lineas(min = 1, max = 4) {
    const elegidas = [];
    const cantidad = entre(min, max);
    while (elegidas.length < cantidad) {
      const p = ponderado(carta, (x) => x.peso);
      if (elegidas.some((l) => l.p.id === p.id)) continue;
      elegidas.push({ p, cantidad: p.destino === 'barra' ? entre(1, 3) : entre(1, 2), nota: azar() < 0.08 ? elegir(NOTAS) : '' });
    }
    return elegidas;
  }
  const itemDe = (l) => ({ id_producto: l.p.id, cantidad: l.cantidad, ...(l.nota ? { nota: l.nota } : {}) });
  function tiemposDe(destino, desde, hechos = null) {
    if (hechos) return hechos;
    const minutos = (n) => new Date(desde.getTime() + n * 60000);
    const [p, l, e] = destino === 'barra' ? [entre(1, 3), entre(4, 9), entre(1, 2)] : [entre(2, 6), entre(8, 18), entre(1, 3)];
    return { preparando: minutos(p), listo: minutos(p + l), entregado: minutos(p + l + e) };
  }

  // --- Línea de tiempo: día por día, desde la primera noche hasta hoy ---
  const hace = (min) => new Date(ahora.getTime() - min * 60000);
  for (let dia = primera; dia <= hoy; dia = sumarDias(dia, 1)) {
    const final = dia >= sumarDias(hoy, -2);
    await reponer(dia, { final });
    if (diaSemana(dia) === 1 && dia !== hoy) { // los lunes no se abre: se hace el conteo físico de algunos insumos
      const momento = instante(dia, 11 * 60);
      for (const ins of Array.from({ length: 4 }, () => elegir([...insumos.values()]))) {
        const { rows: [s] } = await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [ins.id]);
        const real = Math.round(Number(s.stock_actual) * (0.95 + azar() * 0.045) * 1000) / 1000;
        if (real >= 0 && real !== Number(s.stock_actual)) {
          await conFecha(momento, () => registrarAjuste({ id_insumo: ins.id, cantidad_real: real, nota: 'Conteo semanal' }, admin, dia));
          await auditar({ ahora: momento, usuario: admin, accion: 'stock.conteo', entidad: 'insumo', id_entidad: ins.id, detalle: { cantidad_real: real } });
        }
      }
      continue;
    }
    if (dia === sumarDias(hoy, -14)) await subirPrecios(dia);
    await fichar(dia);
    if (instante(dia, 19 * 60 + 30) > ahora) continue; // la noche de hoy todavía no empezó
    await noche(dia, dia < hoy);
    // Alguna merma suelta durante la noche
    if (azar() < 0.5) {
      const ins = insumos.get(elegir(['Limón', 'Menta', 'Naranja', 'Pan de campo', 'Tomate', 'Gin', 'Prosecco']));
      const { rows: [s] } = await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [ins.id]);
      const cantidad = Math.max(1, Math.round(Number(s.stock_actual) * 0.02));
      const momento = instante(dia, 23 * 60 + 30);
      if (Number(s.stock_actual) > cantidad * 5 && momento <= ahora) {
        const motivo = elegir(['se_cayo', 'se_cayo', 'consumo_interno', 'devolucion']);
        await conFecha(momento, () => registrarMerma({ id_insumo: ins.id, cantidad, motivo, nota: '' }, elegir(delRol('barra'))));
        await auditar({ ahora: momento, usuario: admin, accion: 'stock.merma', entidad: 'insumo', id_entidad: ins.id, detalle: { motivo, cantidad } });
        resumen.mermas += 1;
      }
    }
  }

  // Aumento de precios a mitad del período: queda en la auditoría con el antes y el después
  async function subirPrecios(dia) {
    const momento = instante(dia, 10 * 60);
    for (const p of carta.filter((x) => x.categoria !== 'Sin alcohol')) {
      const nuevo = Math.round(p.precio * 1.08 / 100) * 100;
      await db.query('UPDATE producto SET precio = $1 WHERE id = $2', [nuevo, p.id]);
      await auditar({ ahora: momento, usuario: admin, accion: 'producto.precio', entidad: 'producto', id_entidad: p.id, detalle: { cambios: { precio: [p.precio, nuevo] } } });
      p.precio = nuevo;
    }
  }

  // Un conteo de hoy encuentra poco stock de dos insumos: quedan en la alerta de reposición
  for (const [nombre, fraccion] of [['Fernet', 0.8], ['Menta', 0.6]]) {
    const ins = insumos.get(nombre);
    const real = Math.round(ins.minimo * fraccion);
    const momento = new Date(Math.min(instante(hoy, 17 * 60).getTime(), ahora.getTime()));
    await conFecha(momento, () => registrarAjuste({ id_insumo: ins.id, cantidad_real: real, nota: 'Conteo de la tarde: queda poco' }, admin, hoy));
    await auditar({ ahora: momento, usuario: admin, accion: 'stock.conteo', entidad: 'insumo', id_entidad: ins.id, detalle: { cantidad_real: real } });
  }

  // --- Lo que pasa ahora mismo: algunas cuentas abiertas para la pantalla de cocina y la de pedidos ---
  const mozo = usuarios.get('camarero@radas.test');
  const barra = usuarios.get('barra@radas.test');
  const cocina = usuarios.get('cocina@radas.test');
  const producto = (nombre) => carta.find((p) => p.nombre === nombre).id;
  const mesa = (nombre) => idMesas[MESAS.findIndex((m) => m[0] === nombre)];
  const abrir = (cuerpo, usuario, minutos) => conFecha(hace(minutos), () => pedidos.crear(cuerpo, usuario, hace(minutos)));
  const m1 = await abrir({ canal: 'mesa', id_mesa: mesa('Mesa 1'), items: [{ id_producto: producto('Negroni'), cantidad: 2 }, { id_producto: producto('Bruschetta de tomate'), cantidad: 1, nota: 'sin aceite' }] }, mozo, 14);
  await pedidos.cambiarEstado([m1.items[1].id], 'preparando', cocina, hace(9));
  const m3 = await abrir({ canal: 'mesa', id_mesa: mesa('Mesa 3'), items: [{ id_producto: producto('Gin tonic'), cantidad: 1 }, { id_producto: producto('Croquetas de jamón'), cantidad: 1 }] }, mozo, 22);
  await pedidos.cambiarEstado([m3.items[1].id], 'listo', cocina, hace(12));
  await pedidos.cambiarEstado([m3.items[1].id], 'entregado', mozo, hace(10));
  await pedidos.cambiarEstado([m3.items[0].id], 'listo', barra, hace(3));
  await abrir({ canal: 'barra', etiqueta: 'Barra 2', items: [{ id_producto: producto('Aperol Spritz'), cantidad: 2 }, { id_producto: producto('Negroni'), cantidad: 1 }] }, barra, 4);
  await abrir({ canal: 'mesa', id_mesa: mesa('Living A'), items: [{ id_producto: producto('Hamburguesa clásica'), cantidad: 2 }, { id_producto: producto('Papas fritas'), cantidad: 1 }, { id_producto: producto('Cerveza IPA (lata)'), cantidad: 3 }] }, mozo, 2);

  resumen.hoy = hoy;
  return resumen;
}
