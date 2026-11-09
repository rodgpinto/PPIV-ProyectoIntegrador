// Generador de códigos QR sin dependencias (modo byte, corrección de errores M, versiones 1 a 10: hasta 213 caracteres).
// Se verificó decodificando los resultados con OpenCV (ver test/qr.test.js, que solo comprueba la estructura).
// Uso: qrMatriz('https://…') -> array de filas de booleanos (true = módulo oscuro);  qrSvg(texto) -> string SVG.

// [codewords de datos por bloque corto, cantidad bloques cortos, cantidad bloques largos (con 1 más), EC por bloque]
const TABLA_M = {
  1: [16, 1, 0, 10], 2: [28, 1, 0, 16], 3: [44, 1, 0, 26], 4: [32, 2, 0, 18], 5: [43, 2, 0, 24],
  6: [27, 4, 0, 16], 7: [31, 4, 0, 18], 8: [38, 2, 2, 22], 9: [36, 3, 2, 22], 10: [43, 4, 1, 26],
};
const ALINEACION = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const datosTotales = (v) => { const [d, c, l] = TABLA_M[v]; return d * c + (d + 1) * l; };
export const capacidadBytes = (v) => datosTotales(v) - (v < 10 ? 2 : 3); // modo (4 bits) + largo (8 o 16 bits) + terminador

// ---- Reed-Solomon sobre GF(256), polinomio 0x11D ----
const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i += 1) {
  EXP[i] = x; LOG[x] = i;
  x <<= 1; if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
const mult = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generador(n) {
  let g = [1];
  for (let i = 0; i < n; i += 1) {
    const sig = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j += 1) { sig[j] ^= g[j]; sig[j + 1] ^= mult(g[j], EXP[i]); }
    g = sig;
  }
  return g;
}
function resto(datos, n) {
  const g = generador(n);
  const r = new Array(n).fill(0);
  for (const b of datos) {
    const f = b ^ r.shift();
    r.push(0);
    if (f) for (let i = 0; i < n; i += 1) r[i] ^= mult(g[i + 1], f);
  }
  return r;
}

function bytesUtf8(texto) { return [...new TextEncoder().encode(texto)]; }

function codewords(bytes, version) {
  const [d, c, l, ec] = TABLA_M[version];
  const total = datosTotales(version);
  const bits = [];
  const poner = (valor, n) => { for (let i = n - 1; i >= 0; i -= 1) bits.push((valor >> i) & 1); };
  poner(0b0100, 4);
  poner(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) poner(b, 8);
  poner(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; cw.length < total; pad ^= 0xec ^ 0x11) cw.push(pad);

  const bloques = [];
  let pos = 0;
  for (let i = 0; i < c + l; i += 1) {
    const largo = i < c ? d : d + 1;
    const datos = cw.slice(pos, pos + largo);
    pos += largo;
    bloques.push({ datos, ec: resto(datos, ec) });
  }
  const salida = [];
  for (let i = 0; i <= d; i += 1) for (const b of bloques) if (i < b.datos.length) salida.push(b.datos[i]);
  for (let i = 0; i < ec; i += 1) for (const b of bloques) salida.push(b.ec[i]);
  return salida;
}

// ---- matriz ----
function bch(valor, generadorPoli, bitsResto) {
  let r = valor << bitsResto;
  const largo = (n) => 32 - Math.clz32(n);
  while (largo(r) >= largo(generadorPoli)) r ^= generadorPoli << (largo(r) - largo(generadorPoli));
  return (valor << bitsResto) | r;
}

const MASCARAS = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => ((((f + c) % 2) + ((f * c) % 3)) % 2) === 0,
];

