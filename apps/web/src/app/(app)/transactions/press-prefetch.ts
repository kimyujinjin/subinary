/* ---------------------------------------------------------------------------
 * 누르려는 손가락에만 상세 미리 받기를 건다(2026-11-06 검토).
 *
 * 하위 데이터 미리 받기(detail-prefetch.ts)를 pointerdown에서 바로 시작하면, 목록이나 시트를 스크롤하려고 줄에
 * 댄 손가락마다 요청이 나갔다 — 플릭 한 번에 가맹점 검색 1건, 가족 공개면 확인 요청 1건, 중복 의심이면 짝 결제 1건.
 * 열지 않으면 받은 것은 쓰이지 않는다.
 *
 * 터치·펜은 잠깐(80ms) 기다렸다가 시작하고, 그 안에 손가락이 10px 넘게 움직이거나 브라우저가 스크롤을 가져가면
 * (Android는 팬이 시작되면 pointercancel을 보낸다) 버린다. 탭은 대개 80~150ms라 미리 받는 이득은 대부분 남는다.
 * 그보다 빨리 뗀 탭은 여기서 버리고, 손을 뗀 click에서 열기 대기(page.tsx openWhenReady)가 미리 받기를 다시 불러
 * 그 요청에 합친다. 마우스 누름은 스크롤을 시작하지 않으니 바로 시작한다.
 * ------------------------------------------------------------------------- */
import { useEffect, useState } from "react";

/** 터치·펜이 닿은 뒤 미리 받기를 시작하기까지 기다리는 시간. */
export const PRESS_PREFETCH_DELAY_MS = 80;

/** 누른 자리에서 이만큼 넘게 움직이면 누르기가 아니라 스크롤로 본다(px). */
export const PRESS_PREFETCH_SLOP_PX = 10;

/** 판단에 쓰는 포인터 값 — React의 PointerEvent에서 이것만 본다. */
export type PressPoint = Readonly<{
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
}>;

export type PressPrefetch = Readonly<{
  /** pointerdown — 마우스는 바로, 터치·펜은 `delayMs` 뒤에 `run`을 부른다. 앞서 기다리던 것은 버린다. */
  down: (point: PressPoint, run: () => void) => void;
  /** pointermove — 누른 자리에서 `slopPx` 넘게 움직였으면 버린다. */
  move: (point: PressPoint) => void;
  /** pointerup·pointercancel·pointerleave·화면을 떠날 때 — 아직 시작 전이면 버린다. */
  cancel: () => void;
}>;

/** 한 번에 하나만 기다린다 — 두 번째 손가락이 닿으면(핀치 등) 앞의 것도 버린다. */
export function createPressPrefetch(
  delayMs: number = PRESS_PREFETCH_DELAY_MS,
  slopPx: number = PRESS_PREFETCH_SLOP_PX
): PressPrefetch {
  let pending: {
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null = null;
  const cancel = () => {
    if (pending == null) return;
    clearTimeout(pending.timer);
    pending = null;
  };
  return {
    down(point, run) {
      cancel();
      if (!point.isPrimary) return;
      if (point.pointerType === "mouse") {
        run();
        return;
      }
      const timer = setTimeout(() => {
        pending = null;
        run();
      }, delayMs);
      pending = { timer, x: point.clientX, y: point.clientY };
    },
    move(point) {
      if (pending == null || !point.isPrimary) return;
      const dx = point.clientX - pending.x;
      const dy = point.clientY - pending.y;
      if (Math.hypot(dx, dy) > slopPx) cancel();
    },
    cancel,
  };
}

/** 컴포넌트마다 하나. 화면을 떠나면 기다리던 미리 받기를 버린다. 돌려주는 값은 바뀌지 않는다(memo 줄에 넘겨도 된다). */
export function usePressPrefetch(): PressPrefetch {
  const [press] = useState(() => createPressPrefetch());
  useEffect(() => () => press.cancel(), [press]);
  return press;
}

/** 줄 요소에 펼쳐 넣는 포인터 처리. `run`(미리 받기)은 누르려는 손가락일 때만 불린다. */
export function pressPrefetchHandlers(press: PressPrefetch, run: () => void) {
  return {
    onPointerDown: (event: PressPoint) => press.down(event, run),
    onPointerMove: (event: PressPoint) => press.move(event),
    onPointerUp: press.cancel,
    onPointerCancel: press.cancel,
    onPointerLeave: press.cancel,
  };
}
