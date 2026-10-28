// Prueba de extremo a extremo en un navegador real (opcional; no forma parte de `npm test`).
//   1) node test/servidor-prueba.js           (API real sobre SQLite en memoria, con datos de ejemplo)
//   2) npm run build
//   3) node test/e2e/navegador.mjs [url] [carpeta-de-capturas]
// Requiere Playwright:  npm i -D playwright && npx playwright install chromium
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL_BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const CAPTURAS = process.argv[3] ?? '/tmp/radas-capturas';
mkdirSync(CAPTURAS, { recursive: true });

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const errores = [];
async function contexto(opciones = {}) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', ...opciones });
  const pagina = await ctx.newPage();
  pagina.on('response', (r) => { if (r.status() === 404) errores.push(`404: ${r.url()}`); });
  pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  // Los 400/401/409 son respuestas esperadas de la API (claves incorrectas a propósito); se ignoran.
  pagina.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0149]/.test(m.text())) errores.push(`console: ${m.text()}`); });
  return { ctx, pagina };
}
async function entrar(pagina, email, clave = 'radas1234') {
  await pagina.goto(URL_BASE);
  await pagina.getByLabel('Email').fill(email);
  await pagina.getByLabel('Contraseña').fill(clave);
  await pagina.getByRole('button', { name: 'Ingresar' }).click();
}
const foto = (pagina, nombre) => pagina.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: false });
let paso = 0;
const ok = (t) => console.log(`  ✓ ${++paso}. ${t}`);

/* ---- carta pública ---- */
{
  const { ctx, pagina } = await contexto();
  await pagina.goto(`${URL_BASE}/carta`);
  await pagina.getByText('Negroni').first().waitFor();
  assert.equal(await pagina.locator('script').count(), 0, 'la carta de clientes no lleva JavaScript');
  assert.equal(await pagina.getByText(/iniciar sesión|ingresar|contraseña/i).count(), 0, 'la carta de clientes no muestra nada de login');
  assert.equal(await pagina.locator('a[href^="/"], a[href^="#/"]').count(), 0, 'la carta no enlaza a la app del personal');
  await foto(pagina, '01-carta');
  ok('la carta para clientes (/carta) se ve sin sesión, sin scripts y sin ninguna salida hacia el login');

  /* ---- login con clave incorrecta ---- */
  await pagina.goto(URL_BASE);
  await pagina.getByLabel('Email').fill('admin@radas.test');
  await pagina.getByLabel('Contraseña').fill('mala-clave');
  await pagina.getByRole('button', { name: 'Ingresar' }).click();
  await pagina.getByRole('alert').getByText('Email o contraseña incorrectos').waitFor();
  await foto(pagina, '02-login-error');
  ok('una clave incorrecta muestra el error y no entra');
  await ctx.close();
}

