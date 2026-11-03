import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "ok" | "attention" | "error" | "pending";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  ok: "bg-success/15 text-success-strong dark:bg-success/25",
  attention: "bg-warning/15 text-warning-strong dark:bg-warning/25",
  error: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  pending: "bg-primary/10 text-primary dark:bg-primary/15",
};

/**
 * 상태는 문장이 아니라 칩으로 보여준다(docs/ux-renewal-2026-11.md §3.5).
 * 아이콘 단독 상태는 의미를 짐작하게 만들므로 항상 짧은 글자를 함께 쓴다.
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
        "text-micro inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 font-semibold whitespace-nowrap [&>svg]:size-3",
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
