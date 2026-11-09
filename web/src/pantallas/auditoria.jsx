import { useCallback, useEffect, useState } from 'react';
import { get, guardarArchivo } from '../api.js';
import { fechaHora, hoy, numero, pesos, ROLES, sumarDias } from '../fmt.js';
import { textoDeAccion } from '../../../src/domain/auditoria.js';
import { Boton, Chip, Entrada, Selector, useAviso, useCarga } from '../ui.jsx';

const CAMPOS = {
  nombre: 'Nombre', precio: 'Precio', categoria: 'Categoría', destino: 'Destino', activo: 'Activo', descripcion: 'Descripción', receta: 'Receta',
  email: 'Email', rol: 'Rol', contrasena: 'Contraseña', unidad: 'Unidad', costo_unitario: 'Costo', stock_minimo: 'Stock mínimo',
  stock_maximo: 'Stock máximo', dias_aviso_vencimiento: 'Días de aviso', id_proveedor: 'Proveedor', contacto: 'Contacto', telefono: 'Teléfono',
  notas: 'Notas', zona: 'Zona', capacidad: 'Capacidad', turno: 'Turno', ingreso: 'Ingreso', egreso: 'Egreso', nota: 'Nota',
};

function valor(campo, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'sí';
  if (v === false) return 'no';
  if (campo === 'contrasena') return '••••';
  if (['precio', 'costo_unitario', 'ventas_total', 'efectivo_contado', 'diferencia', 'precio_unitario'].includes(campo) && typeof v === 'number') return pesos(v);
  if (['ingreso', 'egreso'].includes(campo)) return fechaHora(v);
  if (campo === 'rol') return ROLES[v] ?? v;
  return typeof v === 'number' ? numero(v, 3) : String(v);
}

