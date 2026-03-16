import { createMiddleware } from "hono/factory";
import pino from "pino";
import type { DomainError } from "@shared/result.js";

export interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, string[]>;
  };
}

function mapDomainErrorToStatus(error: DomainError): number {
  switch (error._tag) {
    case "ValidationError":
      return 400;
    case "NotFoundError":
      return 404;
    case "AuthorizationError":
      return 401;
    case "IntegrationError":
      return 502;
    case "DatabaseError":
      return 500;
    default:
      const _exhaustive: never = error;
      return _exhaustive;
  }
}

function mapDomainErrorToCode(error: DomainError): string {
  switch (error._tag) {
    case "ValidationError":
      return "VALIDATION_ERROR";
    case "NotFoundError":
      return "NOT_FOUND";
    case "AuthorizationError":
      return "UNAUTHORIZED";
    case "IntegrationError":
      return "INTEGRATION_ERROR";
    case "DatabaseError":
      return "DATABASE_ERROR";
    default:
      const _exhaustive: never = error;
      return _exhaustive;
  }
}

function isDomainError(error: unknown): error is DomainError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof (error as Record<string, unknown>)._tag === "string"
  );
}

export function errorHandlerMiddleware(logger: pino.Logger) {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } catch (error) {
      const isProduction = process.env.NODE_ENV === "production";

      if (isDomainError(error)) {
        const status = mapDomainErrorToStatus(error);
        const code = mapDomainErrorToCode(error);

        logger.warn(
          {
            status,
            code,
            tag: error._tag,
          },
          `Domain error: ${error._tag}`
        );

        let message: string;
        let details: Record<string, string[]> | undefined;

        switch (error._tag) {
          case "ValidationError":
            message = error.message;
            details = error.details ? { validation: [Object.entries(error.details).map(([k, v]) => `${k}: ${v}`).join(", ")] } : undefined;
            break;
          case "NotFoundError":
            message = `${error.resource} not found: ${error.id}`;
            break;
          case "AuthorizationError":
            message = error.message;
            break;
          case "IntegrationError":
            message = error.message;
            break;
          case "DatabaseError":
            message = error.message;
            break;
          default:
            const _exhaustive: never = error;
            return _exhaustive;
        }

        const response: ErrorResponse = {
          error: {
            code,
            message,
            ...(details && { details }),
          },
        };

        return c.json(response, status as 400 | 401 | 404 | 500 | 502);
      }

      // Unexpected error
      const status = 500;
      const errorMessage =
        error instanceof Error ? error.message : "Internal server error";

      if (!isProduction) {
        logger.error(
          {
            status,
            stack: error instanceof Error ? error.stack : undefined,
          },
          `Unexpected error: ${errorMessage}`
        );
      } else {
        logger.error({ status }, "Unexpected error occurred");
      }

      const response: ErrorResponse = {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: isProduction
            ? "Internal server error"
            : errorMessage,
        },
      };

      return c.json(response, status);
    }
  });
}
