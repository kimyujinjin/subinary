import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * 섹션 머리 한 가지 형식: 제목(heading) + 오른쪽 텍스트 행동(§5).
 * 설명 문단은 받지 않는다 — 필요하면 화면이 아니라 `자세히` 시트로 보낸다.
 */
export function SectionHeader({
  title,
  actionLabel,
  actionHref,
  onAction,
  trailing,
  className,
  as: Heading = "h2",
}: {
  title: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  /** 텍스트 행동 대신 오른쪽에 둘 요소(소계·칩 등). */
  trailing?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  const actionClass =
    "text-caption text-muted-foreground hover:text-foreground -mr-2 inline-flex min-h-11 items-center px-2 font-medium";
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between gap-3",
        className
      )}
    >
      <Heading className="text-heading min-w-0 truncate">{title}</Heading>
      {actionLabel && actionHref ? (
        <Link href={actionHref} className={actionClass}>
          {actionLabel}
        </Link>
      ) : actionLabel && onAction ? (
        <button type="button" onClick={onAction} className={actionClass}>
          {actionLabel}
        </button>
      ) : (
        trailing
      )}
    </div>
  );
}
