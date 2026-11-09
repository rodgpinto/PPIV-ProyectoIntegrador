import { useState } from 'react';
import { post } from '../api.js';
import { Boton, Entrada } from '../ui.jsx';

export function Login({ onEntrar }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cambiar = (c) => (e) => setForm((f) => ({ ...f, [c]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    setError(''); setEnviando(true);
    try { onEntrar(await post('/auth/login', { email: form.email.trim(), password: form.password })); }
    catch (err) { setError(err.message); setEnviando(false); }
  }

  return (
    <div className="entrada">
      <form className="entrada-caja" onSubmit={enviar}>
        <span className="marca">RADAS</span>
        <p className="lema">Gestión del bar</p>
        {error && <div className="caja-error" role="alert">{error}</div>}
        <Entrada etiqueta="Email" type="email" autoComplete="username" required autoFocus value={form.email} onChange={cambiar('email')} />
        <Entrada etiqueta="Contraseña" type="password" autoComplete="current-password" required value={form.password} onChange={cambiar('password')} />
        <Boton tipo="primario" type="submit" cargando={enviando}>Ingresar</Boton>
        <a href="/carta" style={{ textAlign: 'center' }}>Ver la carta</a>
      </form>
    </div>
  );
}