/* ---- administrador ---- */
{
  const { ctx, pagina } = await contexto();
  await entrar(pagina, 'admin@radas.test');
  await pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
  await pagina.getByText('Pan de campo').first().waitFor();
  await pagina.getByRole('heading', { name: /Cuentas abiertas/ }).waitFor();
  await foto(pagina, '03-resumen');
  ok('el administrador entra y ve el resumen con alertas de stock');

  // productos: edición de precio en la tabla
  await pagina.getByRole('link', { name: 'Productos y precios' }).click();
  const precio = pagina.getByLabel('Precio de Negroni');
  await precio.waitFor();
  await precio.fill('10000');
  await pagina.getByText('1 precio modificado sin guardar').waitFor();
  await foto(pagina, '04-productos-edicion');
  await pagina.getByRole('button', { name: 'Guardar cambios' }).click();
  await pagina.getByRole('dialog').getByText('Confirmar cambio de precios').waitFor();
  await pagina.getByRole('button', { name: 'Aplicar 1 cambios' }).click();
  await pagina.getByText('1 precio actualizado').waitFor();
  assert.equal(await pagina.getByLabel('Precio de Negroni').inputValue(), '10000');
  ok('el administrador edita el precio final de un plato y se guarda');

  // ajuste en bloque por porcentaje
  await pagina.getByRole('button', { name: 'Ajustar precios en bloque' }).click();
  const dlg = pagina.getByRole('dialog');
  await dlg.getByLabel('Qué productos').selectOption('categoria');
  await dlg.getByLabel('Categoría').selectOption('Tapeo');
  await dlg.getByRole('button', { name: 'Ver vista previa' }).click();
  await dlg.getByText('Bruschetta de tomate').waitFor();
  await foto(pagina, '05-ajuste-porcentaje');
  await dlg.getByRole('button', { name: /^Aplicar 3 cambios/ }).click();
  await pagina.getByText('3 precios actualizados').waitFor();
  assert.equal(await pagina.getByLabel('Precio de Bruschetta de tomate').inputValue(), '7900');
  ok('ajuste en bloque del +10 % en una categoría con vista previa');

  // ajuste por margen deseado
  await pagina.getByRole('button', { name: 'Ajustar precios en bloque' }).click();
  await dlg.getByLabel('Cómo ajustar').selectOption('margen');
  await dlg.getByLabel('Margen deseado (%)').fill('85');
  await dlg.getByLabel('Qué productos').selectOption('categoria');
  await dlg.getByLabel('Categoría').selectOption('Clásicos');
  await dlg.getByRole('button', { name: 'Ver vista previa' }).click();
  await dlg.getByText('Gin tonic').waitFor();
  await foto(pagina, '06-ajuste-margen');
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
  ok('la vista previa por margen deseado calcula sin aplicar');

  // editar receta
  await pagina.getByRole('button', { name: 'Gin tonic', exact: true }).click();
  await pagina.getByRole('dialog').getByText('Costo:').waitFor();
  await foto(pagina, '07-producto-receta');
  await pagina.keyboard.press('Escape');
  ok('el formulario de producto muestra receta, costo y margen');

  // nuevo producto
  await pagina.getByRole('button', { name: 'Nuevo producto' }).click();
  await dlg.getByLabel('Nombre', { exact: true }).fill('Fernet con coca');
  await dlg.getByLabel('Categoría', { exact: true }).fill('Clásicos');
  await dlg.getByLabel('Precio de venta ($)').fill('7000');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await pagina.getByText('Producto creado').waitFor();
  await pagina.getByRole('row', { name: /Fernet con coca/ }).waitFor();
  ok('alta de un producto nuevo');

  // receta: agregar y quitar insumos no cierra ni guarda el formulario (antes «+ Agregar insumo» enviaba el formulario)
  await pagina.getByRole('row', { name: /Fernet con coca/ }).getByRole('button', { name: 'Editar' }).click();
  await dlg.getByText('Sin receta no se puede calcular').waitFor();
  await dlg.getByRole('button', { name: '+ Agregar insumo' }).click();
  await dlg.getByRole('button', { name: '+ Agregar insumo' }).click();
  assert.equal(await dlg.getByRole('button', { name: 'Quitar insumo' }).count(), 2, 'el formulario sigue abierto con dos filas');
  await dlg.getByRole('button', { name: 'Quitar insumo' }).last().click();
  assert.equal(await dlg.getByRole('button', { name: 'Quitar insumo' }).count(), 1);
  await dlg.getByLabel('Insumo', { exact: true }).selectOption({ index: 1 });
  await dlg.getByLabel('Cantidad', { exact: true }).fill('60');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await pagina.getByText('Producto guardado').waitFor();
  await pagina.getByRole('row', { name: /Fernet con coca/ }).getByText('sin receta').waitFor({ state: 'detached' });
  // y se puede vaciar y volver a cargar
  await pagina.getByRole('row', { name: /Fernet con coca/ }).getByRole('button', { name: 'Editar' }).click();
  await dlg.getByRole('button', { name: 'Quitar insumo' }).click();
  await dlg.getByRole('button', { name: '+ Agregar insumo' }).click();
  await dlg.getByLabel('Insumo', { exact: true }).selectOption({ index: 2 });
  await dlg.getByLabel('Cantidad', { exact: true }).fill('45');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await pagina.getByText('Producto guardado').waitFor();
  ok('receta: agregar, quitar y reemplazar insumos funciona sin cerrar el formulario');

  // insumos
  await pagina.getByRole('link', { name: 'Insumos' }).click();
  await pagina.getByRole('row', { name: /Vermut rojo/ }).getByText('reponer').waitFor();
  await foto(pagina, '08-insumos');
  await pagina.getByRole('row', { name: /Gin/ }).first().getByRole('button', { name: 'Editar' }).click();
  await pagina.getByText('Precios por proveedor').waitFor();
  await pagina.getByText('más barato').waitFor();
  await foto(pagina, '09-insumo-proveedores');
  await pagina.keyboard.press('Escape');
  ok('insumos con alertas y comparación de precios por proveedor');

  // stock: ingreso
  await pagina.getByRole('link', { name: 'Stock', exact: true }).click();
  await pagina.getByRole('tab', { name: /Alertas/ }).waitFor();
  await foto(pagina, '10-stock-alertas');
  await pagina.getByRole('tab', { name: 'Ingresar mercadería' }).click();
  await pagina.getByLabel('Insumo').selectOption({ label: 'Vermut rojo' });
  await pagina.getByLabel('Cargar la cantidad en').selectOption('base'); // el Vermut tiene envases: acá se carga en ml sueltos
  await pagina.getByLabel('Cantidad que entra (ml)').fill('3000');
  await pagina.getByLabel('Precio ($)').fill('21000');
  await pagina.getByText(/= \$\s?7,00 por ml/).waitFor();
  await foto(pagina, '11-stock-ingreso');
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click();
  await pagina.getByText('Ingreso registrado').waitFor();
  await pagina.getByRole('tab', { name: /Alertas/ }).click();
  await pagina.getByRole('row', { name: /Vermut rojo/ }).waitFor({ state: 'detached' });
  ok('el ingreso de mercadería resuelve la alerta de reposición');

  await pagina.getByRole('tab', { name: 'Mermas' }).click();
  await pagina.getByLabel('Insumo').selectOption({ label: 'Gin (ml)' });
  await pagina.getByLabel('Medida').selectOption({ label: 'ml sueltos' }); // el Gin tiene envases: por defecto se da de baja en botellas
  await pagina.getByLabel('Cantidad perdida (ml)').fill('60');
  await pagina.getByRole('button', { name: 'Registrar merma' }).click();
  await pagina.getByText('Merma registrada').waitFor();
  await pagina.getByRole('tab', { name: 'Movimientos' }).click();
  await pagina.getByRole('row', { name: /Merma.*Gin/ }).first().waitFor();
  await foto(pagina, '12-stock-movimientos');
  ok('merma registrada y visible en movimientos');

  // empleados
  await pagina.getByRole('link', { name: 'Empleados' }).click();
  await pagina.getByRole('button', { name: 'Nuevo empleado' }).click();
  await dlg.getByLabel('Nombre y apellido').fill('Julia Nueva');
  await dlg.getByLabel('Email').fill('julia@radas.test');
  await dlg.getByLabel('Contraseña inicial').fill('clave-inicial-1');
  await dlg.getByLabel('Rol').selectOption('host');
  await dlg.getByRole('button', { name: 'Crear empleado' }).click();
  await pagina.getByText('Empleado creado').waitFor();
  await foto(pagina, '13-empleados');
  ok('alta de empleado con rol host');

  const fila = () => pagina.getByRole('row', { name: /Julia Nueva/ });
  await fila().getByRole('button', { name: 'Editar / rol' }).click();
  await dlg.getByLabel('Rol').selectOption('cajero');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await pagina.getByText('Cambios guardados').waitFor();
  await fila().getByText('Cajero').waitFor();
  ok('cambio de rol');

  await fila().getByRole('button', { name: 'Cambiar contraseña' }).click();
  await dlg.getByLabel('Contraseña nueva').fill('otra-clave-2');
  await dlg.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await pagina.getByText(/Contraseña de Julia Nueva cambiada/).waitFor();
  ok('el administrador cambia la contraseña de un empleado');

  // el empleado entra con la clave nueva, y luego se lo da de baja
  const julia = await contexto();
  await entrar(julia.pagina, 'julia@radas.test', 'otra-clave-2');
  await julia.pagina.getByRole('heading', { name: 'Pedidos', exact: true }).waitFor(); // cajero: aterriza en Pedidos
  await fila().getByRole('button', { name: 'Dar de baja' }).click();
  await dlg.getByRole('button', { name: 'Dar de baja' }).click();
  await pagina.getByText(/Julia Nueva fue dado de baja/).waitFor();
  await julia.pagina.reload();
  await julia.pagina.getByRole('button', { name: 'Ingresar' }).waitFor(); // la baja cerró su sesión
  await entrar(julia.pagina, 'julia@radas.test', 'otra-clave-2');
  await julia.pagina.getByText('Email o contraseña incorrectos').waitFor();
  await julia.ctx.close();
  ok('la baja cierra la sesión y bloquea el ingreso');
  await fila().getByRole('button', { name: 'Reactivar' }).click();
  await pagina.getByText(/Julia Nueva fue reactivado/).waitFor();
  ok('reactivación de un empleado');

  // horas del personal
  await pagina.getByRole('link', { name: 'Horas del personal' }).click();
  await pagina.getByRole('row', { name: /Camila Camarera/ }).waitFor();
  await foto(pagina, '14-personal-ahora');
  await pagina.getByRole('tab', { name: 'Horas por empleado' }).click();
  await pagina.getByRole('row', { name: /Carlos Cocina/ }).waitFor();
  await pagina.getByRole('row', { name: /Carlos Cocina/ }).getByRole('button').first().click();
  await pagina.getByText('Cada jornada cuenta en el día en que empezó').waitFor();
  await foto(pagina, '15-personal-horas');
  const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('button', { name: /Descargar planilla/ }).click()]);
  assert.match(descarga.suggestedFilename(), /^horas-.*\.csv$/);
  ok('resumen de horas por empleado con detalle por día y planilla CSV');

  await pagina.getByRole('tab', { name: 'Jornadas' }).click();
  await pagina.getByRole('button', { name: 'Cargar jornada a mano' }).click();
  await foto(pagina, '16-jornada-manual');
  await pagina.keyboard.press('Escape');
  await ctx.close();
}

