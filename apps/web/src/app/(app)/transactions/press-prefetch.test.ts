/**
 * 누르려는 손가락에만 상세 미리 받기를 건다(2026-11-06 검토: pointerdown에서 바로 받아, 스크롤하려고 줄에 댄
 * 손가락마다 요청이 나갔다). 시간은 가짜 타이머로 움직인다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRESS_PREFETCH_DELAY_MS,
  PRESS_PREFETCH_SLOP_PX,
  createPressPrefetch,
  pressPrefetchHandlers,
  type PressPoint,
} from "./press-prefetch";

const touch = (x = 100, y = 300, isPrimary = true): PressPoint => ({
  pointerType: "touch",
  isPrimary,
  clientX: x,
  clientY: y,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPressPrefetch", () => {
  it("터치는 잠깐 기다렸다가 받기 시작한다 — 가만히 누르고 있는 손가락은 누르려는 것이다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    createPressPrefetch().down(touch(), run);
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("브라우저가 스크롤을 가져가면(pointercancel) 받지 않는다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const press = createPressPrefetch();
    press.down(touch(), run);
    vi.advanceTimersByTime(40);
    press.cancel();
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS * 4);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("손가락이 10px 넘게 움직이면 스크롤로 보고 받지 않는다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const press = createPressPrefetch();
    press.down(touch(100, 300), run);
    press.move(touch(100, 300 - PRESS_PREFETCH_SLOP_PX - 1));
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS * 4);
    expect(run).not.toHaveBeenCalled();
  });

  it("손가락이 조금 떨리는 것(10px 이내)은 누르기로 본다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const press = createPressPrefetch();
    press.down(touch(100, 300), run);
    press.move(touch(106, 292));
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("빨리 뗀 탭은 여기서 받지 않는다 — 손을 뗀 click의 열기 대기가 받는다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const press = createPressPrefetch();
    press.down(touch(), run);
    vi.advanceTimersByTime(30);
    // pointerup
    press.cancel();
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    expect(run).not.toHaveBeenCalled();
  });

  it("마우스 누름은 스크롤을 시작하지 않으니 바로 받는다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    createPressPrefetch().down({ ...touch(), pointerType: "mouse" }, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("펜은 터치처럼 기다린다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    createPressPrefetch().down({ ...touch(), pointerType: "pen" }, run);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("두 번째 손가락(핀치 등)이 닿으면 앞의 것도 버리고 받지 않는다", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const press = createPressPrefetch();
    press.down(touch(100, 300), first);
    press.down(touch(200, 400, false), second);
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS * 4);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("다른 줄을 새로 누르면 마지막 줄만 받는다", () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const press = createPressPrefetch();
    press.down(touch(100, 300), first);
    vi.advanceTimersByTime(20);
    press.down(touch(100, 500), second);
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("플릭 스무 번(대고 바로 밀기)에 요청은 한 번도 나가지 않는다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const press = createPressPrefetch();
    for (let i = 0; i < 20; i += 1) {
      press.down(touch(100, 600), run);
      vi.advanceTimersByTime(16);
      press.move(touch(100, 580));
      press.cancel();
      vi.advanceTimersByTime(300);
    }
    expect(run).not.toHaveBeenCalled();
  });
});

describe("pressPrefetchHandlers", () => {
  it("줄 요소의 포인터 처리로 펼쳐 넣는다 — 떼기·취소·벗어남은 모두 기다리던 것을 버린다", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const handlers = pressPrefetchHandlers(createPressPrefetch(), run);
    for (const end of [
      handlers.onPointerUp,
      handlers.onPointerCancel,
      handlers.onPointerLeave,
    ]) {
      handlers.onPointerDown(touch());
      end();
      vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    }
    expect(run).not.toHaveBeenCalled();

    handlers.onPointerDown(touch(100, 300));
    handlers.onPointerMove(touch(100, 260));
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    expect(run).not.toHaveBeenCalled();

    handlers.onPointerDown(touch());
    vi.advanceTimersByTime(PRESS_PREFETCH_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
