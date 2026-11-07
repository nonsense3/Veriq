import type {
  CorrelationCluster,
  InvestigationRequest,
  InvestigationResponse,
  MyInvestigationsResponse,
  RepositoryEntry,
  ServiceConfig,
  StatementRequest,
  VerificationBundle,
} from "@veriq/contracts";
import { accessToken } from "./auth";
import { investigationResponseSchema, repositoryEntrySchema } from "@veriq/contracts";
import { ApiError, decodeApiResponse, type ResponseSchema } from "./api-response";
export { ApiError } from "./api-response";

/** Local dev talks to the scanner directly. A deployed site uses the same origin, so no public API URL is baked in. */
function apiBase(): string {
  if (typeof window === "undefined") return "http://localhost:8788";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8788";
  return "";
}

async function request<T>(path: string, init?: RequestInit & { allowStatuses?: number[] }, schema?: ResponseSchema<T>): Promise<T> {
  const token = await accessToken();
  const { allowStatuses, ...fetchInit } = init ?? {};
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...fetchInit,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError({ code: "NETWORK_ERROR", title: "Service unreachable", message: "Veriq's investigation service did not respond. Check that it is running and try again.", retryable: true, correlationId: "client" }, 0);
  }
  const payload: unknown = await response.json().catch(() => null);
  return decodeApiResponse(payload, response.status, schema, allowStatuses);
}

export const api = {
  config: () => request<ServiceConfig>("/v1/config"),
  investigate: (body: InvestigationRequest) => request<InvestigationResponse>("/v1/investigations", { method: "POST", body: JSON.stringify(body) }, investigationResponseSchema),
  report: (id: string) => request<InvestigationResponse>(`/v1/investigations/${encodeURIComponent(id)}`, undefined, investigationResponseSchema),
  register: (id: string, body: { publishToRepository: boolean; note?: string; confirmPublication?: boolean }) =>
    request<InvestigationResponse>(`/v1/investigations/${encodeURIComponent(id)}/register`, { method: "POST", body: JSON.stringify(body), allowStatuses: [503] }, investigationResponseSchema),
  bundle: (id: string) => request<VerificationBundle>(`/v1/investigations/${encodeURIComponent(id)}/bundle`),
  repository: () => request<{ entries: RepositoryEntry[]; clusters: CorrelationCluster[] }>("/v1/repository"),
  statement: (publicId: string, body: StatementRequest) =>
    request<RepositoryEntry>(`/v1/repository/${encodeURIComponent(publicId)}/statements`, { method: "POST", body: JSON.stringify(body), allowStatuses: [503] }, repositoryEntrySchema),
  mine: () => request<MyInvestigationsResponse>("/v1/me/investigations"),
  forgetMe: () => request<{ deleted: number; detached: number }>("/v1/me", { method: "DELETE" }),
};
