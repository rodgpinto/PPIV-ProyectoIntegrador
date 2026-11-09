import { createRoot } from 'react-dom/client';
import { App } from './app.jsx';
import { ProveedorAvisos } from './ui.jsx';

createRoot(document.getElementById('raiz')).render(<ProveedorAvisos><App /></ProveedorAvisos>);
