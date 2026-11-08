import type {
  CorrelationCluster,
  InvestigationRequest,
  InvestigationResponse,
  MyInvestigationsResponse,
  RepositoryEntry,
  ServiceConfig,
  StatementRequest,
  VerificationBundle,
  RegistrationPlan,
} from "@veriq/contracts";
import { accessToken } from "./auth";
import { investigationResponseSchema, myInvestigationsResponseSchema, registrationPlanSchema, repositoryEntrySchema, serviceConfigSchema } from "@veriq/contracts";
import type { ResponseSchema } from "./api-response";
import { requestJson } from "./api-transport";
export { ApiError } from "./api-response";

/** Local dev talks to the scanner directly. A deployed site uses the same origin, so no public API URL is baked in. */
function apiBase(): string {
  if (typeof window === "undefined") return "http://localhost:8788";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8788";
  return "";
}

async function request<T>(path: string, init?: RequestInit & { allowStatuses?: number[] }, schema?: ResponseSchema<T>): Promise<T> {
  const { allowStatuses, ...fetchInit } = init ?? {};
  return requestJson(`${apiBase()}${path}`, { init: fetchInit, getToken: accessToken, schema, allowStatuses, timeoutMs: init?.method === "POST" ? 100_000 : 20_000 });
}

export const api = {
  config: () => request<ServiceConfig>("/v1/config", undefined, serviceConfigSchema),
  investigate: (body: InvestigationRequest) => request<InvestigationResponse>("/v1/investigations", { method: "POST", body: JSON.stringify(body) }, investigationResponseSchema),
  report: (id: string) => request<InvestigationResponse>(`/v1/investigations/${encodeURIComponent(id)}`, undefined, investigationResponseSchema),
  registrationPlan: (id: string) => request<RegistrationPlan>(`/v1/investigations/${encodeURIComponent(id)}/registration`, undefined, registrationPlanSchema),
  register: (id: string, body: { publishToRepository: boolean; note?: string; confirmPublication?: boolean; transactionHash?: string }) =>
    request<InvestigationResponse>(`/v1/investigations/${encodeURIComponent(id)}/register`, { method: "POST", body: JSON.stringify(body), allowStatuses: [503] }, investigationResponseSchema),
  bundle: (id: string) => request<VerificationBundle>(`/v1/investigations/${encodeURIComponent(id)}/bundle`),
  repository: () => request<{ entries: RepositoryEntry[]; clusters: CorrelationCluster[] }>("/v1/repository"),
  statement: (publicId: string, body: StatementRequest) =>
    request<RepositoryEntry>(`/v1/repository/${encodeURIComponent(publicId)}/statements`, { method: "POST", body: JSON.stringify(body), allowStatuses: [503] }, repositoryEntrySchema),
  mine: (signal?: AbortSignal) => request<MyInvestigationsResponse>("/v1/me/investigations", signal ? { signal } : undefined, myInvestigationsResponseSchema),
  forgetMe: () => request<{ deleted: number; detached: number }>("/v1/me", { method: "DELETE" }),
};
