import type { CardSmsPosting } from "@family/contracts";

/** A parsed message is not evidence that a ledger transaction was committed. */
export interface PostingStatus {
  parseStatus: string;
  transactionType: string | null;
  posting?: CardSmsPosting;
}

export type SmsPostingDisposition = "posted" | "needs_review" | "processing" | "not_applicable" | "unknown";

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
      return "거래가 만들어졌지만 확인이 필요해요. 가계부의 ‘확인이 필요한 거래’에서 확인해 주세요.";
    }
    if (posting.transactionStatus === "duplicate_suspected") {
      return "중복이 의심되는 거래예요. 가계부의 ‘확인이 필요한 거래’에서 확인해 주세요.";
    }
    return "거래에 반영됐어요.";
  }
  if (posting?.status === "posted") return "거래 반영 상태를 확인했어요.";
  if (detail && posting?.reason === "fx_snapshot_missing" && smsPostingDisposition(detail) === "processing") {
    return "문자는 인식했지만 해당 거래일의 환율이 없어 거래에 반영되지 않았어요. 환율 확보를 기다리는 처리 상태예요. 같은 문자를 다시 등록하지 않아도 돼요.";
  }
  if (detail && smsPostingDisposition(detail) === "needs_review" && detail.parseStatus !== "parse_failed") {
    return "거래 반영 전에 확인이 필요해요. 할 일에서 확인해 주세요.";
  }
  if (detail && smsPostingDisposition(detail) === "needs_review" && detail.parseStatus === "parse_failed") {
    return "문자는 접수했지만 자동으로 읽지 못했어요. 할 일에서 확인해 주세요. 같은 문자를 다시 등록하지 않아도 돼요.";
  }
  if (posting?.reason === "declined" || detail?.transactionType === "declined") {
    return "승인 거절 문자로 정리했어요. 지출에는 포함하지 않아요.";
  }
  if (posting?.reason === "ignored" || detail?.parseStatus === "ignored") {
    return "결제 내역이 아닌 안내 문자예요. 거래 금액에는 반영하지 않았어요.";
  }
  if (posting?.reason === "unsupported_message") {
    return "문자는 접수했지만 거래로 반영할 수 없는 유형이에요.";
  }
  if (detail && smsPostingDisposition(detail) === "processing") {
    return "문자는 접수됐고 거래 반영을 처리 중이에요. 사용자 확인이 필요한 거래와 별개의 상태예요. 같은 문자를 다시 등록하지 않아도 돼요.";
  }
  return "문자는 접수했지만 거래 반영은 아직 확인되지 않았어요. 다시 등록하지 말고 처리 상태를 확인해 주세요.";
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
