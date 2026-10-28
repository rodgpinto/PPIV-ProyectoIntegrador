import { useState } from 'react';
import { get, post } from '../api.js';
import { aBase, principalDe } from '../../../src/domain/presentaciones.js';
import { MOTIVOS, numero, numeroDe, UNIDADES } from '../fmt.js';
import { Boton, Encabezado, Entrada, Estado, Selector, erroresPorCampo, useAviso, useCarga } from '../ui.jsx';

/** Formulario de mermas, reutilizado en la pantalla de Stock del administrador. */
export function FormMerma({ insumos, onListo }) {
  const avisar = useAviso();
  const vacio = { id_insumo: '', medida: '', cantidad: '', motivo: 'se_cayo', nota: '' };
  const [f, setF] = useState(vacio);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const ins = insumos.find((i) => String(i.id) === String(f.id_insumo));
  const set = (c) => (e) => setF((x) => ({ ...x, [c]: e.target.value }));
  // Si el insumo tiene envases, la cantidad se puede dar en botellas o cajas ('' = la unidad base)
  const envase = ins?.presentaciones?.find((p) => String(p.id) === f.medida) ?? null;
  const cantidadBase = envase ? aBase(numeroDe(f.cantidad), envase) : numeroDe(f.cantidad);
  const elegirInsumo = (e) => {
    const i = insumos.find((x) => String(x.id) === e.target.value);
    setF((x) => ({ ...x, id_insumo: e.target.value, medida: String(principalDe(i?.presentaciones)?.id ?? ''), cantidad: '' }));
  };

  async function enviar(e) {
    e.preventDefault(); setEnviando(true); setErrores({});
    try {
      await post('/stock/mermas', { id_insumo: Number(f.id_insumo), cantidad: cantidadBase, motivo: f.motivo, id_lote: null, ...(f.nota.trim() || envase ? { nota: [envase ? `${numero(numeroDe(f.cantidad), 2)} × ${envase.nombre}` : '', f.nota.trim()].filter(Boolean).join(' · ') } : {}) });
      avisar('Merma registrada'); setF(vacio); onListo?.();
    } catch (err) { const c = erroresPorCampo(err); setErrores(Object.keys(c).length ? c : { cantidad: err.message }); }
    finally { setEnviando(false); }
  }

  return (
    <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0, maxWidth: 480 }}>
      <Selector etiqueta="Insumo" required value={f.id_insumo} onChange={elegirInsumo} error={errores.id_insumo}>
        <option value="">Elegí un insumo…</option>
        {insumos.filter((i) => i.activo !== false).map((i) => <option key={i.id} value={i.id}>{i.nombre} ({UNIDADES[i.unidad]})</option>)}
      </Selector>
      {ins?.presentaciones?.length > 0 && (
        <Selector etiqueta="Medida" value={f.medida} onChange={set('medida')}>
          {ins.presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          <option value="">{UNIDADES[ins.unidad]} sueltos</option>
        </Selector>
      )}
      <Entrada etiqueta={`Cantidad perdida${ins ? ` (${envase ? 'envases' : UNIDADES[ins.unidad]})` : ''}`} inputMode="decimal" required value={f.cantidad} onChange={set('cantidad')} error={errores.cantidad}
        ayuda={envase && f.cantidad ? `= ${numero(cantidadBase, 2)} ${UNIDADES[ins.unidad]}` : undefined} />
      <Selector etiqueta="Motivo" value={f.motivo} onChange={set('motivo')}>{Object.entries(MOTIVOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</Selector>
      <Entrada etiqueta="Nota (opcional)" maxLength={300} value={f.nota} onChange={set('nota')} />
      <Boton tipo="primario" type="submit" cargando={enviando}>Registrar merma</Boton>
    </form>
  );
}

export function Mermas() {
  const carga = useCarga(() => get('/insumos'), []);
  return (
    <>
      <Encabezado titulo="Registrar merma" sub="Si algo se rompe, se cae o se vence, anotalo acá para que el stock coincida con la realidad." />
      <div className="tarjeta">
        <Estado carga={carga}>{(insumos) => <FormMerma insumos={insumos} />}</Estado>
      </div>
    </>
  );
}