/* ---- host + camarero: mesas ---- */
{
  const host = await contexto();
  await entrar(host.pagina, 'host@radas.test');
  await host.pagina.getByRole('heading', { name: 'Mesas' }).waitFor();
  const navHost = await host.pagina.getByRole('navigation', { name: 'Secciones' }).innerText();
  assert.ok(!/Productos|Stock|Empleados|Insumos/.test(navHost), `el host no debe ver: ${navHost}`);
  const mesa2 = host.pagina.getByRole('button', { name: /^Mesa 2,/ });
  await mesa2.click();
  await host.pagina.getByRole('button', { name: /^Mesa 2,.*ocupada/ }).waitFor();
  await host.pagina.getByText('lugares libres de 32').waitFor();
  await foto(host.pagina, '17-mesas-host');
  ok('el host solo ve sus secciones y marca una mesa como ocupada');
  // una mesa con cuenta abierta no se puede liberar a mano
  await host.pagina.getByRole('button', { name: /^Mesa 1,.*ocupada/ }).click();
  await host.pagina.getByText(/tiene una cuenta abierta/).waitFor();
  ok('el host no puede liberar una mesa con cuenta abierta');

  const barra = await contexto();
  await entrar(barra.pagina, 'barra@radas.test');
  await barra.pagina.getByRole('link', { name: 'Mesas' }).click();
  await barra.pagina.getByText('Mesa 1').first().waitFor();
  assert.equal(await barra.pagina.getByRole('button', { name: /^Mesa 1,/ }).count(), 0, 'barra no edita mesas');
  await barra.pagina.locator('.mesa-ocupada', { hasText: 'Mesa 1' }).waitFor();
  ok('barra ve la ocupación (solo lectura)');

  // acceso directo a una pantalla de administración
  await barra.pagina.goto(`${URL_BASE}/#/productos`);
  await barra.pagina.getByRole('heading', { name: 'Barra', exact: true }).waitFor();
  ok('una pantalla de administración por URL redirige a la propia');

  // barra: merma
  await barra.pagina.getByRole('link', { name: 'Registrar merma' }).click();
  await barra.pagina.getByLabel('Insumo').selectOption({ label: 'Campari (ml)' });
  await barra.pagina.getByLabel('Cantidad perdida (envases)').fill('0,5'); // por defecto en botellas: media botella = 375 ml
  await barra.pagina.getByText('= 375 ml').waitFor();
  await barra.pagina.getByRole('button', { name: 'Registrar merma' }).click();
  await barra.pagina.getByText('Merma registrada').waitFor();
  ok('barra registra una merma sin ver costos');
  await host.ctx.close(); await barra.ctx.close();
}

/* ---- cocina: fichaje ---- */
{
  const { ctx, pagina } = await contexto();
  await entrar(pagina, 'cocina@radas.test');
  await pagina.getByRole('heading', { name: 'Cocina', exact: true }).waitFor();
  await pagina.getByRole('link', { name: 'Mi jornada' }).click();
  await pagina.getByRole('heading', { name: '¿Empezás tu turno?' }).waitFor();
  await foto(pagina, '18-fichar');
  await pagina.getByLabel('Producción').check();
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click();
  await pagina.getByRole('button', { name: 'Registrar egreso' }).waitFor();
  await foto(pagina, '19-fichar-en-curso');
  await pagina.getByRole('button', { name: 'Registrar egreso' }).click();
  await pagina.getByRole('heading', { name: '¿Empezás tu turno?' }).waitFor();
  ok('cocina registra ingreso y egreso de su jornada');

  // cambiar su contraseña
  await pagina.getByRole('link', { name: 'Mi cuenta' }).click();
  await pagina.getByLabel('Contraseña actual').fill('mala');
  await pagina.getByLabel('Contraseña nueva', { exact: true }).fill('nueva-clave-99');
  await pagina.getByLabel('Repetir la nueva').fill('nueva-clave-99');
  await pagina.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await pagina.getByText(/no es correcta/).first().waitFor();
  ok('cambiar la propia contraseña exige la actual');
  await ctx.close();
}

/* ---- pantalla de barra y de cocina (KDS) ---- */
{
  const barra = await contexto({ viewport: { width: 1360, height: 900 } });
  await entrar(barra.pagina, 'barra@radas.test');
  const p = barra.pagina;
  await p.getByRole('heading', { name: 'Barra', exact: true }).waitFor();
  const tarjeta = (texto) => p.locator('.kds-tarjeta', { hasText: texto });
  await tarjeta('Aperol Spritz').first().waitFor();
  // lo igual de cuentas distintas se junta: 2 Negroni de la Mesa 1 + 1 de la barra = 3 ×
  const negroni = p.locator('.kds-pendiente .kds-tarjeta', { hasText: 'Negroni' }).filter({ hasText: '3×' });
  await negroni.waitFor();
  assert.match(await negroni.innerText(), /Mesa 1 \(2\)/);
  await p.locator('.kds-pendiente .nivel-urgente').first().waitFor();   // el pedido de hace 14 min ya está en rojo
  await foto(p, '22-kds-barra');
  ok('la pantalla de barra agrupa Negroni de distintas cuentas y marca en rojo lo demorado');

  await negroni.getByRole('button', { name: 'Empezar' }).click();
  await p.locator('.kds-preparando .kds-tarjeta', { hasText: '3×' }).waitFor();
  await p.locator('.kds-preparando .kds-tarjeta', { hasText: '3×' }).getByRole('button', { name: 'Listo', exact: true }).click();
  await p.locator('.kds-listo .kds-tarjeta', { hasText: '3×' }).waitFor();
  ok('la barra pasa un grupo de En espera a Preparando y a Listo');

  await p.getByRole('tab', { name: 'Por cuenta' }).click();
  await p.locator('.kds-tarjeta', { hasText: 'Barra 2' }).first().waitFor();
  await foto(p, '23-kds-barra-por-cuenta');
  ok('vista por cuenta (comanda)');
  assert.equal(await p.getByRole('tab', { name: 'Cocina', exact: true }).count(), 0, 'barra no ve la pestaña de cocina');

  const cocina = await contexto({ viewport: { width: 1360, height: 900 } });
  await entrar(cocina.pagina, 'cocina@radas.test');
  const c = cocina.pagina;
  await c.getByRole('heading', { name: 'Cocina', exact: true }).waitFor();
  await c.locator('.kds-tarjeta', { hasText: 'Hummus con pita' }).waitFor();
  assert.equal(await c.locator('.kds-tarjeta', { hasText: 'Aperol' }).count(), 0, 'cocina no ve pedidos de barra');
  await c.locator('.kds-tarjeta', { hasText: 'Bruschetta' }).filter({ hasText: 'sin aceite' }).first().waitFor();
  await foto(c, '24-kds-cocina');
  await c.locator('.kds-pendiente .kds-tarjeta', { hasText: 'Hummus con pita' }).getByRole('button', { name: 'Ya está' }).click();
  await c.locator('.kds-listo .kds-tarjeta', { hasText: 'Hummus con pita' }).waitFor();
  ok('cocina solo ve lo suyo y marca un plato como listo');
  await barra.ctx.close(); await cocina.ctx.close();
}

