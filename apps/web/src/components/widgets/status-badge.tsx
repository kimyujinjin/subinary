import type { ReactNode } from "react";

import { StatusChip, type ChipTone } from "./status-chip";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * tone → StatusChip 색조. 예전에는 꽉 찬 Badge로 그려 같은 상태가 목록(칩)과 상세(배지)에서
 * 다른 모양·다른 띄어쓰기로 보였다(2026-11-05 HIG 검수) — 상태 표시는 StatusChip 하나로 그린다.
 */
const TONE_CHIP: Record<BadgeTone, ChipTone> = {
  neutral: "neutral",
  success: "ok",
  warning: "attention",
  danger: "error",
  info: "pending",
};

/** 상태값 → 색조(거래/카드/장치/초대/멤버 상태 공용). */
const STATUS_TONES: Record<string, BadgeTone> = {
  approved: "success",
  partially_cancelled: "warning",
  cancelled: "neutral",
  pending_review: "warning",
  duplicate_suspected: "danger",
  active: "success",
  inactive: "neutral",
  revoked: "danger",
  removed: "neutral",
  pending: "info",
  accepted: "success",
  expired: "neutral",
  ignored: "neutral",
};

/** 상태값 → 한국어 라벨. 띄어쓰기는 맞춤법대로(가계부 목록의 상태 칩과 같은 글자). */
const STATUS_LABELS: Record<string, string> = {
  approved: "승인",
  partially_cancelled: "부분 취소",
  cancelled: "취소",
  pending_review: "확인 필요",
  duplicate_suspected: "중복 의심",
  active: "활성",
  inactive: "비활성",
  revoked: "폐기",
  removed: "제거됨",
  pending: "대기 중",
  accepted: "수락됨",
  expired: "만료",
  ignored: "결제 내역 아님",
};

interface StatusBadgeProps {
  status: string;
  /** 라벨 오버라이드(미지정 시 매핑/원문). */
  label?: ReactNode;
  /** 색조 오버라이드(미지정 시 매핑/neutral). */
  tone?: BadgeTone;
}

/** 상태 배지. 알려진 상태는 라벨/색조를 자동 매핑한다. */
export function StatusBadge({ status, label, tone }: StatusBadgeProps) {
  // 기본 상태(승인·활성)는 표시하지 않는다(§5) — 모든 행에 붙으면 아무것도 말하지 않는다.
  // 라벨을 명시해 부른 곳(정기 결제 등)은 그대로 보여준다.
  if (label === undefined && (status === "approved" || status === "active")) return null;
  const resolvedTone = tone ?? STATUS_TONES[status] ?? "neutral";
  const resolvedLabel = label ?? STATUS_LABELS[status] ?? status;
  return <StatusChip tone={TONE_CHIP[resolvedTone]}>{resolvedLabel}</StatusChip>;
}
