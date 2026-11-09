import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { ROLES, SALON, SALON_EDITA, MERMAS, TODOS } from '../src/roles.js';
import { AHORA, CLAVE, api, conSesion, crearUsuario, esperar, iniciarBase } from './ayuda.js';

before(iniciarBase);

test('login: devuelve token y usuario sin datos sensibles; /auth/me funciona', async () => {
  await crearUsuario('camarero', 'Cami', 'cami@test.local');
  const r = esperar(await api('POST', '/auth/login', { body: { email: ' CAMI@test.local ', password: CLAVE } }), 200);
  assert.ok(r.token.length > 30);
  assert.deepEqual(Object.keys(r.usuario).sort(), ['email', 'id', 'nombre', 'rol']);
  const me = esperar(await api('GET', '/auth/me', { token: r.token }), 200);
  assert.equal(me.usuario.rol, 'camarero');
});

test('login: mismo error para email inexistente y clave incorrecta', async () => {
  const a = await api('POST', '/auth/login', { body: { email: 'cami@test.local', password: 'incorrecta' }, ip: '10.1.1.1' });
  const b = await api('POST', '/auth/login', { body: { email: 'nadie@test.local', password: 'incorrecta' }, ip: '10.1.1.2' });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('login: se bloquea tras 5 intentos fallidos, aun con la clave correcta', async () => {
  await crearUsuario('cajero', 'Cecilia', 'ceci@test.local');
  for (let i = 0; i < 5; i += 1) await api('POST', '/auth/login', { body: { email: 'ceci@test.local', password: 'mala' }, ip: '10.9.9.9' });
  const r = await api('POST', '/auth/login', { body: { email: 'ceci@test.local', password: CLAVE }, ip: '10.9.9.9' });
  assert.equal(r.status, 429);
  // otra IP no está bloqueada
  assert.equal((await api('POST', '/auth/login', { body: { email: 'ceci@test.local', password: CLAVE }, ip: '10.9.9.10' })).status, 200);
});

test('sin token o con token falso: 401', async () => {
  assert.equal((await api('GET', '/auth/me')).status, 401);
  assert.equal((await api('GET', '/productos', { token: 'inventado' })).status, 401);
});

test('logout invalida el token; una sesión vencida deja de valer', async () => {
  const { token } = esperar(await api('POST', '/auth/login', { body: { email: 'cami@test.local', password: CLAVE }, ip: '10.2.0.1' }), 200);
  esperar(await api('POST', '/auth/logout', { token }), 204);
  assert.equal((await api('GET', '/auth/me', { token })).status, 401);

  const { token: t2 } = esperar(await api('POST', '/auth/login', { body: { email: 'cami@test.local', password: CLAVE }, ip: '10.2.0.2' }), 200);
  const muyDespues = new Date(Date.now() + 30 * 3600_000); // más que SESION_HORAS (14)
  assert.equal((await api('GET', '/auth/me', { token: t2, ahora: muyDespues })).status, 401);
});

test('cambiar contraseña: valida la actual, exige 8 caracteres y cierra las otras sesiones', async () => {
  await crearUsuario('barra', 'Bruno', 'bruno@test.local');
  const login = async (ip, password = CLAVE) => (await api('POST', '/auth/login', { body: { email: 'bruno@test.local', password }, ip })).body;
  const s1 = await login('10.3.0.1');
  const s2 = await login('10.3.0.2');
  assert.equal((await api('POST', '/auth/cambiar-contrasena', { token: s1.token, body: { actual: 'mala', nueva: 'nueva-clave-1' } })).status, 400);
  assert.equal((await api('POST', '/auth/cambiar-contrasena', { token: s1.token, body: { actual: CLAVE, nueva: 'corta' } })).status, 400);
  esperar(await api('POST', '/auth/cambiar-contrasena', { token: s1.token, body: { actual: CLAVE, nueva: 'nueva-clave-1' } }), 204);
  assert.equal((await api('GET', '/auth/me', { token: s1.token })).status, 200); // la sesión actual sigue
  assert.equal((await api('GET', '/auth/me', { token: s2.token })).status, 401); // las otras se cerraron
  assert.equal((await api('POST', '/auth/login', { body: { email: 'bruno@test.local', password: CLAVE }, ip: '10.3.0.3' })).status, 401);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'bruno@test.local', password: 'nueva-clave-1' }, ip: '10.3.0.4' })).status, 200);
});

