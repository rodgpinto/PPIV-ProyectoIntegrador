import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { alExpirarSesion, get, guardarToken, hayToken, post } from './api.js';
import { ROLES } from './fmt.js';
import { Caja } from './pantallas/caja.jsx';
import { Cuenta } from './pantallas/cuenta.jsx';
import { Fichar } from './pantallas/fichar.jsx';
import { Informes } from './pantallas/informes.jsx';
import { Insumos } from './pantallas/insumos.jsx';
import { Kds } from './pantallas/kds.jsx';
import { Login } from './pantallas/login.jsx';
import { Mermas } from './pantallas/mermas.jsx';
import { Mesas } from './pantallas/mesas.jsx';
import { Pedidos } from './pantallas/pedidos.jsx';
import { Personal } from './pantallas/personal.jsx';
import { Productos } from './pantallas/productos.jsx';
import { Proveedores } from './pantallas/proveedores.jsx';
import { Resumen } from './pantallas/resumen.jsx';
import { Sistema } from './pantallas/sistema.jsx';
import { Stock } from './pantallas/stock.jsx';
import { Usuarios } from './pantallas/usuarios.jsx';
import { Ventas } from './pantallas/ventas.jsx';

const ContextoSesion = createContext(null);
export const useSesion = () => useContext(ContextoSesion);

const ADMIN = ['administrador'];
const TODOS = Object.keys(ROLES);
const PEDIDOS = ['administrador', 'cajero', 'barra', 'camarero'];
const KDS = ['administrador', 'barra', 'cocina'];
const CAJA = ['administrador', 'cajero'];
const PANTALLAS = [
  { ruta: 'resumen', titulo: 'Resumen', roles: ADMIN, Comp: Resumen },
  { ruta: 'pedidos', titulo: 'Pedidos', roles: PEDIDOS, Comp: Pedidos },
  { ruta: 'kds', titulo: (rol) => (rol === 'barra' ? 'Pantalla de barra' : rol === 'cocina' ? 'Pantalla de cocina' : 'Cocina y barra'), roles: KDS, Comp: Kds },
  { ruta: 'caja', titulo: 'Caja', roles: CAJA, Comp: Caja },
  { ruta: 'ventas', titulo: 'Ventas', roles: ADMIN, Comp: Ventas },
  { ruta: 'informes', titulo: 'Informes', roles: ADMIN, Comp: Informes },
  { ruta: 'mesas', titulo: 'Mesas', roles: TODOS, Comp: Mesas },
  { ruta: 'fichar', titulo: 'Mi jornada', roles: TODOS, Comp: Fichar },
  { ruta: 'mermas', titulo: 'Registrar merma', roles: ['camarero', 'barra', 'cocina'], Comp: Mermas },
  { ruta: 'productos', titulo: 'Productos y precios', roles: ADMIN, Comp: Productos },
  { ruta: 'insumos', titulo: 'Insumos', roles: ADMIN, Comp: Insumos },
  { ruta: 'stock', titulo: 'Stock', roles: ADMIN, Comp: Stock },
  { ruta: 'proveedores', titulo: 'Proveedores', roles: ADMIN, Comp: Proveedores },
  { ruta: 'personal', titulo: 'Horas del personal', roles: ADMIN, Comp: Personal },
  { ruta: 'usuarios', titulo: 'Empleados', roles: ADMIN, Comp: Usuarios },
  { ruta: 'sistema', titulo: 'Sistema', roles: ADMIN, Comp: Sistema },
  { ruta: 'cuenta', titulo: 'Mi cuenta', roles: TODOS, Comp: Cuenta },
];
const inicioDe = (rol) => ({ administrador: 'resumen', host: 'mesas', camarero: 'pedidos', cajero: 'pedidos', barra: 'kds', cocina: 'kds' })[rol] ?? 'fichar';

function useRuta() {
  const leer = () => (window.location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  const [ruta, setRuta] = useState(leer);
  useEffect(() => {
    const f = () => { setRuta(leer()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return ruta;
}

export function App() {
  const ruta = useRuta();
  // undefined = todavía no sabemos; null = sin sesión
  const [usuario, setUsuario] = useState(hayToken() ? undefined : null);

  const cerrar = useCallback(() => { setUsuario(null); window.location.hash = '#/'; }, []);
  useEffect(() => alExpirarSesion(cerrar), [cerrar]);
  useEffect(() => {
    if (usuario !== undefined) return;
    get('/auth/me').then((r) => setUsuario(r.usuario)).catch(() => { guardarToken(null); setUsuario(null); });
  }, [usuario]);

  const salir = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* si falla igual cerramos acá */ }
    guardarToken(null);
    cerrar();
  }, [cerrar]);

  if (usuario === undefined) return <p className="cargando" role="status">Cargando…</p>;
  if (!usuario) return <Login onEntrar={(r) => { guardarToken(r.token); setUsuario(r.usuario); window.location.hash = `#/${inicioDe(r.usuario.rol)}`; }} />;

  const visibles = PANTALLAS.filter((p) => p.roles.includes(usuario.rol));
  const actual = visibles.find((p) => p.ruta === ruta);
  const Comp = actual?.Comp;
  if (!actual) { window.location.replace(`#/${inicioDe(usuario.rol)}`); return null; }

  return (
    <ContextoSesion.Provider value={{ usuario, salir, setUsuario }}>
      <div className="app">
        <header className="barra">
          <a className="marca" href={`#/${inicioDe(usuario.rol)}`}>RADAS</a>
          <div className="quien">{usuario.nombre}<small>{ROLES[usuario.rol]}</small></div>
          <button className="btn btn-chico" onClick={salir}>Salir</button>
        </header>
        <div className="cuerpo">
          <nav className="menu" aria-label="Secciones">
            {visibles.map((p) => <a key={p.ruta} href={`#/${p.ruta}`} aria-current={p.ruta === ruta ? 'page' : undefined}>{typeof p.titulo === 'function' ? p.titulo(usuario.rol) : p.titulo}</a>)}
            <a href="/carta" target="_blank" rel="noreferrer">Ver la carta</a>
          </nav>
          <main className={`principal ${ruta === 'kds' ? 'ancho' : ''}`}><Comp /></main>
        </div>
      </div>
    </ContextoSesion.Provider>
  );
}
