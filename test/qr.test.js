// Generador de QR propio. La decodificación real se verificó fuera de las pruebas con OpenCV (160 combinaciones de
// versión, largo y máscara + estos textos); acá se fija el resultado exacto para detectar cambios accidentales
// y se comprueba la estructura obligatoria de todo QR.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { capacidadBytes, qrMatriz, qrSvg } from '../src/domain/qr.js';

const huella = (t) => createHash('sha1').update(qrMatriz(t).map((f) => f.map((x) => (x ? 1 : 0)).join('')).join('\n')).digest('hex');

test('resultado fijo para textos ya verificados con un decodificador real', () => {
  assert.equal(huella('https://radas-bar.onrender.com/carta'), '3a68d7743229a706b3c92eedc7fadb5e6bd1cd0d');
  assert.equal(huella(`xxxxx${'abcdefghijklmnopqrstuvwxyz'.repeat(6)}`), 'ccffdba7445e72023dc65fa276d377322ae46d21');
  assert.equal(huella('https://radas.test/carta'), '83562df51716b7a9af087d6d67078a1b886cc3a3');
});

test('el tamaño crece con el texto y respeta la capacidad de cada versión', () => {
  assert.equal(qrMatriz('a').length, 21);
  assert.equal(qrMatriz('a'.repeat(capacidadBytes(1))).length, 21);
  assert.equal(qrMatriz('a'.repeat(capacidadBytes(1) + 1)).length, 25);
  assert.equal(qrMatriz('a'.repeat(capacidadBytes(10))).length, 57);
  assert.throws(() => qrMatriz('a'.repeat(capacidadBytes(10) + 1)), /demasiado largo/);
});

test('tiene los tres buscadores, las líneas de sincronía y el módulo oscuro fijo', () => {
  for (const texto of ['a', 'https://radas.test/carta', 'x'.repeat(150)]) {
    const m = qrMatriz(texto);
    const n = m.length;
    for (const [f0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let f = 0; f < 7; f += 1) for (let c = 0; c < 7; c += 1) {
        const d = Math.max(Math.abs(f - 3), Math.abs(c - 3));
        assert.equal(m[f0 + f][c0 + c], d !== 2, `buscador en ${f0},${c0} módulo ${f},${c}`);
      }
    }
    for (let i = 8; i < n - 8; i += 1) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    assert.equal(m[n - 8][8], true);
  }
});

test('es determinista y distingue textos distintos', () => {
  assert.equal(huella('https://a.test/carta'), huella('https://a.test/carta'));
  assert.notEqual(huella('https://a.test/carta'), huella('https://b.test/carta'));
});

test('acepta caracteres fuera de ASCII (se codifican en UTF-8)', () => {
  assert.ok(qrMatriz('Café ñandú ✓').length >= 21);
});

test('el SVG tiene zona de silencio, es autocontenido y no lleva scripts', () => {
  const svg = qrSvg('https://radas.test/carta');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 33 33"/); // 25 módulos + 4 de margen a cada lado
  assert.ok(!/<script|href=|on\w+=/.test(svg));
  assert.match(svg, /fill="#fff"/);
});