test('usuarios: el administrador da de alta cualquiera de los 6 roles', async () => {
  const { token } = await conSesion('administrador');
  for (const rol of TODOS) {
    const u = esperar(await api('POST', '/usuarios', { token, body: { nombre: `Nuevo ${rol}`, email: `nuevo-${rol}@test.local`, password: 'clave-larga-1', rol } }), 201);
    assert.equal(u.rol, rol);
    assert.equal(u.contrasena, undefined);
  }
  const lista = esperar(await api('GET', '/usuarios', { token }), 200);
  assert.ok(lista.every((u) => u.contrasena === undefined));
});

test('usuarios: validaciones y email duplicado', async () => {
  const { token } = await conSesion('administrador');
  const mal = await api('POST', '/usuarios', { token, body: { nombre: '', email: 'no-es-email', password: 'corta', rol: 'dueño' } });
  assert.equal(mal.status, 400);
  assert.deepEqual(mal.body.detalles.map((d) => d.campo).sort(), ['email', 'nombre', 'password', 'rol']);
  const dup = await api('POST', '/usuarios', { token, body: { nombre: 'X', email: 'NUEVO-host@test.local', password: 'clave-larga-1', rol: 'host' } });
  assert.equal(dup.status, 409);
});

test('usuarios: cambiar rol, resetear clave y dar de baja con efecto inmediato', async () => {
  const { token } = await conSesion('administrador');
  const u = esperar(await api('POST', '/usuarios', { token, body: { nombre: 'Rotativo', email: 'rot@test.local', password: 'clave-larga-1', rol: 'camarero' } }), 201);
  const { token: tu } = esperar(await api('POST', '/auth/login', { body: { email: 'rot@test.local', password: 'clave-larga-1' }, ip: '10.4.0.1' }), 200);

  // cambio de rol: rige ya mismo
  assert.equal((await api('GET', '/usuarios', { token: tu })).status, 403);
  esperar(await api('PATCH', `/usuarios/${u.id}`, { token, body: { rol: 'administrador' } }), 200);
  assert.equal((await api('GET', '/usuarios', { token: tu })).status, 200);
  esperar(await api('PATCH', `/usuarios/${u.id}`, { token, body: { rol: 'cocina' } }), 200);
  assert.equal((await api('GET', '/usuarios', { token: tu })).status, 403);

  // reset de contraseña: cierra las sesiones y la clave vieja deja de servir
  esperar(await api('PATCH', `/usuarios/${u.id}`, { token, body: { password: 'otra-clave-99' } }), 200);
  assert.equal((await api('GET', '/auth/me', { token: tu })).status, 401);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'rot@test.local', password: 'clave-larga-1' }, ip: '10.4.0.2' })).status, 401);
  const { token: t2 } = esperar(await api('POST', '/auth/login', { body: { email: 'rot@test.local', password: 'otra-clave-99' }, ip: '10.4.0.3' }), 200);

  // baja: la sesión abierta cae y no puede volver a entrar; el alta lo reactiva
  esperar(await api('PATCH', `/usuarios/${u.id}`, { token, body: { activo: false } }), 200);
  assert.equal((await api('GET', '/auth/me', { token: t2 })).status, 401);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'rot@test.local', password: 'otra-clave-99' }, ip: '10.4.0.4' })).status, 401);
  esperar(await api('PATCH', `/usuarios/${u.id}`, { token, body: { activo: true } }), 200);
  assert.equal((await api('POST', '/auth/login', { body: { email: 'rot@test.local', password: 'otra-clave-99' }, ip: '10.4.0.5' })).status, 200);

  assert.equal((await api('PATCH', `/usuarios/${u.id}`, { token, body: {} })).status, 400);
  assert.equal((await api('PATCH', '/usuarios/99999', { token, body: { nombre: 'X' } })).status, 404);
});

