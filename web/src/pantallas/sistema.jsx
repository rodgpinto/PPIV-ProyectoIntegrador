import { useState } from 'react';
import { Encabezado, Pestanas } from '../ui.jsx';
import { Auditoria } from './auditoria.jsx';
import { CartaQr } from './qr.jsx';
import { Respaldos } from './respaldos.jsx';

const PESTANAS = [['respaldos', 'Copias de seguridad'], ['auditoria', 'Auditoría'], ['qr', 'Carta con QR']];

/** Lo que mantiene el sistema andando: copias de seguridad, registro de acciones y el QR de la carta. Solo administrador. */
export function Sistema() {
  const [pestana, setPestana] = useState(() => {
    const p = window.location.hash.split('?')[1];
    const t = new URLSearchParams(p).get('t');
    return PESTANAS.some(([c]) => c === t) ? t : 'respaldos';
  });
  const Contenido = { respaldos: Respaldos, auditoria: Auditoria, qr: CartaQr }[pestana];
  return (
    <>
      <Encabezado titulo="Sistema" sub="Copias de seguridad, registro de lo que hace cada persona y la carta para los clientes." />
      <Pestanas valor={pestana} onCambio={setPestana} opciones={PESTANAS} />
      <Contenido />
    </>
  );
}
