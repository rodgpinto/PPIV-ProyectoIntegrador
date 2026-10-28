// Qué acciones se registran en la auditoría y cómo se llaman en pantalla. Es la única tabla que hay que tocar
// cuando se agrega una ruta que modifica datos: el test "toda ruta que modifica tiene etiqueta" avisa si falta.
// Clave: 'MÉTODO /ruta' tal cual está en la API. Valor: [código estable, texto para mostrar, entidad].
// Los códigos no se renombran (quedan guardados en la base); los textos sí se pueden mejorar.

export const ETIQUETAS = {
  'POST /auth/login': ['auth.login', 'Inicio de sesión', 'usuario'],
  'POST /auth/logout': ['auth.logout', 'Cierre de sesión', 'usuario'],
  'POST /auth/cambiar-contrasena': ['auth.clave', 'Cambió su contraseña', 'usuario'],

  'POST /usuarios': ['usuario.crear', 'Creó un usuario', 'usuario'],
  'PATCH /usuarios/:id': ['usuario.editar', 'Modificó un usuario', 'usuario'],

  'POST /productos': ['producto.crear', 'Creó un producto', 'producto'],
  'PATCH /productos/:id': ['producto.editar', 'Modificó un producto', 'producto'],
  'DELETE /productos/:id': ['producto.baja', 'Dio de baja un producto', 'producto'],
  'PUT /productos/:id/receta': ['producto.receta', 'Cambió la receta de un producto', 'producto'],
  'PATCH /productos/:id/precio': ['producto.precio', 'Cambió el precio de un producto', 'producto'],
  'PUT /productos/precios': ['producto.precios', 'Actualizó precios en lote', 'producto'],
  'POST /productos/ajuste-precios': ['producto.ajuste_precios', 'Aplicó un ajuste porcentual de precios', 'producto'],

  'POST /insumos': ['insumo.crear', 'Creó un insumo', 'insumo'],
  'PUT /insumos/:id/presentaciones': ['insumo.presentaciones', 'Cambió las presentaciones de un insumo', 'insumo'],
  'PATCH /insumos/:id': ['insumo.editar', 'Modificó un insumo', 'insumo'],
  'DELETE /insumos/:id': ['insumo.baja', 'Dio de baja un insumo', 'insumo'],

  'POST /proveedores': ['proveedor.crear', 'Creó un proveedor', 'proveedor'],
  'PATCH /proveedores/:id': ['proveedor.editar', 'Modificó un proveedor', 'proveedor'],

  'POST /stock/ingresos': ['stock.ingreso', 'Registró un ingreso de mercadería', 'insumo'],
  'POST /stock/mermas': ['stock.merma', 'Registró una merma', 'insumo'],
  'POST /stock/ajustes': ['stock.conteo', 'Corrigió el stock con un conteo físico', 'insumo'],

  'POST /fichajes/ingreso': ['fichaje.ingreso', 'Fichó el ingreso', 'fichaje'],
  'POST /fichajes/egreso': ['fichaje.egreso', 'Fichó el egreso', 'fichaje'],
  'POST /fichajes': ['fichaje.crear', 'Cargó un fichaje a mano', 'fichaje'],
  'PATCH /fichajes/:id': ['fichaje.editar', 'Corrigió un fichaje', 'fichaje'],
  'POST /fichajes/:id/cerrar': ['fichaje.cerrar', 'Cerró un fichaje abierto', 'fichaje'],

  'POST /mesas': ['mesa.crear', 'Creó una mesa', 'mesa'],
  'PATCH /mesas/:id': ['mesa.editar', 'Modificó una mesa', 'mesa'],
  'PATCH /mesas/:id/estado': ['mesa.estado', 'Cambió el estado de una mesa', 'mesa'],

  'POST /pedidos': ['pedido.crear', 'Abrió una cuenta', 'pedido'],
  'POST /pedidos/:id/items': ['pedido.agregar', 'Agregó productos a una cuenta', 'pedido'],
  'POST /pedidos/:id/cerrar': ['pedido.cobrar', 'Cobró una cuenta', 'pedido'],
  'POST /pedidos/:id/cancelar': ['pedido.cancelar', 'Canceló una cuenta', 'pedido'],
  'POST /pedidos/:id/mover': ['pedido.mover', 'Pasó una cuenta a otra mesa', 'pedido'],
  'POST /pedidos/:id/mover-items': ['pedido.mover_items', 'Pasó productos a otra cuenta', 'pedido'],
  'PATCH /pedido-items/estado': ['item.estado', 'Cambió el estado de un producto pedido', 'item_pedido'],
  'DELETE /pedido-items/:id': ['item.anular', 'Anuló un producto pedido', 'item_pedido'],

  'POST /caja/cierres': ['caja.cerrar', 'Cerró la caja', 'cierre_caja'],
  'DELETE /caja/cierres/:id': ['caja.reabrir', 'Reabrió una caja cerrada', 'cierre_caja'],

  'POST /respaldos': ['respaldo.crear', 'Creó una copia de seguridad', 'respaldo'],
  'GET /respaldos/:nombre': ['respaldo.descargar', 'Descargó una copia de seguridad', 'respaldo'],
};

