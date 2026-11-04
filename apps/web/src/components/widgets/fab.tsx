"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 화면의 주 행동 하나(거래 추가·예산 만들기)를 오른쪽 아래에 띄운다(§8 가계부).
 * 하단 탭바 위에 놓이고, 키보드가 열리면 탭바와 함께 숨는다.
 */
export function Fab({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
    {/* 목록 마지막 줄이 버튼에 가리지 않게 버튼 높이만큼 비운다. */}
    <div aria-hidden="true" className="order-last h-16 shrink-0 lg:hidden" />
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-fab
      className={cn(
        "bg-primary text-primary-foreground fixed right-5 z-30 flex size-14 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 [&_svg]:size-6",
        "bottom-[calc(var(--app-tabbar-h)+1rem)] lg:right-8 lg:bottom-8",
        className
      )}
    >
      {children}
    </button>
    </>
  );
}
