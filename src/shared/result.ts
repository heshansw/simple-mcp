// Result type as a discriminated union
export type Result<T, E> = Ok<T> | Err<E>;

export type Ok<T> = {
  readonly _tag: "Ok";
  readonly value: T;
};

export type Err<E> = {
  readonly _tag: "Err";
  readonly error: E;
};

// Constructor functions
export function ok<T>(value: T): Ok<T> {
  return { _tag: "Ok", value };
}

export function err<E>(error: E): Err<E> {
  return { _tag: "Err", error };
}

// Type guards
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result._tag === "Ok";
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result._tag === "Err";
}

// Transformation helpers
export function mapResult<T, E, U>(
  result: Result<T, E>,
  f: (value: T) => U
): Result<U, E> {
  return isOk(result) ? ok(f(result.value)) : result;
}

export function mapError<T, E, F>(
  result: Result<T, E>,
  f: (error: E) => F
): Result<T, F> {
  return isErr(result) ? err(f(result.error)) : result;
}

// Domain error types with _tag discriminant
export type ValidationError = {
  readonly _tag: "ValidationError";
  readonly message: string;
  readonly details: Record<string, string> | undefined;
};

export type NotFoundError = {
  readonly _tag: "NotFoundError";
  readonly resource: string;
  readonly id: string;
};

export type AuthorizationError = {
  readonly _tag: "AuthorizationError";
  readonly message: string;
  readonly resource: string | undefined;
};

export type IntegrationError = {
  readonly _tag: "IntegrationError";
  readonly integration: string;
  readonly message: string;
  readonly statusCode: number | undefined;
};

export type DatabaseError = {
  readonly _tag: "DatabaseError";
  readonly message: string;
  readonly operation: string | undefined;
};

// Union of all domain errors
export type DomainError =
  | ValidationError
  | NotFoundError
  | AuthorizationError
  | IntegrationError
  | DatabaseError;

// Constructor functions for domain errors
export function validationError(
  message: string,
  details?: Record<string, string>
): ValidationError {
  return { _tag: "ValidationError", message, details: details ?? undefined };
}

export function notFoundError(
  resource: string,
  id: string
): NotFoundError {
  return { _tag: "NotFoundError", resource, id };
}

export function authorizationError(
  message: string,
  resource?: string
): AuthorizationError {
  return { _tag: "AuthorizationError", message, resource: resource ?? undefined };
}

export function integrationError(
  integration: string,
  message: string,
  statusCode?: number
): IntegrationError {
  return { _tag: "IntegrationError", integration, message, statusCode: statusCode ?? undefined };
}

export function databaseError(
  message: string,
  operation?: string
): DatabaseError {
  return { _tag: "DatabaseError", message, operation: operation ?? undefined };
}

/** Extract a human-readable message from any DomainError variant */
export function domainErrorMessage(error: DomainError): string {
  switch (error._tag) {
    case "ValidationError":
      return error.message;
    case "NotFoundError":
      return `${error.resource} not found: ${error.id}`;
    case "AuthorizationError":
      return error.message;
    case "IntegrationError":
      return error.message;
    case "DatabaseError":
      return error.message;
    default: {
      const _exhaustive: never = error;
      return String(_exhaustive);
    }
  }
}