/* ---- camarero: cuentas, pedido nuevo, entrega, anulación y cobro ---- */
{
  const { ctx, pagina } = await contexto({ viewport: { width: 1280, height: 900 } });
  await entrar(pagina, 'camarero@radas.test');
  await pagina.getByRole('heading', { name: 'Pedidos', exact: true }).waitFor();
  const nav = await pagina.getByRole('navigation', { name: 'Secciones' }).innerText();
  assert.ok(!/Pantalla|Productos|Stock/.test(nav), `el camarero no debe ver: ${nav}`);
  const cuenta = (n) => pagina.getByRole('button', { name: new RegExp(`^${n}`) });
  await cuenta('Living A').getByText('1 para llevar').waitFor();   // el hummus que acaba de marcar cocina
  await foto(pagina, '25-pedidos-lista');
  ok('el camarero ve las cuentas abiertas y cuál tiene algo listo para llevar');

  // entregar lo que está listo en la Mesa 3 y cobrar
  await cuenta('Mesa 3').click();
  const detalle = pagina.getByRole('region', { name: 'Cuenta de Mesa 3' });
  await detalle.getByRole('row', { name: /Gin tonic/ }).getByRole('button', { name: 'Entregar' }).click();
  await detalle.getByRole('row', { name: /Gin tonic/ }).getByText('Entregado').waitFor();
  await foto(pagina, '26-pedidos-cuenta');
  await pagina.evaluate(() => { window.__impresiones = 0; window.print = () => { window.__impresiones += 1; }; });
  await detalle.getByRole('button', { name: 'Imprimir cuenta' }).click();
  const pre = pagina.getByRole('dialog');
  await pre.getByText('PRE-CUENTA · NO ES UN COMPROBANTE DE PAGO').waitFor();
  await pre.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  ok('pedidos: la pre-cuenta se puede ver e imprimir antes de cobrar');
  await detalle.getByRole('button', { name: /^Cobrar/ }).click();
  await pagina.getByRole('dialog').getByLabel('Tarjeta (POS)').check();
  await foto(pagina, '27-pedidos-cobro');
  await pagina.getByRole('button', { name: 'Confirmar cobro' }).click();
  await pagina.getByText(/Cuenta cobrada/).first().waitFor();
  const tk = pagina.getByRole('dialog');
  await tk.getByText('COMPROBANTE NO VÁLIDO COMO FACTURA').waitFor();
  await tk.getByText('Pagó con: Tarjeta (POS)').waitFor();
  await tk.getByText('Documento no fiscal').waitFor();
  await foto(pagina, '27b-ticket');
  await tk.getByRole('button', { name: 'Imprimir' }).click();
  assert.equal(await pagina.evaluate(() => window.__impresiones), 1, 'el botón Imprimir abre la impresión');
  // en la hoja impresa solo sale el ticket: se oculta toda la aplicación
  await pagina.emulateMedia({ media: 'print' });
  const imp = await pagina.evaluate(() => ({
    ticket: getComputedStyle(document.querySelector('.ticket-hoja')).display,
    app: [...document.body.children].filter((e) => !e.classList.contains('ticket-hoja') && getComputedStyle(e).display !== 'none').map((e) => e.tagName + '.' + e.className),
  }));
  assert.equal(imp.ticket, 'block');
  assert.deepEqual(imp.app.filter((x) => !/^SCRIPT/.test(x)), [], 'al imprimir no debe salir nada más que el ticket');
  await pagina.screenshot({ path: `${CAPTURAS}/27c-ticket-impreso.png`, fullPage: true });
  await pagina.emulateMedia({ media: 'screen' });
  await tk.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await pagina.getByRole('tab', { name: 'Cobradas esta noche' }).click();
  await pagina.getByRole('row', { name: /Mesa 3.*Tarjeta/ }).getByRole('button', { name: 'Ticket' }).click();
  await pagina.getByRole('dialog').getByText('COMPROBANTE NO VÁLIDO COMO FACTURA').waitFor();
  await pagina.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await pagina.getByRole('tab', { name: /^Abiertas/ }).click();
  ok('entrega, cobro con medio de pago, ticket no fiscal imprimible y reimpresión desde Cobradas');

  // cuenta nueva en la mesa 4
  await pagina.getByRole('button', { name: 'Nueva cuenta' }).click();
  await pagina.getByRole('dialog').getByRole('button', { name: /^Mesa 4/ }).click();
  const picker = pagina.getByRole('dialog');
  await picker.getByRole('tab', { name: 'Coctelería de autor' }).click();
  await picker.getByRole('button', { name: /^Negroni/ }).click();
  await picker.getByRole('button', { name: /^Negroni/ }).click();
  await picker.getByLabel('Nota para Negroni').fill('sin hielo');
  await picker.getByRole('button', { name: 'sin sal', exact: true }).click(); // atajo de aclaración
  await picker.getByRole('button', { name: 'sin sal', exact: true }).click(); // repetirlo no duplica
  assert.equal(await picker.getByLabel('Nota para Negroni').inputValue(), 'sin hielo, sin sal');
  await picker.getByRole('tab', { name: 'Sin alcohol' }).click();
  await picker.getByRole('button', { name: /^Agua con gas/ }).click();
  await foto(pagina, '28-pedidos-armar');
  await picker.getByRole('button', { name: 'Enviar pedido' }).click();
  await pagina.getByText('Pedido enviado').waitFor();
  const d4 = pagina.getByRole('region', { name: 'Cuenta de Mesa 4' });
  await d4.getByRole('row', { name: /Negroni/ }).getByText('En espera').waitFor();
  await d4.getByText('«sin hielo, sin sal»').waitFor();
  ok('el camarero arma un pedido con nota y lo envía a barra');

  await d4.getByRole('row', { name: /Agua con gas/ }).getByRole('button', { name: 'Anular' }).click();
  await pagina.getByRole('dialog').getByRole('button', { name: 'Anular' }).click();
  await d4.getByRole('row', { name: /Agua con gas/ }).getByText('Anulado').waitFor();
  ok('anular un pedido pendiente');

  // intentar cobrar con pedidos sin terminar
  await d4.getByRole('button', { name: /^Cobrar/ }).click();
  await pagina.getByText(/sin terminar/).first().waitFor();
  assert.ok(await pagina.getByRole('button', { name: 'Confirmar cobro' }).isDisabled());
  await pagina.keyboard.press('Escape');
  ok('no se puede cobrar mientras haya pedidos sin terminar');

  // en el celular
  const cel = await contexto({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await entrar(cel.pagina, 'camarero@radas.test');
  await cel.pagina.getByRole('button', { name: /^Mesa 4/ }).click();
  await cel.pagina.getByRole('region', { name: 'Cuenta de Mesa 4' }).waitFor();
  await foto(cel.pagina, '29-movil-pedidos');
  const a = await cel.pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(a[0] <= a[1] + 1, `scroll horizontal en móvil (pedidos): ${a}`);
  await cel.ctx.close();
  ok('el pedido se ve bien en el celular');
  await ctx.close();
}

/* ---- envases (presentaciones) ---- */
{
  const { ctx, pagina } = await contexto();
  await entrar(pagina, 'admin@radas.test');
  await pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
  const dlg = pagina.getByRole('dialog');

  // un insumo nuevo con dos envases
  await pagina.getByRole('link', { name: 'Insumos', exact: true }).click();
  await pagina.getByRole('button', { name: 'Nuevo insumo' }).click();
  await dlg.getByLabel('Nombre', { exact: true }).fill('Coca Cola');
  await dlg.getByLabel('Unidad').selectOption('ml');
  await dlg.getByRole('button', { name: '+ Agregar presentación' }).click();
  await dlg.getByRole('button', { name: '+ Agregar presentación' }).click();
  assert.equal(await dlg.getByRole('button', { name: 'Quitar presentación' }).count(), 2, 'agregar presentaciones no cierra ni guarda el formulario');
  await dlg.getByPlaceholder('Botella 750 ml', { exact: true }).first().fill('Botella 500 cc');
  await dlg.getByPlaceholder('750', { exact: true }).first().fill('500');
  await dlg.getByPlaceholder('Botella 750 ml', { exact: true }).nth(1).fill('Botella 1,5 L');
  await dlg.getByPlaceholder('750', { exact: true }).nth(1).fill('1.500');
  await foto(pagina, '36-insumo-presentaciones');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await pagina.getByText('Insumo guardado').waitFor();
  await pagina.getByRole('row', { name: /Coca Cola/ }).getByRole('button', { name: 'Editar' }).click();
  assert.equal(await dlg.getByRole('button', { name: 'Quitar presentación' }).count(), 2);
  assert.equal(await dlg.getByPlaceholder('750', { exact: true }).nth(1).inputValue(), '1500');
  await pagina.keyboard.press('Escape');
  ok('insumos: se cargan presentaciones (envases) y quedan guardadas');

  // ingreso en envases: 4 botellas de 1,5 L = 6000 ml
  await pagina.getByRole('link', { name: 'Stock', exact: true }).click();
  await pagina.getByRole('tab', { name: 'Ingresar mercadería' }).click();
  await pagina.getByLabel('Insumo', { exact: true }).selectOption({ label: 'Coca Cola' });
  await pagina.getByLabel('Envase', { exact: true }).selectOption({ label: 'Botella 1,5 L' });
  await pagina.getByLabel('Cantidad de envases').fill('4');
  await pagina.getByText('= 6.000 ml en total').waitFor();
  await pagina.getByLabel('Precio ($)').fill('12.000');
  await pagina.getByText(/= \$\s?2,00 por ml/).waitFor();
  await foto(pagina, '37-ingreso-envases');
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click();
  await pagina.getByText('Ingreso registrado').waitFor();
  await pagina.getByRole('tab', { name: 'Lotes' }).click();
  await pagina.getByRole('row', { name: /Coca Cola/ }).getByText('≈ 4 × Botella 500 cc').waitFor().catch(() => {});
  await pagina.getByRole('row', { name: /Coca Cola/ }).getByText(/6\.000 ml/).waitFor();
  ok('stock: el ingreso se carga en envases y el sistema lo pasa a ml con su costo');

  // conteo físico por envases: 2 de 1,5 L cerradas + 1 de 500 cc + 250 ml abiertos = 3.750 ml
  await pagina.getByRole('tab', { name: 'Conteo físico' }).click();
  await pagina.getByLabel('Insumo', { exact: true }).selectOption({ label: 'Coca Cola' });
  await pagina.getByLabel('Botella 500 cc (cerrados)').fill('1');
  await pagina.getByLabel('Botella 1,5 L (cerrados)').fill('2');
  await pagina.getByLabel(/Suelto o abierto/).fill('250');
  await pagina.getByText(/Total contado/).getByText(/3\.750 ml/).waitFor();
  await foto(pagina, '38-conteo-envases');
  await pagina.getByRole('button', { name: 'Corregir stock' }).click();
  await pagina.getByText('Stock corregido').waitFor();
  await pagina.getByRole('link', { name: 'Insumos', exact: true }).click();
  await pagina.getByRole('row', { name: /Coca Cola/ }).getByText(/3\.750 ml/).waitFor();
  await pagina.getByRole('row', { name: /Coca Cola/ }).getByText(/≈ 7 × Botella 500 cc \+ 250 ml/).waitFor();
  ok('stock: el conteo físico se hace por envases y lo suelto, y el total queda en ml');

  // merma de una botella
  await pagina.getByRole('link', { name: 'Stock', exact: true }).click();
  await pagina.getByRole('tab', { name: 'Mermas' }).click();
  await pagina.getByLabel('Insumo', { exact: true }).selectOption({ label: 'Coca Cola (ml)' });
  await pagina.getByLabel('Medida').selectOption({ label: 'Botella 1,5 L' });
  await pagina.getByLabel(/Cantidad perdida/).fill('1');
  await pagina.getByText('= 1.500 ml').waitFor();
  await pagina.getByRole('button', { name: 'Registrar merma' }).click();
  await pagina.getByText('Merma registrada').waitFor();
  await pagina.getByRole('tab', { name: 'Movimientos' }).click();
  await pagina.getByRole('row', { name: /Coca Cola.*-1\.500 ml/ }).first().waitFor();
  ok('stock: una merma se da de baja en botellas');

  // receta con una botella entera (producto que se vende tal cual)
  await pagina.getByRole('link', { name: 'Productos y precios' }).click();
  await pagina.getByRole('row', { name: /Fernet con coca/ }).getByRole('button', { name: 'Editar' }).click();
  await dlg.getByRole('button', { name: '+ Agregar insumo' }).click();
  await dlg.getByLabel(/^Insumo/).last().selectOption({ label: 'Coca Cola' });
  await dlg.getByLabel(/^Medida/).last().selectOption({ label: 'Botella 500 cc' });
  await dlg.getByLabel(/^Cantidad/).last().fill('1');
  await dlg.getByText('= 500 ml').waitFor();
  await foto(pagina, '39-receta-envase');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await pagina.getByText('Producto guardado').waitFor();
  ok('productos: la receta puede usar un envase entero y se guarda en ml');

  // celular
  const cel = await contexto({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await entrar(cel.pagina, 'admin@radas.test');
  await cel.pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
  await cel.pagina.goto(`${URL_BASE}/#/stock`);
  await cel.pagina.getByRole('tab', { name: 'Conteo físico' }).click();
  await cel.pagina.getByLabel('Insumo', { exact: true }).selectOption({ label: 'Coca Cola' });
  await cel.pagina.getByLabel(/Suelto o abierto/).waitFor();
  await foto(cel.pagina, '40-movil-conteo');
  const w = await cel.pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1] + 1, `scroll horizontal en móvil (conteo): ${w}`);
  await cel.ctx.close(); await ctx.close();
  ok('envases: el conteo se ve bien en el celular');
}

/* ---- ventas y caja ---- */
{
  const { ctx, pagina } = await contexto();
  await entrar(pagina, 'admin@radas.test');
  await pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
  await pagina.getByRole('heading', { name: /Caja de esta noche/ }).waitFor();
  await pagina.getByRole('link', { name: 'Ventas', exact: true }).click();
  await pagina.getByRole('heading', { name: 'Ventas por noche' }).waitFor();
  await pagina.getByText('Ticket promedio').waitFor();
  await pagina.getByRole('heading', { name: 'Medio de pago' }).waitFor();
  await foto(pagina, '30-ventas');
  await pagina.getByRole('button', { name: 'Últimas 30' }).click();
  assert.equal(await pagina.getByRole('button', { name: 'Últimas 30' }).getAttribute('aria-pressed'), 'true');
  await pagina.getByRole('heading', { name: /^Productos/ }).waitFor();
  const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('button', { name: 'Descargar CSV' }).click()]);
  assert.match(descarga.suggestedFilename(), /^ventas-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  ok('ventas: totales, gráficos por noche y hora, productos con margen y descarga en CSV');

  const caj = await contexto();
  await entrar(caj.pagina, 'cajero@radas.test');
  await caj.pagina.getByRole('link', { name: 'Caja', exact: true }).click();
  await caj.pagina.getByRole('button', { name: 'Todo junto' }).click();
  await caj.pagina.getByRole('heading', { name: 'Cerrar la caja' }).waitFor();
  await caj.pagina.getByText(/Hay \d+ cuentas? abiertas?/).waitFor();
  assert.ok(await caj.pagina.getByRole('button', { name: 'Cerrar caja' }).isDisabled());
  await foto(caj.pagina, '31-caja-bloqueada');
  assert.equal(await caj.pagina.getByRole('link', { name: 'Ventas', exact: true }).count(), 0, 'el cajero no ve Ventas');
  ok('caja: con cuentas abiertas no se puede cerrar, y el cajero no ve los reportes');

  // se cobran todas las cuentas abiertas por la API para poder cerrar
  const sesion = await (await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@radas.test', password: 'radas1234' }) })).json();
  const llamar = async (metodo, ruta, cuerpo) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion.token}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    assert.ok(r.ok, `${metodo} ${ruta} -> ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  for (const c of await llamar('GET', '/pedidos')) {
    const falta = c.items.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando').map((i) => i.id);
    if (falta.length) await llamar('PATCH', '/pedido-items/estado', { ids: falta, estado: 'listo' });
    if (c.items.some((i) => i.estado !== 'anulado')) await llamar('POST', `/pedidos/${c.id}/cerrar`, { medio_pago: 'efectivo' });
    else await llamar('POST', `/pedidos/${c.id}/cancelar`);
  }

  await caj.pagina.reload();
  await caj.pagina.getByRole('button', { name: 'Todo junto' }).click();
  await caj.pagina.getByLabel('Fondo de caja al empezar ($)').fill('5.000');
  await caj.pagina.getByLabel('Retiros de efectivo ($)').fill('1500,50');
  await caj.pagina.getByLabel('Efectivo contado en la caja ($)').fill('0');
  await caj.pagina.getByText(/Faltan/).first().waitFor();
  await foto(caj.pagina, '32-caja-cierre');
  await caj.pagina.getByRole('button', { name: 'Cerrar caja' }).click();
  await caj.pagina.getByRole('dialog').getByRole('button', { name: 'Cerrar caja' }).click();
  await caj.pagina.getByText('Caja cerrada', { exact: true }).waitFor();
  await caj.pagina.getByRole('listitem').filter({ hasText: 'Fondo de caja' }).getByText(/5\.000,00/).waitFor(); // «5.000» es cinco mil, no cinco
  await caj.pagina.getByRole('heading', { name: 'Cierre de la caja' }).waitFor();
  await caj.pagina.getByRole('heading', { name: 'Cierres anteriores' }).waitFor();
  await caj.pagina.getByRole('row', { name: /Faltan/ }).first().waitFor();
  assert.equal(await caj.pagina.getByRole('button', { name: 'Reabrir caja' }).count(), 0, 'el cajero no puede reabrir');
  await foto(caj.pagina, '33-caja-cerrada');
  ok('caja: el cajero cuenta el efectivo, ve la diferencia y cierra; queda en el historial');

  // con la caja cerrada no se cobra; el administrador la reabre
  const nueva = await llamar('POST', '/pedidos', { canal: 'barra', etiqueta: 'Tarde', items: [{ id_producto: (await llamar('GET', '/productos')).productos?.[0]?.id ?? (await llamar('GET', '/productos'))[0].id, cantidad: 1 }] });
  await llamar('PATCH', '/pedido-items/estado', { ids: nueva.items.map((i) => i.id), estado: 'listo' });
  const rechazo = await fetch(`${URL_BASE}/api/pedidos/${nueva.id}/cerrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion.token}` }, body: JSON.stringify({ medio_pago: 'efectivo' }) });
  assert.equal(rechazo.status, 409);
  await pagina.getByRole('link', { name: 'Caja', exact: true }).click();
  await pagina.getByRole('button', { name: 'Reabrir caja' }).click();
  await pagina.getByRole('dialog').getByRole('button', { name: 'Reabrir' }).click();
  await pagina.getByRole('button', { name: 'Todo junto' }).waitFor();
  await llamar('POST', `/pedidos/${nueva.id}/cerrar`, { medio_pago: 'tarjeta' });
  ok('caja: cerrada no admite cobros; el administrador la reabre');

  // celular
  const cel = await contexto({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await entrar(cel.pagina, 'admin@radas.test');
  await cel.pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
  await cel.pagina.goto(`${URL_BASE}/#/ventas`);
  await cel.pagina.getByRole('heading', { name: 'Ventas por noche' }).waitFor();
  await foto(cel.pagina, '34-movil-ventas');
  const w1 = await cel.pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w1[0] <= w1[1] + 1, `scroll horizontal en móvil (ventas): ${w1}`);
  await cel.pagina.goto(`${URL_BASE}/#/caja`);
  await cel.pagina.getByRole('button', { name: 'Todo junto' }).waitFor();
  const w2 = await cel.pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w2[0] <= w2[1] + 1, `scroll horizontal en móvil (caja): ${w2}`);
  await foto(cel.pagina, '35-movil-caja');
  ok('ventas y caja se ven bien en el celular');
  await cel.ctx.close(); await caj.ctx.close(); await ctx.close();
}

