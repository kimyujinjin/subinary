"use client";

import { useRef, type PointerEvent, type RefObject } from "react";

import { cn } from "@/lib/utils";

/** 이 거리(px)와 시트 높이의 1/4 중 작은 값 이상 끌어내리면 닫는다. */
const DISMISS_DISTANCE_PX = 120;
/** 빠르게 튕겨 내리면(px/ms) 거리가 짧아도 닫는다. 손 떨림으로 닫히지 않게 최소 거리를 둔다. */
const FLICK_VELOCITY = 0.5;
const FLICK_MIN_PX = 24;

/** 손잡이를 놓았을 때 시트를 닫을지 정한다. */
export function shouldDismissSheet(
  dragPx: number,
  elapsedMs: number,
  sheetHeightPx: number
): boolean {
  if (dragPx <= 0) return false;
  if (dragPx >= Math.min(DISMISS_DISTANCE_PX, sheetHeightPx / 4)) return true;
  return (
    dragPx >= FLICK_MIN_PX && dragPx / Math.max(elapsedMs, 1) >= FLICK_VELOCITY
  );
}

/**
 * 시트 위쪽 손잡이(2026-11-05 사용자 결정). 아래로 끌면 시트가 따라 내려오고, 충분히 내리면
 * `closeRef`(시트의 닫기 버튼)를 눌러 닫는다. 닫기 버튼을 거치므로 화면의 닫기 처리(저장 안 한
 * 수정 확인 등)가 그대로 돈다. 화면이 닫기를 막으면 시트를 제자리로 돌린다.
 * 장식이라 스크린리더에서는 숨긴다 — 닫기 버튼·Esc·바깥 누르기로도 닫힌다.
 */
export function SheetHandle({
  sheetRef,
  closeRef,
  className,
}: {
  sheetRef: RefObject<HTMLElement | null>;
  closeRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startTime: number;
  } | null>(null);

  const follow = (dy: number, animate: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = animate ? "transform 200ms ease-out" : "none";
    sheet.style.transform = dy > 0 ? `translate3d(0, ${dy}px, 0)` : "";
  };

  const release = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    const sheet = sheetRef.current;
    const dy = Math.max(0, event.clientY - current.startY);
    if (
      !cancelled &&
      sheet &&
      shouldDismissSheet(
        dy,
        event.timeStamp - current.startTime,
        sheet.offsetHeight
      )
    ) {
      closeRef.current?.click();
      requestAnimationFrame(() => {
        if (sheet.dataset.state === "open") follow(0, true);
      });
      return;
    }
    follow(0, true);
  };

  return (
    <div
      aria-hidden="true"
      data-sheet-handle=""
      className={cn(
        "flex h-7 w-28 shrink-0 cursor-grab touch-none items-start justify-center pt-2 active:cursor-grabbing",
        className
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startTime: event.timeStamp,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current && current.pointerId === event.pointerId) {
          follow(Math.max(0, event.clientY - current.startY), false);
        }
      }}
      onPointerUp={(event) => release(event, false)}
      onPointerCancel={(event) => release(event, true)}
    >
      <span className="bg-muted-foreground/30 h-1 w-9 rounded-full" />
    </div>
  );
}
