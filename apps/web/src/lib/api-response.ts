import { publicErrorSchema, type PublicError } from "@veriq/contracts";

export class ApiError extends Error {
  constructor(readonly error: PublicError, readonly status: number) {
    super(error.message);
  }
}

export type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

/** A 503 can contain a failed registry receipt, but a gateway error is never a report. */
export function decodeApiResponse<T>(payload: unknown, status: number, schema?: ResponseSchema<T>, allowStatuses: readonly number[] = []): T {
  const publicError = publicErrorSchema.safeParse(payload);
  if (publicError.success) throw new ApiError(publicError.data, status);

  const ok = status >= 200 && status < 300;
  if (ok || (schema && allowStatuses.includes(status))) {
    if (!schema) return payload as T;
    const parsed = schema.safeParse(payload);
    if (parsed.success) return parsed.data;
  }

  throw new ApiError({
    code: "UNEXPECTED_RESPONSE",
    title: "Unexpected service response",
    message: "The service returned an unexpected response. Your existing report is still available. Please try again later.",
    retryable: true,
    correlationId: "client",
  }, status);
}