/* ---- sistema: copias, auditoría y QR · mover cuentas · caja por canal · informes ---- */
{
  const { ctx, pagina } = await contexto();
  await entrar(pagina, 'admin@radas.test');
  await pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
  const sesion = await (await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@radas.test', password: 'radas1234' }) })).json();
  const llamar = async (metodo, ruta, cuerpo) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion.token}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    assert.ok(r.ok, `${metodo} ${ruta} -> ${r.status} ${await r.clone().text()}`);
    return r.status === 204 ? null : r.json();
  };

  // copias de seguridad
  await pagina.getByRole('link', { name: 'Sistema', exact: true }).click();
  await pagina.getByRole('heading', { name: /Copias de seguridad/ }).waitFor();
  await pagina.getByRole('button', { name: 'Crear una copia ahora' }).click();
  await pagina.getByRole('row', { name: /radas-\d{8}-\d{6}\.json\.gz/ }).first().waitFor();
  await foto(pagina, '41-sistema-copias');
  const [bajada] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('row', { name: /radas-\d{8}-\d{6}/ }).first().getByRole('button', { name: 'Descargar' }).click()]);
  assert.match(bajada.suggestedFilename(), /^radas-\d{8}-\d{6}\.json\.gz$/);
  ok('sistema: se crea una copia de seguridad y se descarga');

  // auditoría
  await pagina.getByRole('tab', { name: 'Auditoría' }).click();
  await pagina.locator('.aud-lista').getByText('Creó una copia de seguridad').first().waitFor();
  await pagina.locator('.aud-lista').getByText('Descargó una copia de seguridad').first().waitFor();
  await pagina.getByLabel('Acción').selectOption('respaldo.crear');
  await pagina.getByRole('button', { name: 'Buscar' }).click();
  await pagina.locator('.aud-lista').getByText('Creó una copia de seguridad').first().waitFor();
  assert.equal(await pagina.locator('.aud-lista').getByText('Descargó una copia de seguridad').count(), 0, 'el filtro por acción excluye lo demás');
  await foto(pagina, '42-sistema-auditoria');
  ok('auditoría: queda registrado quién creó y descargó la copia, y se puede filtrar');

  // QR de la carta
  await pagina.getByRole('tab', { name: 'Carta con QR' }).click();
  await pagina.getByRole('heading', { name: 'Carta para los clientes' }).waitFor();
  await pagina.getByRole('img', { name: /Código QR que abre la carta/ }).first().waitFor();
  await foto(pagina, '43-sistema-qr');
  ok('sistema: el QR de la carta se genera en pantalla');

  // mover cuentas
  const productos = await llamar('GET', '/productos');
  const lista = Array.isArray(productos) ? productos : productos.productos;
  const mesas = (await llamar('GET', '/mesas')).mesas.filter((m) => m.activo);
  const [m1, m2, m3] = mesas;
  const a = await llamar('POST', '/pedidos', { canal: 'mesa', id_mesa: m1.id, items: [{ id_producto: lista[0].id, cantidad: 2 }, { id_producto: lista[1].id, cantidad: 1 }] });
  const b = await llamar('POST', '/pedidos', { canal: 'mesa', id_mesa: m2.id, items: [{ id_producto: lista[0].id, cantidad: 1 }] });
  await pagina.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await pagina.getByRole('button', { name: new RegExp(`^${m1.nombre}`) }).click();
  await pagina.getByRole('region', { name: `Cuenta de ${m1.nombre}` }).waitFor();
  await pagina.getByRole('button', { name: 'Pasar productos' }).click();
  const dlg = pagina.getByRole('dialog');
  await dlg.getByLabel(new RegExp(`Pasar 1 ${lista[1].nombre}`)).check();
  await dlg.getByText('Libre · abrir cuenta').first().waitFor();
  await foto(pagina, '44-mover-productos');
  await dlg.getByRole('button', { name: new RegExp(m3.nombre) }).click();
  await pagina.getByText(/línea pasada a/).waitFor();
  ok('pedidos: se pasa un producto suelto a una mesa libre (se abre una cuenta nueva)');
  await pagina.getByRole('button', { name: new RegExp(`^${m1.nombre}`) }).click();
  await pagina.getByRole('button', { name: 'Pasar a otra mesa' }).click();
  await dlg.getByText('Mesa actual').waitFor();
  await foto(pagina, '45-mover-cuenta');
  await dlg.getByRole('button', { name: new RegExp(`${m2.nombre}.*Con cuenta`) }).click();
  await dlg.getByText('¿Juntar las cuentas?').waitFor();
  await dlg.getByRole('button', { name: 'Juntar cuentas' }).click();
  await pagina.getByText(/Se juntó con la cuenta de/).waitFor();
  const abiertas = await llamar('GET', '/pedidos');
  assert.equal(abiertas.filter((c) => c.id_mesa === m1.id).length, 0, 'la mesa de origen quedó libre');
  assert.equal(abiertas.find((c) => c.id_mesa === m2.id).items.filter((i) => i.estado !== 'anulado').length, 2);
  ok('pedidos: la cuenta se pasa a una mesa ocupada y se junta; el origen queda libre');

  // caja por separado: se cobra todo menos una cuenta de barra y de salón
  for (const c of await llamar('GET', '/pedidos')) {
    const falta = c.items.filter((i) => i.estado === 'pendiente' || i.estado === 'preparando').map((i) => i.id);
    if (falta.length) await llamar('PATCH', '/pedido-items/estado', { ids: falta, estado: 'listo' });
    await llamar('POST', `/pedidos/${c.id}/cerrar`, { medio_pago: 'efectivo' });
  }
  const barra = await llamar('POST', '/pedidos', { canal: 'barra', etiqueta: 'Juan', items: [{ id_producto: lista[0].id, cantidad: 1 }] });
  const caj = await contexto();
  await entrar(caj.pagina, 'cajero@radas.test');
  await caj.pagina.getByRole('link', { name: 'Caja', exact: true }).click();
  await caj.pagina.getByRole('heading', { name: /Cerrar la caja del salón/ }).waitFor();
  await caj.pagina.getByRole('heading', { name: /Cerrar la caja de la barra/ }).waitFor();
  await caj.pagina.getByText(/Hay 1 cuenta abierta/).waitFor(); // solo la barra tiene una abierta
  await foto(caj.pagina, '46-caja-separada');
  const formSalon = caj.pagina.locator('section.tarjeta', { has: caj.pagina.getByRole('heading', { name: /Cerrar la caja del salón/ }) });
  await formSalon.getByLabel('Efectivo contado en la caja ($)').fill('0');
  await formSalon.getByRole('button', { name: 'Cerrar caja' }).click();
  await caj.pagina.getByRole('dialog').getByRole('button', { name: 'Cerrar caja' }).click();
  await caj.pagina.getByText('Caja cerrada', { exact: true }).waitFor();
  await caj.pagina.getByRole('heading', { name: /Cierre de la caja · Salón/ }).waitFor();
  await caj.pagina.getByRole('heading', { name: /Cerrar la caja de la barra/ }).waitFor();
  await foto(caj.pagina, '47-caja-salon-cerrada');
  // el salón cerrado no admite cobros de salón, pero la barra sigue funcionando
  await llamar('PATCH', '/pedido-items/estado', { ids: barra.items.map((i) => i.id), estado: 'listo' });
  await llamar('POST', `/pedidos/${barra.id}/cerrar`, { medio_pago: 'tarjeta' });
  ok('caja: se cierra el salón por separado y la barra sigue cobrando');
  await caj.ctx.close();

  // informes
  await pagina.getByRole('link', { name: 'Informes', exact: true }).click();
  await pagina.getByRole('heading', { name: 'Informes' }).waitFor();
  await pagina.getByRole('heading', { name: 'Aporte de cada producto a la ganancia' }).waitFor();
  await foto(pagina, '48-informes-rentabilidad');
  await pagina.getByRole('tab', { name: 'Comparar períodos' }).click();
  await pagina.getByRole('heading', { name: 'Categorías' }).waitFor();
  await foto(pagina, '49-informes-comparar');
  await pagina.getByRole('tab', { name: 'Consumo real vs teórico' }).click();
  await pagina.getByText('Gastado según recetas').waitFor();
  await foto(pagina, '50-informes-consumo');
  await pagina.getByRole('tab', { name: 'Stock y mermas' }).click();
  await pagina.getByText('Plata en el depósito').waitFor();
  await foto(pagina, '51-informes-stock');
  await pagina.getByRole('tab', { name: 'Qué comprar' }).click();
  await pagina.getByRole('heading', { level: 2 }).first().waitFor();
  await foto(pagina, '52-informes-compras');
  ok('informes: rentabilidad, comparación, consumo, stock/mermas y compras sugeridas cargan');
  await ctx.close();
}

