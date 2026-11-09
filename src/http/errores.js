export class HttpError extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

export class ErrorValidacion extends HttpError {
  constructor(detalles) {
    super(400, 'Datos inválidos', detalles);
  }
}

/** Convierte cualquier error en { status, body }. Los códigos 23xxx son de PostgreSQL. */
export function respuestaDeError(error) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message, detalles: error.detalles } };
  }
  switch (error?.code) {
    case '23505':
      return { status: 409, body: { error: 'Ya existe un registro con esos datos' } };
    case '23503':
      return { status: 409, body: { error: 'El registro está relacionado con otros datos' } };
    case '23514':
      return { status: 400, body: { error: 'Algún valor está fuera de rango (por ejemplo, un máximo menor que el mínimo)' } };
    default:
      console.error(error);
      return { status: 500, body: { error: 'Error interno del servidor' } };
  }
}
