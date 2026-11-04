"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * 화면의 주 행동 하나(거래 추가·예산 만들기)를 오른쪽 아래에 띄운다(§8 가계부).
 * 하단 탭바 위에 놓이고, 키보드가 열리면 탭바와 함께 숨는다.
 *
 * body로 포털한다 — 페이지 컨테이너의 `space-y-*`가 자식에 아래 여백을 붙여 화면마다 버튼이
 * 24px씩 어긋났다(2026-11-04, 자산 탭). 어떤 레이아웃에 넣어도 같은 자리에 있어야 한다.
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
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
    </button>,
    document.body
  );
}
