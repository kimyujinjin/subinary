import type { CardSmsPosting } from "@family/contracts";

/** A parsed message is not evidence that a ledger transaction was committed. */
export interface PostingStatus {
  parseStatus: string;
  transactionType: string | null;
  posting?: CardSmsPosting;
}

type SmsPostingDisposition = "posted" | "needs_review" | "processing" | "not_applicable" | "unknown";

/** Preserve known waits/review on old APIs without guessing that parsed means unposted. */
export function shouldKeepUnpostedSummary(item: Pick<PostingStatus, "parseStatus" | "posting">): boolean {
  if (item.posting) return item.posting.status === "pending" || item.posting.status === "needs_review";
  return item.parseStatus === "pending" || item.parseStatus === "parse_failed"
    || item.parseStatus === "quarantined" || item.parseStatus === "pending_review";
}

/** Server posting state takes precedence over an older parsing projection. */
export function smsPostingDisposition(detail: PostingStatus): SmsPostingDisposition {
  const posting = detail.posting;
  if (posting?.status === "posted") return "posted";
  if (posting?.status === "not_applicable") return "not_applicable";
  if (posting?.status === "needs_review") return "needs_review";
  if (posting?.reason === "parse_failed" || posting?.reason === "quarantined") return "needs_review";
  if (posting?.reason === "declined" || posting?.reason === "ignored" || posting?.reason === "unsupported_message") return "not_applicable";
  if (posting?.status === "pending" && (posting.reason === "processing" || posting.reason === "parsing" || posting.reason === "fx_snapshot_missing")) return "processing";
  if (detail.parseStatus === "parse_failed" || detail.parseStatus === "quarantined" || detail.parseStatus === "pending_review") return "needs_review";
  if (detail.parseStatus === "ignored" || detail.transactionType === "declined") return "not_applicable";
  if (posting?.status === "pending" || detail.parseStatus === "pending") return "processing";
  return "unknown";
}

export function postingMessage(detail: PostingStatus | null): string {
  const posting = detail?.posting;
  if (posting?.status === "posted" && posting.transactionId) {
    if (posting.transactionStatus === "pending_review") {
      return "거래로 만들었지만 확인이 필요해요. 가계부에서 확인해 주세요.";
    }
    if (posting.transactionStatus === "duplicate_suspected") {
      return "중복 의심 거래예요. 가계부에서 확인해 주세요.";
    }
    return "거래에 반영됐어요.";
  }
  if (posting?.status === "posted") return "거래 반영 상태를 확인했어요.";
  if (detail && posting?.reason === "fx_snapshot_missing" && smsPostingDisposition(detail) === "processing") {
    return "그날 환율이 아직 없어 거래에 반영되지 않았어요. 다시 등록하지 않아도 돼요.";
  }
  if (detail && smsPostingDisposition(detail) === "needs_review" && detail.parseStatus !== "parse_failed") {
    return "거래 반영 전에 확인이 필요해요. 할 일에서 확인해 주세요.";
  }
  if (detail && smsPostingDisposition(detail) === "needs_review" && detail.parseStatus === "parse_failed") {
    return "자동으로 읽지 못했어요. 할 일에서 확인해 주세요.";
  }
  if (posting?.reason === "declined" || detail?.transactionType === "declined") {
    return "결제 실패 문자로 정리했어요. 지출에는 포함하지 않아요.";
  }
  if (posting?.reason === "ignored" || detail?.parseStatus === "ignored") {
    return "결제가 아닌 안내 문자라 반영하지 않았어요.";
  }
  if (posting?.reason === "unsupported_message") {
    return "거래로 반영할 수 없는 문자예요.";
  }
  if (detail && smsPostingDisposition(detail) === "processing") {
    return "거래에 반영하는 중이에요. 다시 등록하지 않아도 돼요.";
  }
  return "문자는 받았지만 거래 반영은 아직 확인되지 않았어요. 다시 등록하지 않아도 돼요.";
}

/**
 * 할 일 화면의 '확인할 문자' 줄 부제 — 그 화면에서 할 동작을 말한다.
 *
 * `postingMessage`는 문자를 붙여넣은 뒤처럼 할 일 화면 **밖**에서 쓰여 '할 일에서 확인해 주세요'로
 * 길을 알려 준다. 할 일 화면에서 같은 말을 하면 이미 와 있는 곳을 가리키게 된다(2026-11-05 HIG 검수).
 * 자동으로 읽지 못한 문자는 값이 비어 있어 직접 넣어야 하고, 읽어 둔 문자는 맞는지만 보면 된다.
 */
export function todoSmsTaskText(detail: PostingStatus): string {
  if (smsPostingDisposition(detail) !== "needs_review") return postingMessage(detail);
  return detail.parseStatus === "parse_failed" || detail.posting?.reason === "parse_failed"
    ? "받은 문자를 보고 금액·가맹점을 입력해 주세요"
    : "금액·가맹점이 맞는지 확인해 주세요";
}

export function postingConfirmed(detail: PostingStatus | null): boolean {
  return detail?.posting?.status === "posted" && Boolean(detail.posting.transactionId);
}

export function shouldPollPosting(detail: PostingStatus): boolean {
  if (!detail.posting) return detail.parseStatus === "pending";
  return smsPostingDisposition(detail) === "processing" && detail.posting.reason !== "fx_snapshot_missing";
}

/** Once accepted, a status-read failure must never turn into a second ingestion. */
export async function pollAcceptedPosting<T extends PostingStatus>(
  read: () => Promise<T>,
  wait: () => Promise<void>,
  attempts = 15,
): Promise<{ detail: T | null; statusUnavailable: boolean }> {
  let detail: T | null = null;
  try {
    detail = await read();
    for (let i = 0; i < attempts && shouldPollPosting(detail); i += 1) {
      await wait();
      detail = await read();
    }
    return { detail, statusUnavailable: false };
  } catch {
    return { detail: null, statusUnavailable: true };
  }
}
