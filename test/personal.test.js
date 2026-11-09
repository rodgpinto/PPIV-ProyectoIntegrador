import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { api, conSesion, crearUsuario, esperar, iniciarBase } from './ayuda.js';

// Buenos Aires = UTC-3. Un turno de noche: 19:00 a 02:30 locales = 22:00Z a 05:30Z del día siguiente.
const T0 = new Date('2026-10-14T22:00:00Z');
const masHoras = (fecha, h) => new Date(fecha.getTime() + h * 3600_000);
let admin;
let camarero;
let cocina;
let host;

before(async () => {
  await iniciarBase();
  admin = await conSesion('administrador');
  camarero = await conSesion('camarero');
  cocina = await conSesion('cocina');
  host = await conSesion('host');
});

const ingreso = (s, turno, ahora) => api('POST', '/fichajes/ingreso', { token: s.token, body: { turno }, ahora });
const egreso = (s, ahora) => api('POST', '/fichajes/egreso', { token: s.token, ahora });
const mio = (s, ahora, query) => api('GET', '/fichajes/mio', { token: s.token, ahora, query });

test('un empleado ficha su ingreso y egreso; las horas trabajadas se calculan solas', async () => {
  esperar(await ingreso(camarero, 'servicio', T0), 201);
  const estado = esperar(await mio(camarero, masHoras(T0, 2)), 200);
  assert.equal(estado.abierto.minutos, 120); // jornada en curso
  assert.equal(estado.abierto.abierto, true);

  const fin = masHoras(T0, 7.5); // 02:30
  const r = esperar(await egreso(camarero, fin), 200);
  assert.equal(r.minutos, 450);
  const despues = esperar(await mio(camarero, fin), 200);
  assert.equal(despues.abierto, null);
  assert.equal(despues.minutos_total, 450);
  assert.equal(despues.historial.length, 1);
});

test('no se puede fichar dos ingresos seguidos ni un egreso sin ingreso', async () => {
  esperar(await ingreso(host, 'servicio', T0), 201);
  assert.equal((await ingreso(host, 'servicio', masHoras(T0, 1))).status, 409);
  assert.equal((await ingreso(host, 'produccion', masHoras(T0, 1))).status, 409);
  esperar(await egreso(host, masHoras(T0, 6)), 200);
  assert.equal((await egreso(host, masHoras(T0, 7))).status, 409);
  assert.equal((await ingreso(host, 'turno-inventado', masHoras(T0, 8))).status, 400);
});

test('la cocina tiene dos turnos: producción de día y servicio de noche', async () => {
  const produccion = new Date('2026-10-14T15:00:00Z'); // 12:00 locales
  esperar(await ingreso(cocina, 'produccion', produccion), 201);
  esperar(await egreso(cocina, masHoras(produccion, 6)), 200); // 18:00
  esperar(await ingreso(cocina, 'servicio', T0), 201);
  esperar(await egreso(cocina, masHoras(T0, 7.5)), 200);

  const r = esperar(await api('GET', '/fichajes/resumen', { token: admin.token, ahora: masHoras(T0, 8), query: { desde: '2026-10-14', hasta: '2026-10-14' } }), 200);
  const c = r.empleados.find((e) => e.rol === 'cocina');
  assert.deepEqual(c.por_turno, { produccion: 360, servicio: 450 });
  assert.equal(c.minutos, 810);
  assert.equal(c.jornadas, 2);
});

test('el resumen asigna cada jornada al día en que empezó y respeta la zona horaria', async () => {
  const bruno = await crearUsuario('barra', 'Bruno Barra', 'bruno-b@test.local');
  const dias = [
    ['2026-10-12T22:00:00Z', '2026-10-13T05:30:00Z'], // 19:00 del 12 a 02:30 del 13 -> día 12
    ['2026-10-13T22:00:00Z', '2026-10-14T01:00:00Z'], // 19:00 a 22:00 del 13 -> día 13
    ['2026-10-14T04:00:00Z', '2026-10-14T05:00:00Z'], // 01:00 a 02:00 del 14 -> día 14
  ];
  for (const [i, e] of dias) {
    esperar(await api('POST', '/fichajes', { token: admin.token, ahora: T0, body: { id_usuario: bruno.id, turno: 'servicio', ingreso: i, egreso: e } }), 201);
  }
  const ver = async (desde, hasta) => {
    const r = esperar(await api('GET', '/fichajes/resumen', { token: admin.token, ahora: masHoras(T0, 10), query: { desde, hasta, } }), 200);
    return r.empleados.find((x) => x.id_usuario === bruno.id);
  };
  const todo = await ver('2026-10-12', '2026-10-14');
  assert.deepEqual(todo.por_dia, { '2026-10-12': 450, '2026-10-13': 180, '2026-10-14': 60 });
  assert.equal(todo.minutos, 690);
  assert.deepEqual((await ver('2026-10-12', '2026-10-12')).por_dia, { '2026-10-12': 450 });
  assert.equal(await ver('2026-10-15', '2026-10-16'), undefined);
});

