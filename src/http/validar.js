// Validación mínima con mensajes en castellano (no hace falta una librería para esto).
// Uso:  const datos = validar(v.objeto({ nombre: v.texto({ min: 1 }) }), body);
import { esFecha } from '../domain/fechas.js';
import { ErrorValidacion, HttpError } from './errores.js';

const ausente = (x) => x === undefined || x === null;
const ruta = (base, clave) => (base ? `${base}.${clave}` : String(clave));

// Envuelve una regla: maneja "obligatorio / opcional / puede ser null" antes de validar el tipo.
function regla(opciones, interpretar) {
  return (valor, campo, errores) => {
    if (valor === null && opciones.nulo) return null;
    if (ausente(valor)) {
      if (opciones.opcional || opciones.nulo) return undefined;
      errores.push({ campo, mensaje: campo ? 'Es obligatorio' : 'Falta el cuerpo de la solicitud' });
      return undefined;
    }
    return interpretar(valor, campo, errores);
  };
}

export const v = {
  texto: (o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (typeof valor !== 'string') return void errores.push({ campo, mensaje: 'Debe ser un texto' });
      let t = o.sinRecortar ? valor : valor.trim();
      if (o.minusculas) t = t.toLowerCase();
      if (t.length < (o.min ?? 0)) {
        return void errores.push({ campo, mensaje: o.min === 1 ? 'Es obligatorio' : `Debe tener al menos ${o.min} caracteres` });
      }
      if (t.length > (o.max ?? Infinity)) return void errores.push({ campo, mensaje: `No puede superar los ${o.max} caracteres` });
      if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return void errores.push({ campo, mensaje: 'Debe ser un email válido' });
      return t;
    }),

  numero: (o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (typeof valor !== 'number' || !Number.isFinite(valor)) return void errores.push({ campo, mensaje: 'Debe ser un número' });
      if (o.entero && !Number.isInteger(valor)) return void errores.push({ campo, mensaje: 'Debe ser un número entero' });
      if (valor < (o.min ?? -Infinity)) return void errores.push({ campo, mensaje: `Debe ser mayor o igual a ${o.min}` });
      if (o.minExclusivo !== undefined && valor <= o.minExclusivo) return void errores.push({ campo, mensaje: `Debe ser mayor que ${o.minExclusivo}` });
      if (valor > (o.max ?? Infinity)) return void errores.push({ campo, mensaje: `Debe ser menor o igual a ${o.max}` });
      return valor;
    }),

  booleano: (o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (typeof valor !== 'boolean') return void errores.push({ campo, mensaje: 'Debe ser verdadero o falso' });
      return valor;
    }),

  opcion: (valores, o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (!valores.includes(valor)) return void errores.push({ campo, mensaje: `Debe ser uno de: ${valores.join(', ')}` });
      return valor;
    }),

  fecha: (o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (!esFecha(valor)) return void errores.push({ campo, mensaje: 'Debe ser una fecha con formato AAAA-MM-DD' });
      return valor;
    }),

  fechaHora: (o = {}) =>
    regla(o, (valor, campo, errores) => {
      const t = typeof valor === 'string' ? new Date(valor) : null;
      if (!t || Number.isNaN(t.getTime())) return void errores.push({ campo, mensaje: 'Debe ser una fecha y hora válida' });
      return t.toISOString();
    }),

  lista: (item, o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (!Array.isArray(valor)) return void errores.push({ campo, mensaje: 'Debe ser una lista' });
      if (valor.length < (o.min ?? 0)) return void errores.push({ campo, mensaje: `Debe tener al menos ${o.min} elementos` });
      if (valor.length > (o.max ?? Infinity)) return void errores.push({ campo, mensaje: `No puede tener más de ${o.max} elementos` });
      const salida = valor.map((x, i) => item(x, ruta(campo, i), errores));
      if (o.unicoPor) {
        const claves = salida.filter(Boolean).map((x) => x[o.unicoPor]);
        if (new Set(claves).size !== claves.length) errores.push({ campo, mensaje: 'Hay elementos repetidos' });
      }
      return salida;
    }),

  // parcial: true -> solo se validan las claves presentes (para PATCH)
  objeto: (forma, o = {}) =>
    regla(o, (valor, campo, errores) => {
      if (typeof valor !== 'object' || Array.isArray(valor)) return void errores.push({ campo, mensaje: 'Se esperaba un objeto' });
      const salida = {};
      for (const [clave, regla_] of Object.entries(forma)) {
        if (o.parcial && valor[clave] === undefined) continue;
        const r = regla_(valor[clave], ruta(campo, clave), errores);
        if (r !== undefined) salida[clave] = r;
      }
      return salida;
    }),
};

export function validar(esquema, datos) {
  const errores = [];
  const resultado = esquema(datos, '', errores);
  if (errores.length) throw new ErrorValidacion(errores);
  return resultado;
}

/** Identificador numérico de un parámetro de la URL. */
export function idDe(valor) {
  if (!/^\d+$/.test(String(valor)) || Number(valor) <= 0) throw new HttpError(400, 'Identificador inválido');
  return Number(valor);
}
