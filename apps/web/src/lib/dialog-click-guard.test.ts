import { afterEach, describe, expect, it, vi } from "vitest";
import { guardRepeatedDialogClick } from "./dialog-click-guard";

function click(detail: number, clientX = 80, clientY = 680, type = "click") {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { detail: { value: detail }, clientX: { value: clientX }, clientY: { value: clientY } });
  return event;
}

describe("닫힌 대화상자의 반복 클릭", () => {
  afterEach(() => vi.useRealTimers());
  it("저장으로 대화상자가 없어져도 두 번째 클릭과 더블클릭의 아래 화면 동작을 막는다", () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    guardRepeatedDialogClick(target, { detail: 1, clientX: 80, clientY: 680 });
    const underlyingAction = vi.fn();
    target.addEventListener("click", underlyingAction);
    expect(target.dispatchEvent(click(2))).toBe(false);
    expect(target.dispatchEvent(click(2, 80, 680, "dblclick"))).toBe(false);
    expect(underlyingAction).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(target.dispatchEvent(click(2))).toBe(true);
    expect(underlyingAction).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("일반 클릭, 키보드, 다른 위치의 클릭은 즉시 사용할 수 있다", () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const remove = guardRepeatedDialogClick(target, { detail: 1, clientX: 80, clientY: 680 });
    for (const event of [click(1), click(0), click(2, 120, 680)]) expect(target.dispatchEvent(event)).toBe(true);
    remove(); remove();
    expect(target.dispatchEvent(click(2))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("키보드 활성화에는 전역 보호나 타이머를 만들지 않는다", () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    guardRepeatedDialogClick(target, { detail: 0, clientX: 0, clientY: 0 });
    expect(target.dispatchEvent(click(2, 0, 0))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
