import {
  housingBrandConnectionSchema,
  type HousingBrandConnection,
} from "@family/contracts";
import { ApiError } from "@/lib/api-client";

const FALLBACK =
  "수자인 조회를 끝내지 못했어요. 잠시 후 다시 눌러 주세요.";

/** Prefer the API public message over a hardcoded extra-auth hint. */
export function housingBrandSyncErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.message.trim()) return error.message;
  return FALLBACK;
}

/** Sync failures persist status on the connection; Nest may return it on the error body. */
export function connectionFromSyncError(error: unknown): HousingBrandConnection | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") {
    return null;
  }
  const parsed = housingBrandConnectionSchema.safeParse(
    (error.body as { connection?: unknown }).connection
  );
  return parsed.success ? parsed.data : null;
}
