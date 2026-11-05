/**
 * 정기 결제 합계에서 뺀 것을 한 줄로(계약 문구는 줄이되 지우지 않는다 — §3.5).
 *
 * 다가오는 지출 카드(`dashboard/upcoming-card.tsx`)와 정기 지출 화면(`more/recurring/page.tsx`)이 같은
 * 사실을 말하므로 문장을 여기 하나에 둔다. 예전에는 한쪽이 '과거 거래 기준이 아직 정리되지 않아',
 * 다른 쪽이 '금액을 아직 확인하지 못해'로 달랐다(2026-11-05 HIG 검수). 금액을 못 정한 이유는 두 사유가
 * 겹쳐도 '금액을 아직 확인하지 못해/못했고'로만 말한다.
 */
export function leftOutText(
  excluded: number,
  otherCurrency: number
): string | null {
  if (excluded > 0 && otherCurrency > 0) {
    return `${excluded}건은 금액을 아직 확인하지 못했고, ${otherCurrency}건은 외화라 합계에서 뺐어요.`;
  }
  if (excluded > 0) return `${excluded}건은 금액을 아직 확인하지 못해 합계에서 뺐어요.`;
  if (otherCurrency > 0) return `${otherCurrency}건은 외화라 합계에서 뺐어요.`;
  return null;
}
