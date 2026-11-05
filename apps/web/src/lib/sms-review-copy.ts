/* ---------------------------------------------------------------------------
 * 카드 문자 줄 문구 — 할 일 화면(/todo)과 문자 확인 창이 같이 쓴다.
 *
 * 2026-11-05 HIG 검수 3단계: 줄 제목이 '1661-7654에서 온 문자'처럼 번호뿐이었고, 처리 대기 줄은
 * 'USD · 3시간 전'이라 무엇을 기다리는지 알 수 없었다. 여기서는 지금 받는 데이터(발신 번호·문자에서
 * 읽은 카드사·반영 상태)만으로 말할 수 있는 만큼만 말한다 — 모르는 것은 지어내지 않는다.
 * ------------------------------------------------------------------------- */
import type {
  CardSmsEventSummary,
  CardSmsReviewGroup,
} from "@family/contracts";

import { formatSender } from "@/lib/format";
import { smsPostingDisposition } from "@/lib/sms-posting";

/**
 * 카드사·은행의 공개 대표 번호 → 이름. 대표 번호만 둔다 — 승인 문자를 다른 번호로 보내는 회사는
 * 표에 없으니 번호로 보인다(빠지는 쪽으로 틀린다). 이름을 틀리게 붙이면 다른 회사 문자로 읽혀
 * 번호를 그대로 보여 주는 것보다 나쁘다.
 */
const SENDER_NAMES: Readonly<Record<string, string>> = {
  "15447000": "신한카드",
  "15881688": "KB국민카드",
  "15888700": "삼성카드",
  "15776000": "현대카드",
  "15888100": "롯데카드",
  "18001111": "하나카드",
  "15889955": "우리카드",
  "15884000": "BC카드",
  "16444000": "NH농협카드",
  "16617654": "토스뱅크",
  "15993333": "카카오뱅크",
};

/** 발신 번호의 숫자만. '+82'로 시작하는 국제 표기와 'RCS 주소(번호@도메인)'도 받는다. */
function senderDigits(sender: string): string | null {
  const local = sender.split("@")[0] ?? "";
  if (!/^\+?[\d\s-]+$/.test(local)) return null;
  const digits = local.replace(/\D/g, "");
  // '+82 1588-1688'처럼 국가 번호가 붙은 대표 번호(8자리)
  return digits.length === 10 && digits.startsWith("82")
    ? digits.slice(2)
    : digits;
}

/** 문자에서 읽은 카드사 이름. 범용 파서는 카드사를 못 찾으면 '카드'를 넣는다 — 이름이 아니다. */
function issuerName(issuer: string | null | undefined): string | null {
  const name = issuer?.trim();
  if (!name || name === "카드" || name.length > 20) return null;
  return name;
}

/**
 * 문자를 보낸 곳의 이름. 대표 번호 표가 먼저다 — 문자 내용에서 읽은 카드사는 가맹점 이름에 든
 * 회사 이름('신한서적')을 잘못 잡을 수 있다. 둘 다 모르면 `null`.
 */
export function smsSourceName(
  sender: string,
  issuer?: string | null
): string | null {
  const digits = senderDigits(sender);
  return (digits ? SENDER_NAMES[digits] : undefined) ?? issuerName(issuer);
}

/** 문자 줄 제목: '신한카드 문자', 모르면 '1661-7654에서 온 문자'. */
export function smsSourceLabel(sender: string, issuer?: string | null): string {
  const name = smsSourceName(sender, issuer);
  return name ? `${name} 문자` : `${formatSender(sender)}에서 온 문자`;
}

/**
 * 같은 모양 문자 묶음에서 할 일. 자동으로 못 읽은 문자는 값이 비어 있어 직접 넣어야 하고,
 * 미리 읽어 둔 문자는 맞는지만 보면 된다.
 */
export function smsGroupTaskText(
  group: Pick<CardSmsReviewGroup, "parseFailed" | "quarantined">
): string {
  if (group.parseFailed > 0 && group.quarantined === 0) {
    return "받은 문자를 보고 금액·가맹점을 입력해 주세요";
  }
  if (group.quarantined > 0 && group.parseFailed === 0) {
    return "금액·가맹점이 맞는지 확인해 주세요";
  }
  return "금액·가맹점을 확인해 주세요";
}

/**
 * 반영을 기다리는 문자 줄 제목 — 무엇을 기다리는지 먼저 말한다. 시각은 부제로 보낸다.
 * 환율 대기는 그날 환율이 생길 때까지 멈춰 있고, 나머지는 자동으로 이어서 반영된다.
 */
export function smsWaitTitle(
  event: Pick<
    CardSmsEventSummary,
    "parseStatus" | "transactionType" | "posting" | "currency"
  >
): string {
  if (event.posting?.reason === "fx_snapshot_missing") {
    return `환율을 기다리는 중 · ${
      event.currency ? `${event.currency} 결제` : "외화 결제"
    }`;
  }
  return smsPostingDisposition(event) === "processing"
    ? "거래에 반영하는 중"
    : "반영 결과를 확인하는 중";
}

/**
 * 확인 창에 붙일 이유 한 줄. 서버의 판정 코드(영문)는 화면에 내지 않고, 사용자가 할 일이
 * 달라지는 것만 우리말로 옮긴다. 표에 없는 코드는 `null`(보여 주지 않는다).
 */
export function smsReviewReasonText(
  parseError: string | null | undefined
): string | null {
  if (!parseError) return null;
  if (parseError.includes("suspicious_content")) {
    return "평소 결제 문자와 다른 내용이 있어 바로 넣지 않았어요.";
  }
  if (parseError.includes("payment aggregator")) {
    return "간편결제 이름이 가맹점으로 들어갔을 수 있어요. 실제 가게 이름으로 고쳐 주세요.";
  }
  return null;
}
