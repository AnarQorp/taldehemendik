export class DomainError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message || code);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ERROR_MESSAGES = {
  AUTH_REQUIRED: "Sesión no válida o expirada. Por favor, identifícate de nuevo.",
  AUTH_INVALID: "Credenciales no válidas o código expirado.",
  ROLE_NOT_ALLOWED: "No tienes permisos suficientes para realizar esta acción.",
  GUARDIAN_LINK_REQUIRED: "No tienes vinculación activa con este jugador.",
  PLAYER_NOT_ACCESSIBLE: "El recurso o jugador solicitado no está disponible.",
  INVITATION_INVALID: "El enlace o código de invitación no es válido.",
  INVITATION_EXPIRED: "La invitación ha caducado.",
  EVENT_NOT_ACTIVE: "El evento ya no se encuentra activo.",
  EVENT_VERSION_CONFLICT: "El evento ha sido modificado por otro usuario. Por favor, recarga la página.",
  AVAILABILITY_CLOSED: "El plazo de disponibilidad para este evento ha concluido.",
  AVAILABILITY_VERSION_CONFLICT: "El estado de disponibilidad ha sido actualizado recientemente. Recarga para ver los cambios.",
  CALLUP_VERSION_CONFLICT: "La convocatoria ha sido modificada por otra sesión. Por favor, actualiza y revisa los cambios.",
  CALLUP_WARNINGS_UNCONFIRMED: "Hay jugadores no disponibles o sin respuesta en la convocatoria que requieren confirmación.",
  CALLUP_NOT_ENABLED: "La convocatoria no está habilitada para este tipo de evento.",
  PLAYER_NOT_IN_TEAMSEASON: "El jugador no figura en la plantilla activa de este equipo.",
  PLAYER_CANNOT_ATTEND: "No es posible convocar a un jugador que ha indicado que no puede asistir.",
  SUBSTITUTE_NO_LONGER_ELIGIBLE: "El suplente seleccionado ya no está disponible.",
  ACTION_ITEM_NOT_OPEN: "Esta incidencia ya ha sido atendida o resuelta.",
  IDEMPOTENCY_CONFLICT: "Se ha detectado una solicitud duplicada con parámetros discordantes.",
  INTERNAL_SERVER_ERROR: "Error interno del servidor. Inténtalo de nuevo más tarde."
};

export function mapDomainError(err) {
  if (!err) return "Ha ocurrido un error inesperado.";
  if (err instanceof DomainError) {
    if (ERROR_MESSAGES[err.code]) {
      return ERROR_MESSAGES[err.code];
    }
    if (err.message && !err.message.startsWith("{") && !err.message.startsWith("[")) {
      return err.message;
    }
    return `Error de operación (${err.code}).`;
  }
  if (err.name === "TypeError" && err.message?.includes("fetch")) {
    return "Error de conexión con el servidor (127.0.0.1:3100). Verifica que el backend esté activo.";
  }
  return err.message || "Ha ocurrido un error de comunicación con el servidor.";
}
