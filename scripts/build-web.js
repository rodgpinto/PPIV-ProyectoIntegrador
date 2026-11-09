// Compila la interfaz (React) a public/: un JS y un CSS con hash en el nombre, y el index.html que los enlaza.
// Uso: node scripts/build-web.js [--watch]
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const salida = path.join(raiz, 'public');
const assets = path.join(salida, 'assets');
const vigilar = process.argv.includes('--watch');

function escribirIndex(resultado) {
  const archivos = Object.keys(resultado.metafile.outputs).map((f) => path.basename(f));
  const js = archivos.find((f) => f.endsWith('.js'));
  const css = archivos.find((f) => f.endsWith('.css'));
  const plantilla = readFileSync(path.join(raiz, 'web/index.html'), 'utf8');
  writeFileSync(path.join(salida, 'index.html'), plantilla.replace('{{CSS}}', `/assets/${css}`).replace('{{JS}}', `/assets/${js}`));
  for (const f of readdirSync(assets)) if (!archivos.includes(f)) rmSync(path.join(assets, f)); // limpia compilaciones viejas
  const kb = (f) => (readFileSync(path.join(assets, f)).length / 1024).toFixed(0);
  console.log(`Interfaz compilada: ${js} (${kb(js)} KB), ${css} (${kb(css)} KB)`);
}

mkdirSync(assets, { recursive: true });
const opciones = {
  entryPoints: { app: path.join(raiz, 'web/src/main.jsx'), estilos: path.join(raiz, 'web/estilos.css') },
  bundle: true, outdir: assets, entryNames: '[name]-[hash]', metafile: true,
  minify: !vigilar, sourcemap: vigilar, target: ['es2020'], jsx: 'automatic', legalComments: 'none',
  define: { 'process.env.NODE_ENV': vigilar ? '"development"' : '"production"' },
  plugins: [{ name: 'index', setup(b) { b.onEnd((r) => { if (r.metafile) escribirIndex(r); }); } }],
};

if (vigilar) {
  const ctx = await esbuild.context(opciones);
  await ctx.watch();
  console.log('Vigilando web/ ... (Ctrl+C para salir)');
} else {
  await esbuild.build(opciones);
}
