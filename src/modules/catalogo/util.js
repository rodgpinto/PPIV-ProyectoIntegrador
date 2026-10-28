/** "$1, $2, $3" para una cláusula IN con `n` valores, empezando en el parámetro `desde`. */
export const marcadores = (n, desde = 1) => Array.from({ length: n }, (_, i) => `$${i + desde}`).join(', ');

/** "campo = $1, campo2 = $2" desde un objeto ya validado (las claves provienen del esquema, nunca del usuario). */
export function armarSet(datos) {
  const claves = Object.keys(datos);
  return { sql: claves.map((c, i) => `${c} = $${i + 1}`).join(', '), valores: claves.map((c) => datos[c]), cantidad: claves.length };
}