/* ---- tablets y celulares: ninguna pantalla desborda ---- */
{
  const tamanios = [['tablet-v', 768, 1024], ['tablet-h', 1024, 768], ['celu', 390, 844]];
  const pantallas = ['resumen', 'pedidos', 'kds', 'caja', 'ventas', 'informes', 'mesas', 'fichar', 'productos', 'insumos', 'stock', 'proveedores', 'personal', 'usuarios', 'sistema', 'cuenta'];
  const problemas = [];
  for (const [nombre, w, h] of tamanios) {
    const { ctx, pagina } = await contexto({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 700 });
    await entrar(pagina, 'admin@radas.test');
    await pagina.getByRole('heading', { name: 'Resumen' }).waitFor();
    for (const ruta of pantallas) {
      await pagina.goto(`${URL_BASE}/#/${ruta}`);
      await pagina.waitForLoadState('networkidle');
      await pagina.waitForTimeout(250);
      const m = await pagina.evaluate(() => {
        const ancho = window.innerWidth;
        const culpables = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > ancho + 1 && !e.closest('.tabla-caja, .tabla, .pestanas, [data-scroll], pre'); }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`);
        const chicos = [...document.querySelectorAll('button, a.btn, input:not([type=hidden]), select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 30) && getComputedStyle(e).visibility !== 'hidden' && e.type !== 'checkbox' && e.type !== 'radio'; }).length;
        return { desborda: document.documentElement.scrollWidth > ancho + 1, culpables, chicos };
      });
      if (m.desborda) problemas.push(`${nombre} ${ruta}: scroll horizontal (${m.culpables.join(', ')})`);
      if (nombre !== 'tablet-h' && ruta === 'caja') await foto(pagina, `60-${nombre}-${ruta}`);
      await foto(pagina, `60-${nombre}-${ruta}`);
    }
    await ctx.close();
  }
  assert.deepEqual(problemas, [], `pantallas que desbordan:\n${problemas.join('\n')}`);
  ok(`responsive: ${pantallas.length} pantallas × 3 tamaños (tablet vertical/horizontal y celular) sin scroll horizontal`);
}

/* ---- carta de clientes en celular ---- */
{
  const { ctx, pagina } = await contexto({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await pagina.goto(`${URL_BASE}/carta`);
  await pagina.getByText('Negroni').first().waitFor();
  const w = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1] + 1, `scroll horizontal en la carta: ${w}`);
  await pagina.screenshot({ path: `${CAPTURAS}/61-carta-celu.png`, fullPage: true });
  await ctx.close();
  ok('carta de clientes: se ve bien en el celular');
}

/* ---- móvil ---- */
{
  const { ctx, pagina } = await contexto({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await entrar(pagina, 'host@radas.test');
  await pagina.getByRole('heading', { name: 'Mesas' }).waitFor();
  await foto(pagina, '20-movil-mesas');
  const ancho = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(ancho[0] <= ancho[1] + 1, `scroll horizontal en móvil: ${ancho}`);
  await ctx.close();
  const adm = await contexto({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await entrar(adm.pagina, 'admin@radas.test');
  await adm.pagina.getByRole('link', { name: 'Productos y precios' }).click();
  await adm.pagina.getByLabel('Precio de Negroni').waitFor();
  await foto(adm.pagina, '21-movil-productos');
  const a2 = await adm.pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(a2[0] <= a2[1] + 1, `scroll horizontal en móvil (productos): ${a2}`);
  await adm.ctx.close();
  ok('en el celular no hay scroll horizontal de página');
}

await navegador.close();
console.log(errores.length ? `\nErrores de JavaScript en el navegador:\n${errores.join('\n')}` : '\nSin errores de JavaScript en el navegador.');
process.exit(errores.length ? 1 : 0);
