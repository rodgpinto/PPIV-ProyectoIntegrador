import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fechaHora, pesos } from '../fmt.js';
import { Boton, Modal } from '../ui.jsx';

/**
 * Datos que salen impresos arriba del ticket. Para cambiar el nombre o la dirección del local se edita acá.
 * Cuando el bar tenga CUIT y facturación electrónica (docs/FACTURACION.md), el CUIT y la condición frente al IVA se agregan acá.
 */
export const NEGOCIO = { nombre: 'RADAS', detalle: 'Rooftop bar · Puerto Madero', lugar: 'Buenos Aires, Argentina' };

const MEDIOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta (POS)', mercado_pago: 'Mercado Pago', transferencia: 'Transferencia' };
const nombreDe = (c) => (c.canal === 'mesa' ? c.mesa : c.etiqueta ? `Barra · ${c.etiqueta}` : 'Barra');

/**
 * Ticket de una cuenta. NO es una factura ni un comprobante fiscal: lo dice en grande.
 * `cuenta.estado === 'cerrado'` es el ticket de lo cobrado; si la cuenta sigue abierta es la pre-cuenta que se le lleva a la mesa.
 */
export function TicketCuenta({ cuenta }) {
  const cobrada = cuenta.estado === 'cerrado';
  const lineas = cuenta.items.filter((i) => i.estado !== 'anulado');
  const total = lineas.reduce((s, i) => s + i.precio_unitario * i.cantidad, 0);
  return (
    <div className="ticket">
      <div className="ticket-cab">
        <b className="ticket-marca">{NEGOCIO.nombre}</b>
        <span>{NEGOCIO.detalle}</span>
        <span>{NEGOCIO.lugar}</span>
      </div>
      <p className="ticket-aviso">{cobrada ? 'COMPROBANTE NO VÁLIDO COMO FACTURA' : 'PRE-CUENTA · NO ES UN COMPROBANTE DE PAGO'}</p>
      <dl className="ticket-datos">
        <div><dt>Cuenta</dt><dd>{nombreDe(cuenta)}</dd></div>
        <div><dt>Nº</dt><dd>{String(cuenta.id).padStart(6, '0')}</dd></div>
        <div><dt>Fecha</dt><dd>{fechaHora(cobrada ? cuenta.cerrado_en ?? new Date().toISOString() : new Date().toISOString())}</dd></div>
        {cuenta.mozo && <div><dt>Atendió</dt><dd>{cuenta.mozo}</dd></div>}
      </dl>
      <table className="ticket-items">
        <thead><tr><th>Cant.</th><th>Detalle</th><th>Importe</th></tr></thead>
        <tbody>
          {lineas.map((i) => (
            <tr key={i.id}>
              <td>{i.cantidad}</td>
              <td>{i.nombre}{i.nota && <small>«{i.nota}»</small>}</td>
              <td>{pesos(i.precio_unitario * i.cantidad)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ticket-total"><span>TOTAL</span><span>{pesos(cobrada ? cuenta.total ?? total : total)}</span></p>
      {cobrada && cuenta.medio_pago && <p className="ticket-medio">Pagó con: {MEDIOS[cuenta.medio_pago] ?? cuenta.medio_pago}</p>}
      <div className="ticket-pie">
        <span>Precios finales en pesos argentinos</span>
        <span>{cobrada ? '¡Gracias por tu visita!' : 'Pedí tu cuenta al mozo o en caja'}</span>
        <span className="ticket-fiscal">Documento no fiscal</span>
      </div>
    </div>
  );
}

/**
 * Vista previa del ticket con el botón de imprimir. Al imprimir se oculta toda la aplicación y sale solo el ticket,
 * con ancho de 80 mm (impresora térmica); en una impresora común sale una tira angosta arriba de la hoja.
 */
export function VerTicket({ cuenta, titulo = 'Ticket', onCerrar }) {
  useEffect(() => {
    document.body.classList.add('con-ticket');
    return () => document.body.classList.remove('con-ticket');
  }, []);
  return (
    <>
      <Modal titulo={titulo} onCerrar={onCerrar} ancho="chico" pie={<><Boton onClick={onCerrar}>Cerrar</Boton><Boton tipo="primario" onClick={() => window.print()}>Imprimir</Boton></>}>
        <div className="ticket-vista"><TicketCuenta cuenta={cuenta} /></div>
        <p className="ayuda">No es una factura. Se imprime en tira de 80 mm; en una impresora común sale angosto arriba de la hoja. También se puede guardar como PDF desde el diálogo de impresión.</p>
      </Modal>
      {createPortal(<div className="ticket-hoja" aria-hidden="true"><TicketCuenta cuenta={cuenta} /></div>, document.body)}
    </>
  );
}
