import { afterEach, describe, expect, it, vi } from "vitest";
import { investigationResponseSchema, repositoryEntrySchema, type InvestigationResponse } from "../packages/contracts/src/index";
import { assessMessage } from "../packages/analysis/src/assess";
import { ApiError, decodeApiResponse } from "../apps/web/src/lib/api-response";
import { cachedReport } from "../apps/web/src/lib/history";

const report: InvestigationResponse = {
  report: assessMessage({ reportId: "00000000-0000-4000-8000-000000000001", createdAt: "2026-11-08T00:00:00.000Z", text: "Your meeting begins tomorrow." }),
  registry: { status: "unregistered", chainId: null, contractAddress: null, registryKey: null, commitment: null, parentKey: null, transactionHash: null, blockNumber: null, registeredAt: null, error: null },
  publishedToRepository: false,
};
const serviceError = { code: "SCANNER_NOT_CONFIGURED", title: "Scanner unavailable", message: "The scanner is not configured.", retryable: true, correlationId: "test" };

afterEach(() => vi.unstubAllGlobals());

describe("Seal response boundary", () => {
  it("keeps a gateway 503 out of report state, so retry can use the original report", () => {
    let current = report;
    expect(() => {
      current = decodeApiResponse(serviceError, 503, investigationResponseSchema, [503]);
    }).toThrow(ApiError);
    expect(current).toBe(report);
    expect(() => decodeApiResponse(serviceError, 503, investigationResponseSchema, [503])).toThrow(serviceError.message);
  });

  it.each([200, 503])("rejects empty, HTML and incomplete HTTP %i responses", (status) => {
    for (const payload of [null, "<html>Unavailable</html>", {}, { report: {} }, { ...report, registry: null }, { code: { unsafe: true } }]) {
      try {
        decodeApiResponse(payload, status, investigationResponseSchema, [503]);
        expect.fail("Malformed data must not replace report state");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).error.code).toBe("UNEXPECTED_RESPONSE");
      }
    }
  });

  it("accepts valid failed receipts on 503 and confirmed receipts on 200", () => {
    const failed = { ...report, registry: { ...report.registry, status: "failed", error: "Registration could not finish." } };
    expect(decodeApiResponse(failed, 503, investigationResponseSchema, [503])).toEqual(failed);
    const confirmed = { ...report, registry: { ...report.registry, status: "confirmed", chainId: 11155111, transactionHash: "0x" + "a".repeat(64) } };
    expect(decodeApiResponse(confirmed, 200, investigationResponseSchema)).toEqual(confirmed);
    expect(() => decodeApiResponse(failed, 502, investigationResponseSchema, [503])).toThrow(ApiError);
  });

  it("preserves publication review errors for the explicit confirmation screen", () => {
    const error = { ...serviceError, code: "PUBLICATION_CONFIRMATION_REQUIRED", review: { available: true, authentic: true, important: false, reason: "Review before sharing." } };
    try {
      decodeApiResponse(error, 409, investigationResponseSchema, [503]);
      expect.fail("Review must require confirmation");
    } catch (caught) {
      expect((caught as ApiError).error).toEqual(error);
    }
  });

  it("also rejects gateway errors on repository statement requests", () => {
    expect(() => decodeApiResponse(serviceError, 503, repositoryEntrySchema, [503])).toThrow(ApiError);
    expect(() => decodeApiResponse(null, 503, repositoryEntrySchema, [503])).toThrow(ApiError);
  });

  it("ignores invalid cached reports instead of rendering them after a reload", () => {
    const removeItem = vi.fn();
    const getItem = vi.fn();
    vi.stubGlobal("window", { sessionStorage: { getItem, removeItem } });
    getItem.mockReturnValue(JSON.stringify(report));
    expect(cachedReport(report.report.reportId)).toEqual(report);
    getItem.mockReturnValue(JSON.stringify(serviceError));
    expect(cachedReport(report.report.reportId)).toBeNull();
    expect(removeItem).toHaveBeenCalledWith(`veriq.report.${report.report.reportId}`);
    getItem.mockReturnValue("{broken");
    expect(cachedReport(report.report.reportId)).toBeNull();
  });
});
