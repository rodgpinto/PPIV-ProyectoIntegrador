// Contraseñas con scrypt (memoria-dura, recomendada por OWASP) y tokens de sesión aleatorios.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const N = 2 ** 15;
const R = 8;
const P = 1;
const maxmem = (n, r) => 256 * n * r; // el doble de lo que scrypt necesita (128 * N * r)

export async function hashearPassword(password) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), sal, 64, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarPassword(password, almacenado) {
  const [algoritmo, n, r, p, sal, hash] = almacenado.split('$');
  if (algoritmo !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const obtenido = await scryptAsync(password.normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: maxmem(Number(n), Number(r)),
  });
  return timingSafeEqual(obtenido, esperado);
}

// El token que recibe el navegador es aleatorio; en la base solo se guarda su hash (sha256).
export const nuevoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
