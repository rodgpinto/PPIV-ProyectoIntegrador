import { crearDespachador } from './http/despachar.js';
import auditoria from './modules/auditoria/auditoria.rutas.js';
import { INSTANTANEAS } from './modules/auditoria/instantaneas.js';
import { desdeDespachador } from './modules/auditoria/auditoria.servicio.js';
import auth from './modules/auth/auth.rutas.js';
import informes from './modules/informes/informes.rutas.js';
import insumos from './modules/catalogo/insumos.rutas.js';
import productos from './modules/catalogo/productos.rutas.js';
import proveedores from './modules/catalogo/proveedores.rutas.js';
import fichajes from './modules/fichajes/fichajes.rutas.js';
import mesas from './modules/mesas/mesas.rutas.js';
import pedidos from './modules/pedidos/pedidos.rutas.js';
import respaldo from './modules/respaldo/respaldo.rutas.js';
import stock from './modules/stock/stock.rutas.js';
import usuarios from './modules/usuarios/usuarios.rutas.js';
import ventas from './modules/ventas/ventas.rutas.js';

export const rutas = [...auth, ...usuarios, ...productos, ...insumos, ...proveedores, ...stock, ...fichajes, ...mesas, ...pedidos, ...ventas, ...auditoria, ...respaldo, ...informes];
export const despachar = crearDespachador(rutas, { auditar: desdeDespachador, instantaneas: INSTANTANEAS });
