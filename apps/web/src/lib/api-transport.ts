import { ApiError, decodeApiResponse, type ResponseSchema } from "./api-response";

type Options<T> = { init?: RequestInit | undefined; getToken: () => Promise<string | null>; schema?: ResponseSchema<T> | undefined; allowStatuses?: number[] | undefined; timeoutMs?: number };

/** Bound the complete request, including session lookup and JSON body reads, not just response headers. */
export async function requestJson<T>(url: string, options: Options<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new ApiError({ code: "REQUEST_TIMEOUT", title: "Service taking too long", message: "The request did not finish in time. Please retry in a moment.", retryable: true, correlationId: "client" }, 0);
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(timeoutError); }, options.timeoutMs ?? 20_000);
  });
  const operation = (async () => {
    try {
      const token = await options.getToken();
      // A session lookup can complete after the deadline. Never send a late private request.
      if (controller.signal.aborted || options.init?.signal?.aborted) throw timeoutError;
      const signal = options.init?.signal ? AbortSignal.any([controller.signal, options.init.signal]) : controller.signal;
      const response = await fetch(url, {
        ...options.init,
        signal,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.init?.headers ?? {}) },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) throw timeoutError;
      return decodeApiResponse(payload, response.status, options.schema, options.allowStatuses);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw timeoutError;
      throw new ApiError({ code: "NETWORK_ERROR", title: "Service unreachable", message: "The investigation service could not be reached. Please try again shortly.", retryable: true, correlationId: "client" }, 0);
    }
  })();
  try { return await Promise.race([operation, deadline]); }
  finally { clearTimeout(timer!); }
}
