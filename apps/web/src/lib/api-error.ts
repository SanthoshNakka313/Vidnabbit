import {
  API_ERROR_CODES,
  type ApiErrorCode,
  type ContractErrorCode,
} from "./api-types";

/** A typed API failure. Branch on `code`, never on `message`. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Seconds to wait before retrying, from a Retry-After header if present. */
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ApiErrorCode,
    message: string,
    status = 0,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isContractErrorCode(code: unknown): code is ContractErrorCode {
  return (
    typeof code === "string" &&
    (API_ERROR_CODES as readonly string[]).includes(code)
  );
}

