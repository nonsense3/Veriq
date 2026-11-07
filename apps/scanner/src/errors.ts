export type PublicationReview = { available: boolean; authentic: boolean; important: boolean; reason: string };

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    readonly code: string,
    readonly title: string,
    message: string,
    readonly retryable = false,
    readonly review?: PublicationReview,
  ) {
    super(message);
  }
}

/** Thrown when a destination violates the network policy (private address, forbidden port, unsupported scheme). */
export class PolicyBlockedError extends Error {
  readonly code = "DESTINATION_BLOCKED";
}
