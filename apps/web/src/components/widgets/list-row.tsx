import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface ListRowProps {
  /** 좌측 원형 아이콘 내용(lucide 아이콘/이모지). 원형 배경은 자동. */
  icon?: ReactNode;
  /** 아이콘 원형 배경 클래스. */
  iconClassName?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 카드 식별 정보처럼 말줄임 대신 여러 줄을 써야 하는 부제의 스타일. */
  subtitleClassName?: string;
  /** 제목 굵기 등 덧씌우기(예: 알림함의 읽은 항목은 보통 굵기). */
  titleClassName?: string;
  /** 우측 주 값(보통 금액). */
  value?: ReactNode;
  /** 우측 보조(상태 배지/시각 등). */
  valueSub?: ReactNode;
  /** 클릭 가능 행(hover/눌림 피드백 + 커서). */
  onClick?: () => void;
  /**
   * 행 전체를 이 경로로 가는 링크로 만든다(보통 필터가 걸린 거래 목록).
   * `onClick`과 동시에 주지 않는다 — 링크가 우선한다.
   */
  href?: string;
  /** 클릭 가능한 행의 스크린리더 설명. */
  ariaLabel?: string;
  /** 우측 끝 chevron 표시. */
  chevron?: boolean;
  className?: string;
}

/**
 * 아이콘, 제목, 보조 정보와 값을 나란히 보여주는 목록 행.
 * [원형 아이콘] 제목/부제 ······ 값/보조 [›]
 *
 * 좁은 화면에서는 아이콘과 간격을 줄여 금액이 들어갈 자리를 확보한다.
 */
export function ListRow({
  icon,
  iconClassName,
  title,
  subtitle,
  subtitleClassName,
  value,
  valueSub,
  onClick,
  href,
  ariaLabel,
  chevron,
  className,
  titleClassName,
}: ListRowProps) {
  const interactive = href != null || onClick != null;
  const rowClass = cn(
    "flex min-h-16 w-full min-w-0 items-center gap-2.5 rounded-control px-1 py-3.5 text-left sm:gap-3 sm:px-2",
    interactive &&
      "hover:bg-muted/70 focus-visible:ring-ring cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    className,
  );

  const body = (
    <>
      {icon ? (
        <span
          className={cn(
            "bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-heading sm:size-10 [&_svg]:size-[18px] sm:[&_svg]:size-5",
            iconClassName,
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-body truncate font-semibold", titleClassName)} title={typeof title === "string" ? title : undefined}>{title}</span>
        {subtitle ? (
          <span className={cn("text-muted-foreground text-caption truncate", subtitleClassName)} title={typeof subtitle === "string" ? subtitle : undefined}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {value != null || valueSub != null ? (
        <span className="flex min-w-0 max-w-[58%] shrink-0 flex-col items-end gap-1 text-right [overflow-wrap:anywhere]">
          {value != null ? (
            <span className="text-body max-w-full font-semibold tabular-nums">
              {value}
            </span>
          ) : null}
          {valueSub != null ? (
            <span className="text-muted-foreground text-caption max-w-full">
              {valueSub}
            </span>
          ) : null}
        </span>
      ) : null}
      {chevron ? (
        <ChevronRight className="text-muted-foreground/50 hidden size-4 shrink-0 sm:block" aria-hidden="true" />
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={rowClass}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={rowClass}>
        {body}
      </button>
    );
  }
  return <div className={rowClass}>{body}</div>;
}
