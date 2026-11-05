import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "ok" | "attention" | "error" | "pending";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  ok: "bg-success/15 text-success-strong dark:bg-success/25",
  // 라이트 배경을 /15로 두면 글자 대비가 4.45:1로 AA(4.5)에 모자라 /10으로 옅게 했다(widget-contrast.test.tsx가 고정).
  attention: "bg-warning/10 text-warning-strong dark:bg-warning/25",
  error: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  pending: "bg-primary/10 text-primary dark:bg-primary/15",
};

/**
 * 상태는 문장이 아니라 칩으로 보여준다(docs/ux-renewal-2026-11.md §3.5).
 * 아이콘 단독 상태는 의미를 짐작하게 만들므로 항상 짧은 글자를 함께 쓴다.
 * 높이는 최소값(min-h-5)만 둔다 — 고정 높이면 시스템 글자를 키웠을 때 글자가 칩 밖으로 넘친다.
 */
export function StatusChip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-micro inline-flex min-h-5 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap [&>svg]:size-3",
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