export const etiquetaDe = (metodo, patron) => ETIQUETAS[`${metodo} ${patron}`] ?? null;

// Códigos que no salen de una ruta: los registra el sistema por su cuenta.
export const ETIQUETAS_SISTEMA = {
  'respaldo.automatico': 'Copia de seguridad automática',
  'respaldo.externo': 'Copia enviada fuera del servidor',
  'respaldo.restaurar': 'Restauró una copia de seguridad',
  'sistema.acceso_denegado': 'Intento de acceso sin permiso',
  'sistema.error': 'Error del servidor',
};

/** Texto en pantalla de un código de acción. */
export function textoDeAccion(codigo) {
  for (const [, [c, texto]] of Object.entries(ETIQUETAS)) if (c === codigo) return texto;
  return ETIQUETAS_SISTEMA[codigo] ?? codigo;
}

export const ACCIONES = [
  ...Object.values(ETIQUETAS).map(([codigo, texto]) => ({ codigo, texto })),
  ...Object.entries(ETIQUETAS_SISTEMA).map(([codigo, texto]) => ({ codigo, texto })),
];

// Campos que nunca se guardan en la auditoría, a cualquier profundidad.
const SECRETO = /contrase|password|clave|token|secret|hash/i;

/** Copia del objeto sin secretos y con textos largos recortados, lista para guardar como JSON. */
export function limpiar(valor, profundidad = 0) {
  if (valor == null) return valor;
  if (typeof valor === 'string') return valor.length > 200 ? `${valor.slice(0, 200)}…` : valor;
  if (typeof valor !== 'object') return valor;
  if (profundidad > 4) return '…';
  if (Array.isArray(valor)) {
    const cabeza = valor.slice(0, 20).map((x) => limpiar(x, profundidad + 1));
    return valor.length > 20 ? [...cabeza, `… y ${valor.length - 20} más`] : cabeza;
  }
  const salida = {};
  for (const [k, x] of Object.entries(valor)) salida[k] = SECRETO.test(k) ? '(oculto)' : limpiar(x, profundidad + 1);
  return salida;
}

/** JSON limpio y acotado (la columna es TEXT, pero no queremos filas gigantes). */
export function serializarDetalle(detalle, maximo = 3000) {
  if (detalle == null || (typeof detalle === 'object' && Object.keys(detalle).length === 0)) return '';
  const texto = JSON.stringify(limpiar(detalle));
  return texto.length <= maximo ? texto : JSON.stringify({ recortado: true, claves: Object.keys(detalle).slice(0, 20) });
}

/** Campos que cambiaron entre dos fotos: { campo: [antes, después] }. Sin cambios devuelve {}. */
export function diferencias(antes, despues) {
  const salida = {};
  if (!antes || !despues) return salida;
  for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    if (JSON.stringify(antes[k] ?? null) !== JSON.stringify(despues[k] ?? null)) salida[k] = [antes[k] ?? null, despues[k] ?? null];
  }
  return salida;
}
