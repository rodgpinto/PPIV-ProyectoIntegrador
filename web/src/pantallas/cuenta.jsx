import { useState } from 'react';
import { post } from '../api.js';
import { useSesion } from '../app.jsx';
import { ROLES } from '../fmt.js';
import { Boton, Encabezado, Entrada, erroresPorCampo, useAviso } from '../ui.jsx';

export function Cuenta() {
  const { usuario } = useSesion();
  const avisar = useAviso();
  const [form, setForm] = useState({ actual: '', nueva: '', repetir: '' });
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const cambiar = (c) => (e) => setForm((f) => ({ ...f, [c]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    if (form.nueva !== form.repetir) return setErrores({ repetir: 'No coincide con la nueva contraseña' });
    setEnviando(true); setErrores({});
    try {
      await post('/auth/cambiar-contrasena', { actual: form.actual, nueva: form.nueva });
      avisar('Contraseña cambiada. Se cerraron tus otras sesiones.');
      setForm({ actual: '', nueva: '', repetir: '' });
    } catch (err) {
      setErrores(Object.keys(erroresPorCampo(err)).length ? erroresPorCampo(err) : { actual: err.message });
    } finally { setEnviando(false); }
  }

  return (
    <>
      <Encabezado titulo="Mi cuenta" />
      <div className="tarjeta" style={{ maxWidth: 460 }}>
        <p><b>{usuario.nombre}</b><br />{ROLES[usuario.rol]}</p>
        <form onSubmit={enviar} className="modal-cuerpo" style={{ padding: 0 }}>
          <h3>Cambiar contraseña</h3>
          <Entrada etiqueta="Contraseña actual" type="password" autoComplete="current-password" required value={form.actual} onChange={cambiar('actual')} error={errores.actual} />
          <Entrada etiqueta="Contraseña nueva" type="password" autoComplete="new-password" required minLength={8} ayuda="Mínimo 8 caracteres" value={form.nueva} onChange={cambiar('nueva')} error={errores.nueva} />
          <Entrada etiqueta="Repetir la nueva" type="password" autoComplete="new-password" required value={form.repetir} onChange={cambiar('repetir')} error={errores.repetir} />
          <Boton tipo="primario" type="submit" cargando={enviando}>Cambiar contraseña</Boton>
        </form>
      </div>
    </>
  );
}