test('quién está trabajando ahora y detección de egreso olvidado', async () => {
  const mozo = await crearUsuario('camarero', 'Olvidadizo', 'olvidadizo@test.local');
  esperar(await api('POST', '/fichajes', { token: admin.token, ahora: T0, body: { id_usuario: mozo.id, turno: 'servicio', ingreso: '2026-10-14T22:00:00Z' } }), 201);
  const ahora = masHoras(T0, 1);
  const presentes = esperar(await api('GET', '/fichajes/presentes', { token: admin.token, ahora }), 200);
  const o = presentes.find((p) => p.nombre === 'Olvidadizo');
  assert.equal(o.minutos, 60);
  assert.equal(o.posible_olvido, false);
  const alDiaSiguiente = esperar(await api('GET', '/fichajes/presentes', { token: admin.token, ahora: masHoras(T0, 20) }), 200);
  assert.equal(alDiaSiguiente.find((p) => p.nombre === 'Olvidadizo').posible_olvido, true);

  // el administrador cierra la jornada olvidada con la hora real de salida
  const f = alDiaSiguiente.find((p) => p.nombre === 'Olvidadizo');
  const cerrado = esperar(await api('POST', `/fichajes/${f.id}/cerrar`, { token: admin.token, ahora: masHoras(T0, 20), body: { egreso: '2026-10-15T05:00:00Z' } }), 200);
  assert.equal(cerrado.id, f.id);
  assert.equal((await api('POST', `/fichajes/${f.id}/cerrar`, { token: admin.token, ahora: masHoras(T0, 20), body: { egreso: '2026-10-15T05:00:00Z' } })).status, 409);
  const lista = esperar(await api('GET', '/fichajes', { token: admin.token, ahora: masHoras(T0, 20), query: { desde: '2026-10-14', hasta: '2026-10-14' } }), 200);
  const fila = lista.fichajes.find((x) => x.id === f.id);
  assert.equal(fila.minutos, 420);
  assert.equal(fila.manual, true); // queda marcado como corregido a mano
});

test('el administrador carga y corrige fichajes con validaciones', async () => {
  const u = await crearUsuario('cajero', 'Caja Manual', 'caja-manual@test.local');
  const body = { id_usuario: u.id, turno: 'servicio', ingreso: '2026-10-13T22:00:00Z', egreso: '2026-10-14T05:00:00Z' };
  const ahora = masHoras(T0, 10);
  const a = (b) => api('POST', '/fichajes', { token: admin.token, ahora, body: b });
  assert.equal((await a({ ...body, egreso: '2026-10-13T21:00:00Z' })).status, 400); // egreso antes del ingreso
  assert.equal((await a({ ...body, ingreso: '2027-01-01T00:00:00Z', egreso: null })).status, 400); // futuro
  assert.equal((await a({ ...body, id_usuario: 99999 })).status, 404);
  assert.equal((await a({ ...body, ingreso: 'ayer' })).status, 400);
  const { id } = esperar(await a(body), 201);

  const corregido = esperar(await api('PATCH', `/fichajes/${id}`, { token: admin.token, ahora, body: { egreso: '2026-10-14T04:00:00Z', nota: 'se fue antes' } }), 200);
  assert.equal(corregido.id, id);
  const f = esperar(await api('GET', '/fichajes', { token: admin.token, ahora, query: { id_usuario: String(u.id), desde: '2026-10-13', hasta: '2026-10-13' } }), 200).fichajes[0];
  assert.equal(f.minutos, 360);
  assert.equal(f.nota, 'se fue antes');
  assert.equal((await api('PATCH', `/fichajes/${id}`, { token: admin.token, ahora, body: { egreso: '2026-10-13T20:00:00Z' } })).status, 400);
  assert.equal((await api('PATCH', '/fichajes/99999', { token: admin.token, ahora, body: { nota: 'x' } })).status, 404);

  // una sola jornada abierta por persona, también al cargar a mano
  esperar(await a({ id_usuario: u.id, turno: 'servicio', ingreso: '2026-10-14T20:00:00Z' }), 201);
  assert.equal((await a({ id_usuario: u.id, turno: 'servicio', ingreso: '2026-10-14T21:00:00Z' })).status, 409);
});