function penalidad(m) {
  const n = m.length;
  let p = 0;
  // 1) rachas de 5 o más iguales en filas y columnas
  for (let t = 0; t < 2; t += 1) {
    for (let i = 0; i < n; i += 1) {
      let racha = 1;
      for (let j = 1; j < n; j += 1) {
        const a = t ? m[j][i] : m[i][j];
        const b = t ? m[j - 1][i] : m[i][j - 1];
        if (a === b) { racha += 1; if (racha === 5) p += 3; else if (racha > 5) p += 1; } else racha = 1;
      }
    }
  }
  // 2) bloques de 2x2
  for (let i = 0; i < n - 1; i += 1) for (let j = 0; j < n - 1; j += 1) if (m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1]) p += 3;
  // 3) patrones parecidos a los de las esquinas
  const patron = [true, false, true, true, true, false, true];
  for (let t = 0; t < 2; t += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j <= n - 11; j += 1) {
        const v = (k) => (t ? m[j + k][i] : m[i][j + k]);
        const cuerpo = patron.every((x, k) => v(k + 4) === x) ;
        const izq = patron.every((x, k) => v(k) === x);
        const claro = (desde) => [0, 1, 2, 3].every((k) => !v(desde + k));
        if (izq && claro(7)) p += 40; // 1011101 0000
        if (cuerpo && claro(0)) p += 40; // 0000 1011101
      }
    }
  }
  // 4) proporción de módulos oscuros
  const oscuros = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs((oscuros * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

function armar(version, bytes) {
  const n = 17 + 4 * version;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fija = Array.from({ length: n }, () => new Array(n).fill(false)); // true = parte de un patrón de función
  const poner = (f, c, v) => { m[f][c] = v; fija[f][c] = true; };

  const dibujarBuscador = (f0, c0) => {
    for (let f = -1; f <= 7; f += 1) for (let c = -1; c <= 7; c += 1) {
      const ff = f0 + f; const cc = c0 + c;
      if (ff < 0 || cc < 0 || ff >= n || cc >= n) continue;
      let oscuro = false;
      if (f >= 0 && f <= 6 && c >= 0 && c <= 6) {
        const d = Math.max(Math.abs(f - 3), Math.abs(c - 3)); // 0 centro, 3 borde
        oscuro = d !== 2;
      }
      poner(ff, cc, oscuro);
    }
  };
  dibujarBuscador(0, 0); dibujarBuscador(0, n - 7); dibujarBuscador(n - 7, 0);

  for (let i = 8; i < n - 8; i += 1) { poner(6, i, i % 2 === 0); poner(i, 6, i % 2 === 0); }
  const centros = ALINEACION[version];
  for (const fc of centros) for (const cc of centros) {
    if ((fc === 6 && cc === 6) || (fc === 6 && cc === n - 7) || (fc === n - 7 && cc === 6)) continue;
    for (let f = -2; f <= 2; f += 1) for (let c = -2; c <= 2; c += 1) poner(fc + f, cc + c, Math.max(Math.abs(f), Math.abs(c)) !== 1);
  }
  poner(n - 8, 8, true); // módulo oscuro fijo
  // zonas reservadas para el formato
  for (let i = 0; i < 9; i += 1) { if (!fija[8][i]) poner(8, i, false); if (!fija[i][8]) poner(i, 8, false); }
  for (let i = 0; i < 8; i += 1) { if (!fija[8][n - 1 - i]) poner(8, n - 1 - i, false); if (!fija[n - 1 - i][8]) poner(n - 1 - i, 8, false); }
  m[n - 8][8] = true;
  // versión (7 en adelante)
  if (version >= 7) {
    const info = bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((info >> i) & 1) === 1;
      const a = Math.floor(i / 3); const b = (i % 3) + n - 11;
      poner(a, b, bit); poner(b, a, bit);
    }
  }

  // datos en zigzag
  const cw = codewords(bytes, version);
  const bits = [];
  for (const b of cw) for (let i = 7; i >= 0; i -= 1) bits.push((b >> i) & 1);
  const celdas = [];
  let arriba = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c -= 1;
    for (let k = 0; k < n; k += 1) {
      const f = arriba ? n - 1 - k : k;
      for (const cc of [c, c - 1]) if (!fija[f][cc]) celdas.push([f, cc]);
    }
    arriba = !arriba;
  }
  celdas.forEach(([f, c], i) => { m[f][c] = (bits[i] ?? 0) === 1; });

  let mejor = null;
  for (let mascara = 0; mascara < 8; mascara += 1) {
    const t = m.map((fila) => fila.slice());
    for (const [f, c] of celdas) if (MASCARAS[mascara](f, c)) t[f][c] = !t[f][c];
    const formato = bch((0b00 << 3) | mascara, 0x537, 10) ^ 0x5412; // nivel M = 00
    const bit = (i) => ((formato >> i) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) t[i][8] = bit(i);
    t[7][8] = bit(6); t[8][8] = bit(7); t[8][7] = bit(8);
    for (let i = 9; i < 15; i += 1) t[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i += 1) t[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i += 1) t[n - 15 + i][8] = bit(i);
    t[n - 8][8] = true;
    const puntos = penalidad(t);
    if (!mejor || puntos < mejor.puntos) mejor = { puntos, matriz: t, mascara };
  }
  return mejor.matriz;
}

export function qrMatriz(texto) {
  const bytes = bytesUtf8(texto);
  const version = Object.keys(TABLA_M).map(Number).find((v) => bytes.length <= capacidadBytes(v));
  if (!version) throw new Error(`El texto es demasiado largo para el QR (máximo ${capacidadBytes(10)} caracteres).`);
  return armar(version, bytes);
}

/** SVG listo para insertar: fondo blanco con zona de silencio de 4 módulos, que los lectores necesitan. */
export function qrSvg(texto, { modulo = 8 } = {}) {
  const m = qrMatriz(texto);
  const borde = 4;
  const lado = m.length + borde * 2;
  const partes = [];
  m.forEach((fila, f) => {
    let c = 0;
    while (c < fila.length) {
      if (!fila[c]) { c += 1; continue; }
      let fin = c;
      while (fin < fila.length && fila[fin]) fin += 1;
      partes.push(`M${c + borde} ${f + borde}h${fin - c}v1h${-(fin - c)}z`);
      c = fin;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="${lado * modulo}" height="${lado * modulo}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${partes.join('')}" fill="#000"/></svg>`;
}