/** Lo más importante de una fila en una o dos líneas legibles (el detalle completo queda en «Ver datos»). */
export function resumenDeDetalle(f) {
  const d = f.detalle;
  if (!d || typeof d !== 'object') return [];
  const lineas = [];
  if (d.cambios?.eliminado) lineas.push(`Se quitó: ${Object.entries(d.cambios.eliminado).filter(([, v]) => v !== null).map(([k, v]) => `${CAMPOS[k] ?? k} ${valor(k, v)}`).join(', ')}`);
  else if (d.cambios) for (const [k, [antes, despues]] of Object.entries(d.cambios)) lineas.push(`${CAMPOS[k] ?? k}: ${valor(k, antes)} → ${valor(k, despues)}`);
  if (d.desde || d.hacia) lineas.push(`${d.desde ?? '—'} → ${d.hacia ?? '—'}${d.unida_a_otra_cuenta ? ' (se unieron las cuentas)' : ''}`);
  if (d.lineas?.length) lineas.push(d.lineas.join(', '));
  if (d.total !== undefined) lineas.push(`Total ${pesos(d.total)}`);
  if (d.diferencia !== undefined) lineas.push(`Diferencia ${numero(d.diferencia, 3)}${d.stock_nuevo !== undefined ? ` · stock ahora ${numero(d.stock_nuevo, 3)}` : ''}`);
  if (d.email) lineas.push(d.email);
  if (d.motivo) lineas.push(d.motivo);
  if (d.ruta) lineas.push(d.ruta);
  if (!lineas.length && d.datos) {
    const t = Object.entries(d.datos).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${CAMPOS[k] ?? k}: ${valor(k, v)}`).join(' · ');
    if (t) lineas.push(t);
  }
  return lineas;
}

const csvCelda = (t) => `"${String(t ?? '').replaceAll('"', '""')}"`;
export function aCsv(filas) {
  const cab = ['Fecha y hora', 'Usuario', 'Rol', 'Acción', 'Código', 'Entidad', 'Id', 'Resultado', 'IP', 'Detalle'];
  const lineas = filas.map((f) => [fechaHora(f.fecha_hora), f.usuario, f.rol, textoDeAccion(f.accion), f.accion, f.entidad, f.id_entidad, f.resultado, f.ip, f.detalle ? JSON.stringify(f.detalle) : '']);
  // BOM + «;» para que Excel en español lo abra bien
  return `﻿${[cab, ...lineas].map((l) => l.map(csvCelda).join(';')).join('\r\n')}`;
}

const TONO = { ok: 'ok', denegado: 'aviso', fallido: 'malo' };
const ETIQUETA_RESULTADO = { ok: 'Correcto', denegado: 'Sin permiso', fallido: 'Falló' };

export function Auditoria() {
  const aviso = useAviso();
  const [filtros, setFiltros] = useState({ desde: sumarDias(hoy(), -7), hasta: hoy(), accion: '', id_usuario: '', resultado: '', texto: '' });
  const [aplicados, setAplicados] = useState(filtros);
  const [filas, setFilas] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [acciones, setAcciones] = useState([]);
  const [estado, setEstado] = useState({ cargando: true, error: null });
  const usuarios = useCarga(() => get('/usuarios'), []);

  const traer = useCallback(async (f, despuesDe) => {
    setEstado({ cargando: true, error: null });
    try {
      const r = await get('/auditoria', { ...f, limite: 100, antes_de_id: despuesDe });
      setFilas((actual) => (despuesDe ? [...actual, ...r.filas] : r.filas));
      setHayMas(r.hay_mas);
      setAcciones(r.acciones);
      setEstado({ cargando: false, error: null });
    } catch (e) { setEstado({ cargando: false, error: e }); }
  }, []);
  useEffect(() => { traer(aplicados); }, [aplicados, traer]);

  const cambiar = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));
  const buscar = (e) => { e.preventDefault(); setAplicados(filtros); };
  const exportar = () => {
    guardarArchivo(new Blob([aCsv(filas)], { type: 'text/csv;charset=utf-8' }), `auditoria-${hoy()}.csv`);
    aviso(`${filas.length} filas exportadas`);
  };

  return (
    <>
      <p className="sub">Quién hizo qué y cuándo. Se registra solo y no se puede modificar desde el sistema.</p>
      <form className="herramientas" onSubmit={buscar}>
        <Entrada etiqueta="Desde" type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={cambiar('desde')} />
        <Entrada etiqueta="Hasta" type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={cambiar('hasta')} />
        <Selector etiqueta="Persona" value={filtros.id_usuario} onChange={cambiar('id_usuario')}>
          <option value="">Todas</option>
          {(usuarios.datos ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre} ({ROLES[u.rol]})</option>)}
        </Selector>
        <Selector etiqueta="Acción" value={filtros.accion} onChange={cambiar('accion')}>
          <option value="">Todas</option>
          {acciones.map((a) => <option key={a.codigo} value={a.codigo}>{a.texto}</option>)}
        </Selector>
        <Selector etiqueta="Resultado" value={filtros.resultado} onChange={cambiar('resultado')}>
          <option value="">Todos</option>
          {Object.entries(ETIQUETA_RESULTADO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </Selector>
        <Entrada etiqueta="Buscar texto" placeholder="producto, email, mesa…" value={filtros.texto} onChange={cambiar('texto')} maxLength={60} />
        <Boton tipo="primario" type="submit">Buscar</Boton>
        <Boton onClick={exportar} disabled={!filas.length}>Descargar CSV</Boton>
      </form>

      {estado.error && <div className="caja-error" role="alert"><p>{estado.error.message}</p></div>}
      {!estado.error && !estado.cargando && !filas.length && <p className="vacio">No hay movimientos con esos filtros.</p>}
      {filas.length > 0 && (
        <ul className="aud-lista">
          {filas.map((f) => {
            const lineas = resumenDeDetalle(f);
            return (
              <li key={f.id} className={`aud-fila aud-${f.resultado}`}>
                <div className="aud-cuando"><b>{fechaHora(f.fecha_hora)}</b><small>{f.usuario || 'Sin identificar'}{f.rol ? ` · ${ROLES[f.rol] ?? f.rol}` : ''}</small></div>
                <div className="aud-que">
                  <span>{textoDeAccion(f.accion)} {f.resultado !== 'ok' && <Chip tono={TONO[f.resultado]}>{ETIQUETA_RESULTADO[f.resultado]}</Chip>}</span>
                  {lineas.map((l) => <small key={l} className="aud-linea">{l}</small>)}
                  {f.detalle && (
                    <details><summary>Ver datos</summary><pre>{JSON.stringify(f.detalle, null, 2)}</pre><small>{f.entidad && `${f.entidad} #${f.id_entidad} · `}IP {f.ip || '—'}</small></details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {estado.cargando && <p className="cargando" role="status">Cargando…</p>}
      {hayMas && !estado.cargando && <div className="acciones" style={{ justifyContent: 'center', marginTop: '.8rem' }}><Boton onClick={() => traer(aplicados, filas[filas.length - 1].id)}>Ver más antiguos</Boton></div>}
    </>
  );
}
