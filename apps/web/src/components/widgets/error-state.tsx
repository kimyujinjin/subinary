"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** 무엇을 못 했는지 한 줄(예: "알림 설정을 불러오지 못했어요"). */
  message: string;
  /** '다시 불러오기'를 누르면 부른다(보통 `query.refetch()`). */
  onRetry: () => void;
  /** 다시 불러오는 중이면 버튼을 잠근다 — 연타로 같은 요청이 겹치지 않게. */
  retrying?: boolean;
  /**
   * center: 목록·화면 자리를 통째로 대신할 때(빈 상태와 같은 자리).
   * start: 페이지 머리 아래 짧은 블록일 때.
   */
  align?: "center" | "start";
  className?: string;
}

/**
 * 불러오기 실패 — 원인 한 줄 + '다시 불러오기' 약한 버튼.
 *
 * 화면마다 `EmptyState`를 `role="alert"`로 감싸거나 문단 + 버튼을 따로 짜면서 버튼 이름('다시 시도'·
 * '다시 불러오기')과 정렬이 달랐다. 화면의 채움 버튼 자리를 빼앗지 않도록 버튼은 약한(weak) 모양이다.
 */
export function ErrorState({
  message,
  onRetry,
  retrying = false,
  align = "center",
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        align === "center" ? "items-center py-10 text-center" : "items-start",
        className
      )}
    >
      <p role="alert" className="text-body text-destructive">
        {message}
      </p>
      <Button
        type="button"
        variant="weak"
        className={align === "center" ? "w-full max-w-60" : undefined}
        disabled={retrying}
        aria-busy={retrying || undefined}
        onClick={onRetry}
      >
        다시 불러오기
      </Button>
    </div>
  );
}