test('usuarios: el administrador no puede bajarse ni quitarse el rol a sí mismo', async () => {
  const { token, usuario } = await conSesion('administrador');
  assert.equal((await api('PATCH', `/usuarios/${usuario.id}`, { token, body: { activo: false } })).status, 400);
  assert.equal((await api('PATCH', `/usuarios/${usuario.id}`, { token, body: { rol: 'cajero' } })).status, 400);
  esperar(await api('PATCH', `/usuarios/${usuario.id}`, { token, body: { nombre: 'Dueña' } }), 200); // otros cambios sí
});

// Qué roles pueden entrar a cada ruta. Se prueba por la respuesta: 403 = sin permiso; cualquier otra cosa = pasó el control.
const MATRIZ = [
  ['GET', '/usuarios', [ROLES.ADMIN]],
  ['POST', '/usuarios', [ROLES.ADMIN]],
  ['GET', '/productos', TODOS],
  ['GET', '/productos/1', [ROLES.ADMIN]],
  ['POST', '/productos', [ROLES.ADMIN]],
  ['PUT', '/productos/precios', [ROLES.ADMIN]],
  ['POST', '/productos/ajuste-precios', [ROLES.ADMIN]],
  ['GET', '/insumos', MERMAS],
  ['POST', '/insumos', [ROLES.ADMIN]],
  ['GET', '/proveedores', [ROLES.ADMIN]],
  ['POST', '/stock/ingresos', [ROLES.ADMIN]],
  ['POST', '/stock/ajustes', [ROLES.ADMIN]],
  ['POST', '/stock/mermas', MERMAS],
  ['GET', '/stock/alertas', [ROLES.ADMIN]],
  ['GET', '/stock/movimientos', [ROLES.ADMIN]],
  ['GET', '/mesas', SALON],
  ['PATCH', '/mesas/1/estado', SALON_EDITA],
  ['POST', '/mesas', [ROLES.ADMIN]],
  ['POST', '/fichajes/ingreso', TODOS],
  ['GET', '/fichajes/mio', TODOS],
  ['GET', '/fichajes', [ROLES.ADMIN]],
  ['GET', '/fichajes/resumen', [ROLES.ADMIN]],
  ['GET', '/fichajes/presentes', [ROLES.ADMIN]],
  ['POST', '/fichajes', [ROLES.ADMIN]],
];

test('permisos: matriz de rutas por rol (admin, cajero, barra, camarero, host, cocina)', async () => {
  const fallas = [];
  for (const rol of TODOS) {
    const { token } = await conSesion(rol);
    for (const [metodo, ruta, permitidos] of MATRIZ) {
      const r = await api(metodo, ruta, { token, body: {} });
      const prohibido = r.status === 403;
      if (permitidos.includes(rol) === prohibido) fallas.push(`${rol} ${metodo} ${ruta} -> ${r.status}`);
    }
  }
  assert.deepEqual(fallas, []);
});

test('la carta es pública y el resto exige sesión', async () => {
  assert.equal((await api('GET', '/carta')).status, 200);
  for (const ruta of ['/usuarios', '/productos', '/insumos', '/mesas', '/fichajes/mio', '/stock/alertas']) {
    assert.equal((await api('GET', ruta)).status, 401, ruta);
  }
  assert.equal((await api('GET', '/no-existe')).status, 404);
  assert.equal((await api('DELETE', '/carta')).status, 405);
});
