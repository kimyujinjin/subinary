"use client";
/**
 * 기기 종류 고르기 — 'Android · iPhone · 기타'를 접힌 선택칸 대신 한눈에 보이는 세그먼트로 둔다.
 *
 * 종류에 따라 설정 안내가 MacroDroid와 단축어로 갈리고 등록 뒤에는 바꿀 수 없어서, 접힌 Select에 묻혀
 * 기본값(예전엔 iOS) 그대로 등록되는 일이 잦았다(2026-11-05 HIG 검수). 고른 칸은 바탕·굵기로 보이고
 * (색에만 기대지 않는다) `role="radio"`·`aria-checked`로 읽힌다. 화살표 키로 옮겨 고를 수 있다.
 */
import type { KeyboardEvent } from "react";

import type { DevicePlatform } from "@family/contracts";

import { cn } from "@/lib/utils";

/** 플랫폼 표시 이름. 목록 줄의 '소유자 · Android · 마지막 문자…'에도 같은 말을 쓴다. */
export const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  android: "Android",
  ios: "iPhone",
  other: "기타",
};

const ORDER: readonly DevicePlatform[] = ["android", "ios", "other"];

export function PlatformSegment({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  value: DevicePlatform;
  onChange: (platform: DevicePlatform) => void;
  /** 이 묶음의 이름표 id(폼의 '기기 종류'). */
  labelledBy: string;
  disabled?: boolean;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      ORDER[(ORDER.indexOf(value) + step + ORDER.length) % ORDER.length];
    onChange(next);
    // 고른 칸으로 포커스를 옮긴다(라디오 묶음의 표준 동작).
    const group = event.currentTarget.parentElement;
    group
      ?.querySelector<HTMLButtonElement>(`[data-platform="${next}"]`)
      ?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="bg-muted grid grid-cols-3 gap-1 rounded-control p-1"
    >
      {ORDER.map((platform) => {
        const checked = platform === value;
        return (
          <button
            key={platform}
            type="button"
            role="radio"
            aria-checked={checked}
            data-platform={platform}
            // 고른 칸만 탭 순서에 둔다 — 나머지는 화살표로 옮긴다.
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(platform)}
            onKeyDown={onKeyDown}
            className={cn(
              "text-body focus-visible:ring-ring/50 min-h-11 rounded-control px-2 transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50",
              checked
                ? "bg-background text-foreground font-semibold shadow-sm"
                : "text-muted-foreground active:bg-background/60"
            )}
          >
            {PLATFORM_LABEL[platform]}
          </button>
        );
      })}
    </div>
  );
}
