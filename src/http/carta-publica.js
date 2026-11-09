// Carta para los clientes (la que abre el QR): una página HTML completa generada en el servidor, sin JavaScript,
// sin iniciar sesión y sin ningún enlace al sistema del personal. Carga rápido con cualquier señal y funciona en cualquier celular.

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function pesosCarta(n) {
  const [ent, dec] = Math.abs(n).toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${miles}${dec === '00' ? '' : `,${dec}`}`;
}

const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seccion';

export function renderCarta(categorias, { nombre = 'RADAS', bajada = 'Rooftop bar · Puerto Madero' } = {}) {
  const usados = new Set();
  const secciones = categorias.map((c) => {
    let id = slug(c.categoria);
    while (usados.has(id)) id += '-2';
    usados.add(id);
    return { ...c, id };
  });
  const nav = secciones.length > 1
    ? `<nav class="secciones" aria-label="Categorías">${secciones.map((s) => `<a href="#${s.id}">${escapar(s.categoria)}</a>`).join('')}</nav>`
    : '';
  const cuerpo = secciones.length
    ? secciones.map((s) => `
    <section id="${s.id}" aria-labelledby="t-${s.id}">
      <h2 id="t-${s.id}">${escapar(s.categoria)}</h2>
      <ul>${s.items.map((p) => `
        <li>
          <div class="texto"><b>${escapar(p.nombre)}</b>${p.descripcion ? `<span>${escapar(p.descripcion)}</span>` : ''}</div>
          <span class="precio">${pesosCarta(p.precio)}</span>
        </li>`).join('')}
      </ul>
    </section>`).join('')
    : '<p class="vacio">La carta se está actualizando. Pedile la carta a tu mozo o mozA.</p>';

  return `<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#14232b">
  <title>${escapar(nombre)} · Carta</title>
  <meta name="description" content="Carta de ${escapar(nombre)}. ${escapar(bajada)}.">
  <link rel="stylesheet" href="/carta/estilos.css">
</head>
<body>
  <header>
    <h1>${escapar(nombre)}</h1>
    <p>${escapar(bajada)}</p>
  </header>
  ${nav}
  <main>${cuerpo}
  </main>
  <footer>
    <p>Para pedir, avisale a tu mozo o mozA en la mesa o acercate a la barra.</p>
    <p>Precios en pesos argentinos.</p>
  </footer>
</body>
</html>
`;
}

export const CSS_CARTA = `
:root { --fondo: #14232b; --fondo-2: #1d3440; --texto: #f2ece1; --suave: #a9b8bf; --acento: #e9a07f; --linea: #2f4753; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--fondo); color: var(--texto); font: 17px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; padding-bottom: env(safe-area-inset-bottom); }
header { text-align: center; padding: 2.4rem 1rem 1.4rem; padding-top: max(2.4rem, env(safe-area-inset-top)); }
h1 { margin: 0; font: 700 2.3rem/1 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; letter-spacing: .3em; color: var(--acento); padding-left: .3em; }
header p { margin: .6rem 0 0; color: var(--suave); font-size: .95rem; }
.secciones { position: sticky; top: 0; z-index: 5; display: flex; gap: .5rem; overflow-x: auto; padding: .6rem 1rem; background: var(--fondo); border-bottom: 1px solid var(--linea); scrollbar-width: none; }
.secciones::-webkit-scrollbar { display: none; }
.secciones a { flex: none; color: var(--texto); text-decoration: none; padding: .5rem .95rem; min-height: 44px; display: inline-flex; align-items: center; border: 1px solid var(--linea); border-radius: 999px; background: var(--fondo-2); font-size: .95rem; }
.secciones a:active, .secciones a:focus-visible { border-color: var(--acento); color: var(--acento); }
main { max-width: 680px; margin: 0 auto; padding: 0 1rem 1rem; }
section { scroll-margin-top: 4.2rem; padding-top: 1.4rem; }
h2 { margin: 0 0 .3rem; font: 600 1.35rem/1.2 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; color: var(--acento); border-bottom: 1px solid var(--linea); padding-bottom: .4rem; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; padding: .8rem 0; border-bottom: 1px solid var(--linea); }
li:last-child { border-bottom: 0; }
.texto { min-width: 0; }
.texto b { display: block; font-weight: 600; overflow-wrap: anywhere; }
.texto span { display: block; color: var(--suave); font-size: .9rem; margin-top: .15rem; overflow-wrap: anywhere; }
.precio { flex: none; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.vacio { text-align: center; color: var(--suave); padding: 3rem 1rem; }
footer { text-align: center; color: var(--suave); font-size: .85rem; padding: 1.6rem 1rem 2.4rem; }
footer p { margin: .2rem 0; }
@media (min-width: 720px) { body { font-size: 18px; } h1 { font-size: 2.8rem; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;
