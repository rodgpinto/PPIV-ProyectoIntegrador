/** Un handler devuelve una Descarga cuando la respuesta es un archivo y no JSON. */
export class Descarga {
  constructor(nombre, buffer, tipo = 'application/octet-stream') {
    this.nombre = nombre;
    this.buffer = buffer;
    this.tipo = tipo;
  }
}