test('rangos de fechas inválidos y permisos', async () => {
  const q = (query) => api('GET', '/fichajes', { token: admin.token, ahora: T0, query });
  assert.equal((await q({ desde: '2026-13-40' })).status, 400);
  assert.equal((await q({ desde: '2026-10-20', hasta: '2026-10-10' })).status, 400);
  assert.equal((await api('GET', '/fichajes', { token: camarero.token, ahora: T0 })).status, 403);
  assert.equal((await api('GET', '/fichajes/resumen', { token: cocina.token, ahora: T0 })).status, 403);
  // cada persona solo ve sus propios fichajes en /fichajes/mio, aunque pida otro usuario
  const m = esperar(await mio(camarero, masHoras(T0, 10), { id_usuario: String(host.usuario.id), desde: '2026-10-14', hasta: '2026-10-14' }), 200);
  assert.ok(m.historial.every((f) => f.id_usuario === camarero.usuario.id));
});

test('mesas: el host y el salón ven la disponibilidad; barra y cocina solo miran', async () => {
  for (const [nombre, zona, capacidad] of [['Mesa 1', 'interior', 2], ['Mesa 2', 'interior', 2], ['Living interior', 'interior', 12], ['Living A', 'exterior', 8], ['Living B', 'exterior', 8]]) {
    esperar(await api('POST', '/mesas', { token: admin.token, body: { nombre, zona, capacidad } }), 201);
  }
  const lista = esperar(await api('GET', '/mesas', { token: host.token }), 200);
  assert.deepEqual(lista.resumen, {
    mesas: 5, libres: 5, ocupadas: 0, aforo: 32, lugares_ocupados: 0, lugares_libres: 32,
    interior: { mesas: 3, libres: 3, lugares_libres: 16 }, exterior: { mesas: 2, libres: 2, lugares_libres: 16 },
  });
  const m1 = lista.mesas.find((m) => m.nombre === 'Mesa 1');

  const ocupada = esperar(await api('PATCH', `/mesas/${m1.id}/estado`, { token: host.token, ahora: T0, body: { estado: 'ocupada' } }), 200);
  assert.equal(ocupada.estado, 'ocupada');
  assert.equal(new Date(ocupada.estado_desde).toISOString(), T0.toISOString());
  const live = esperar(await api('GET', '/mesas', { token: (await conSesion('barra')).token }), 200);
  assert.equal(live.resumen.ocupadas, 1);
  assert.equal(live.resumen.lugares_libres, 30);

  assert.equal((await api('PATCH', `/mesas/${m1.id}/estado`, { token: (await conSesion('barra')).token, body: { estado: 'libre' } })).status, 403);
  assert.equal((await api('PATCH', `/mesas/${m1.id}/estado`, { token: cocina.token, body: { estado: 'libre' } })).status, 403);
  assert.equal((await api('PATCH', `/mesas/${m1.id}/estado`, { token: host.token, body: { estado: 'rota' } })).status, 400);
  assert.equal((await api('PATCH', '/mesas/99999/estado', { token: host.token, body: { estado: 'libre' } })).status, 404);

  // si el estado no cambia, no se pisa la hora desde la que está así
  const igual = esperar(await api('PATCH', `/mesas/${m1.id}/estado`, { token: host.token, ahora: masHoras(T0, 1), body: { estado: 'ocupada' } }), 200);
  assert.equal(new Date(igual.estado_desde).toISOString(), T0.toISOString());
  esperar(await api('PATCH', `/mesas/${m1.id}/estado`, { token: host.token, ahora: masHoras(T0, 2), body: { estado: 'libre' } }), 200);
});

test('mesas: el administrador las administra', async () => {
  const dup = await api('POST', '/mesas', { token: admin.token, body: { nombre: 'Mesa 1', zona: 'interior', capacidad: 2 } });
  assert.equal(dup.status, 409);
  assert.equal((await api('POST', '/mesas', { token: admin.token, body: { nombre: 'Rara', zona: 'techo', capacidad: 2 } })).status, 400);
  assert.equal((await api('POST', '/mesas', { token: admin.token, body: { nombre: 'Rara', zona: 'interior', capacidad: 0 } })).status, 400);
  const lista = esperar(await api('GET', '/mesas', { token: admin.token }), 200);
  const m2 = lista.mesas.find((m) => m.nombre === 'Mesa 2');
  esperar(await api('PATCH', `/mesas/${m2.id}`, { token: admin.token, body: { capacidad: 4 } }), 200);
  esperar(await api('PATCH', `/mesas/${m2.id}`, { token: admin.token, body: { activo: false } }), 200);
  const despues = esperar(await api('GET', '/mesas', { token: admin.token }), 200);
  assert.equal(despues.resumen.mesas, 4); // la dada de baja ya no cuenta
  assert.equal(despues.resumen.aforo, 30);
});
