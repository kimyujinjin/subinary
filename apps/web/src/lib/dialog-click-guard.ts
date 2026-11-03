type ClickPosition = Pick<MouseEvent, "detail" | "clientX" | "clientY">;

/** 빠른 저장으로 대화상자가 사라져도 같은 더블클릭이 아래 화면을 누르지 않게 한다. */
export function guardRepeatedDialogClick(target: EventTarget, first: ClickPosition): () => void {
  if (first.detail !== 1) return () => undefined;
  const { clientX, clientY } = first;
  const remove = () => {
    target.removeEventListener("click", intercept, { capture: true });
    target.removeEventListener("dblclick", intercept, { capture: true });
    clearTimeout(timer);
  };
  const intercept: EventListener = (event) => {
    const click = event as MouseEvent;
    if (click.detail > 1 && Math.abs(click.clientX - clientX) <= 4 && Math.abs(click.clientY - clientY) <= 4) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  // 일반 클릭·키보드 입력은 막지 않고 더블클릭의 나머지만 짧게 보호한다.
  const timer = setTimeout(remove, 400);
  target.addEventListener("click", intercept, { capture: true });
  target.addEventListener("dblclick", intercept, { capture: true });
  return remove;
}
