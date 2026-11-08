"use client";

import { ArrowDown, ArrowDownRight, ArrowUpRight, Check, ChevronDown, CircleDollarSign, Home, Settings2, Wallet } from "lucide-react";
import { useState } from "react";

const MONTHLY_INCOME = 4_200_000;
const YUJIN_INCOME = 2_400_000;
const SUJIN_INCOME = MONTHLY_INCOME - YUJIN_INCOME;
const MONTHLY_SPEND = 2_486_300;
const MONTHLY_SURPLUS = MONTHLY_INCOME - MONTHLY_SPEND;
const FLOW_CATEGORIES = [
  { name: "식비", amount: 684_200 },
  { name: "생활", amount: 412_500 },
  { name: "교통", amount: 198_000 },
  { name: "고정비·그 외", amount: MONTHLY_SPEND - 1_294_700 },
];
const SAVING_FLOW_CATEGORIES = [
  { name: "아파트 목표", amount: 1_000_000 },
  { name: "비상금", amount: 300_000 },
  { name: "적금·청약", amount: MONTHLY_SURPLUS - 1_300_000 },
];
const TOTAL_ASSETS = 49_000_000;
const TOTAL_DEBT = 128_000_000;
const NET_WORTH = TOTAL_ASSETS - TOTAL_DEBT;
const SOURCES = [
  { id: "account", name: "생활비 통장", detail: "나 · 바로 사용할 수 있어요", amount: 8_000_000, initiallyIncluded: true },
  { id: "housing-savings", name: "주택청약", detail: "배우자 · 청약 자금", amount: 10_000_000, initiallyIncluded: true },
  { id: "family-savings", name: "가족 적금", detail: "가족 공동 · 2027년 6월 만기", amount: 20_000_000, initiallyIncluded: true },
  { id: "emergency-fund", name: "비상금 통장", detail: "나 · 비상금으로 따로 보관", amount: 5_000_000, initiallyIncluded: false },
  { id: "investment-account", name: "투자 계좌", detail: "배우자 · 평가액이 변동될 수 있어요", amount: 6_000_000, initiallyIncluded: false },
] as const;

const DEFAULT_TARGET_MONTH = "2028-11";

function monthsUntil(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const now = new Date();
  return Math.max(1, (year - now.getFullYear()) * 12 + monthNumber - (now.getMonth() + 1));
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${year}년 ${Number(monthNumber)}월`;
}

function Won({ value }: { value: number }) {
  return <>{new Intl.NumberFormat("ko-KR").format(value)}원</>;
}

/** Goal-first homepage concept. Demo figures only; the app does not yet store a home goal. */
export function HomeGoalPreview() {
  const [expanded, setExpanded] = useState(false);
  const [assetSummaryOpen, setAssetSummaryOpen] = useState(false);
  const [moneyFlowOpen, setMoneyFlowOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeFunds, setHomeFunds] = useState(80_000_000);
  const [purchaseCosts, setPurchaseCosts] = useState(12_000_000);
  const [movingCosts, setMovingCosts] = useState(8_000_000);
  const [targetMonth, setTargetMonth] = useState(DEFAULT_TARGET_MONTH);
  const [scenarioMonthly, setScenarioMonthly] = useState(MONTHLY_SURPLUS);
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(SOURCES.filter((source) => source.initiallyIncluded).map((source) => source.id)),
  );
  const goalAmount = homeFunds + purchaseCosts + movingCosts;
  const monthsLeft = monthsUntil(targetMonth);
  const savedAmount = SOURCES.reduce(
    (total, source) => total + (included.has(source.id) ? source.amount : 0),
    0,
  );
  const assetsOutsideGoal = Math.max(TOTAL_ASSETS - savedAmount, 0);
  const remaining = Math.max(goalAmount - savedAmount, 0);
  const monthlyNeeded = Math.ceil(remaining / monthsLeft);
  const monthlyGap = monthlyNeeded - MONTHLY_SURPLUS;
  const projectedTotal = savedAmount + MONTHLY_SURPLUS * monthsLeft;
  const scenarioTotal = savedAmount + scenarioMonthly * monthsLeft;
  const scenarioGap = Math.max(goalAmount - scenarioTotal, 0);
  const progress = goalAmount > 0 ? Math.min(Math.round((savedAmount / goalAmount) * 100), 100) : 0;
  const toggleSource = (id: string) => {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <section className="finance-panel min-w-0 px-5" aria-labelledby="total-assets-title">
        <p id="total-assets-title" className="text-caption text-muted-foreground">총자산</p>
        <p className="text-display mt-1 font-bold tabular-nums"><Won value={TOTAL_ASSETS} /></p>
        <button
          type="button"
          aria-expanded={assetSummaryOpen}
          onClick={() => setAssetSummaryOpen((value) => !value)}
          className="text-caption mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left font-medium text-primary"
        >
          <span>자산 구성 보기</span>
          <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${assetSummaryOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {assetSummaryOpen ? (
          <div className="mt-1 border-t border-border pt-3" aria-live="polite">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-caption font-semibold">자산 구성</p>
              <span className="text-micro text-muted-foreground">목표 포함 여부</span>
            </div>
            <ul className="divide-y divide-border">
              {SOURCES.map((source) => {
                const isIncluded = included.has(source.id);
                return (
                  <li key={source.id} className="flex min-h-14 items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-body truncate font-medium">{source.name}</p>
                      <p className="text-micro mt-0.5 text-muted-foreground">{source.detail}</p>
                    </div>
                    <span className={`text-micro shrink-0 rounded-full px-2 py-1 ${isIncluded ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
                      {isIncluded ? "목표 포함" : "목표 외"}
                    </span>
                    <span className="text-caption w-24 shrink-0 text-right font-semibold tabular-nums"><Won value={source.amount} /></span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <p className="text-caption font-semibold">대출·순자산</p>
              <div className="flex justify-between gap-3 text-caption"><span>대출</span><b className="tabular-nums"><Won value={TOTAL_DEBT} /></b></div>
              <div className="flex justify-between gap-3 text-caption"><span>순자산</span><b className="tabular-nums"><Won value={NET_WORTH} /></b></div>
            </div>
            <p className="text-micro mt-3 text-muted-foreground">계좌와 금액은 화면 구성을 위한 예시예요.</p>
          </div>
        ) : null}
      </section>

      <section className="finance-panel min-w-0 px-5" aria-labelledby="home-goal-title">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
              <Home className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="home-goal-title" className="text-heading font-semibold">우리 가족 아파트 자금</h2>
              <p className="text-caption text-muted-foreground mt-0.5">{monthLabel(targetMonth)}까지 · 예시 목표</p>
            </div>
          </div>
          <button type="button" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen} className="flex min-h-11 shrink-0 items-center gap-1 rounded-control px-2 text-caption font-medium text-primary active:bg-muted">
            <Settings2 className="size-4" aria-hidden="true" /> 목표 설정
          </button>
        </div>

        {settingsOpen ? (
          <div className="mt-4 space-y-3 rounded-card bg-muted p-4">
            <p className="text-caption text-muted-foreground">목표 자금에 필요한 항목을 나눠 입력해요.</p>
            {[
              { label: "집 자금", value: homeFunds, setValue: setHomeFunds },
              { label: "취득 비용", value: purchaseCosts, setValue: setPurchaseCosts },
              { label: "이사·수리", value: movingCosts, setValue: setMovingCosts },
            ].map((field) => (
              <label key={field.label} className="flex min-h-11 items-center gap-3">
                <span className="text-body min-w-20 flex-1">{field.label}</span>
                <input type="number" min={0} step={1_000_000} value={field.value} onChange={(event) => field.setValue(Math.max(0, Number(event.target.value) || 0))} className="h-11 w-36 rounded-control border border-input bg-background px-3 text-right text-body tabular-nums" />
                <span className="text-caption text-muted-foreground">원</span>
              </label>
            ))}
            <label className="flex min-h-11 items-center gap-3">
              <span className="text-body min-w-20 flex-1">목표 시점</span>
              <input type="month" value={targetMonth} onChange={(event) => event.target.value && setTargetMonth(event.target.value)} className="h-11 rounded-control border border-input bg-background px-3 text-body" />
            </label>
            <p className="text-caption border-t border-border pt-3 font-semibold">목표 합계 <span className="float-right tabular-nums"><Won value={goalAmount} /></span></p>
          </div>
        ) : null}

        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-caption text-muted-foreground">목표 자금</p>
            <p className="text-display mt-1 font-bold tabular-nums"><Won value={goalAmount} /></p>
          </div>
          <p className="text-caption shrink-0 text-muted-foreground">{monthsLeft}개월 남았어요</p>
        </div>

        <div className="mt-5" role="progressbar" aria-label="아파트 자금 목표 달성률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="bg-muted h-2.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-caption mt-2 flex justify-between gap-3">
            <span><b className="text-foreground"><Won value={savedAmount} /></b><span className="text-muted-foreground"> 모았어요</span></span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="text-body mt-4 flex min-h-11 w-full items-center justify-between rounded-control px-1 text-left font-medium active:bg-muted"
        >
          <span>목표에 포함된 자금 · {included.size}곳</span>
          <ChevronDown className={`size-5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {expanded ? (
          <ul className="divide-y divide-border">
            {SOURCES.map((source) => {
              const isIncluded = included.has(source.id);
              return (
                <li key={source.id}>
                  <button
                    type="button"
                    aria-pressed={isIncluded}
                    onClick={() => toggleSource(source.id)}
                    className="flex min-h-16 w-full items-center gap-3 py-3 text-left active:bg-muted"
                  >
                    <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${isIncluded ? "border-primary bg-primary text-primary-foreground" : "border-control-off text-transparent"}`}>
                      <Check className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-body block font-medium">{source.name}</span>
                      <span className="text-caption text-muted-foreground mt-0.5 block">{source.detail}</span>
                    </span>
                    <span className="text-body shrink-0 font-semibold tabular-nums"><Won value={source.amount} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-micro text-muted-foreground mt-2">비상금은 기본 제외돼요. 계좌 간 이체는 지출로 더하지 않고, 각 잔액은 한 번만 합산해요.</p>

        <div className="bg-muted mt-5 flex items-center justify-between gap-3 rounded-control p-4">
          <div className="min-w-0">
            <p className="text-caption text-muted-foreground">목표일까지 남은 자금</p>
            <p className="text-heading mt-1 font-semibold tabular-nums"><Won value={remaining} /></p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-caption text-muted-foreground">매달 모을 금액</p>
            <p className="text-heading mt-1 font-semibold tabular-nums"><Won value={monthlyNeeded} /></p>
          </div>
        </div>
      </section>

      <section className="finance-panel min-w-0 px-5" aria-label="목표 외 자산">
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption text-muted-foreground">목표 외 자산</span>
          <span className="text-caption text-muted-foreground tabular-nums"><Won value={assetsOutsideGoal} /></span>
        </div>
        <p className="text-micro text-muted-foreground mt-1">비상금과 투자금이 포함돼요. 모두 바로 쓸 수 있는 현금은 아니에요.</p>
      </section>

      <section className="finance-panel min-w-0 px-5" aria-labelledby="monthly-money-flow-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="monthly-money-flow-title" className="text-heading font-semibold">이번 달 돈 흐름</h2>
            <p className="text-micro mt-0.5 text-muted-foreground">두 사람의 급여가 공용통장에서 나뉘어요</p>
          </div>
          <span className="text-micro shrink-0 rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">예시 흐름</span>
        </div>

        <div className="mt-4 rounded-card bg-muted p-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              { name: "유진 급여", amount: YUJIN_INCOME },
              { name: "수진 급여", amount: SUJIN_INCOME },
            ].map((income) => (
              <div key={income.name} className="min-w-0 rounded-control bg-background p-3">
                <p className="text-micro text-muted-foreground">{income.name}</p>
                <p className="text-caption mt-1 font-semibold tabular-nums"><Won value={income.amount} /></p>
              </div>
            ))}
          </div>

          <svg viewBox="0 0 300 42" preserveAspectRatio="none" aria-hidden="true" className="block h-10 w-full text-[#83a991]">
            <path d="M75 0v12h75v26M225 0v12h-75" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m146 33 4 6 4-6" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>

          <div className="flex items-center gap-3 rounded-control border border-[#c5dbc9] bg-[#eff7f0] p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#438456]">
              <CircleDollarSign className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-caption block text-muted-foreground">공용통장으로 모여요</span>
              <span className="text-body block font-semibold tabular-nums"><Won value={MONTHLY_INCOME} /></span>
            </span>
          </div>

          <div className="mx-auto flex h-8 w-px items-center justify-center bg-[#83a991]" aria-hidden="true">
            <ArrowDown className="size-4 translate-y-3 text-[#638d70]" />
          </div>

          <div className="relative grid grid-cols-2 gap-2 pt-3 before:absolute before:top-0 before:right-1/4 before:left-1/4 before:border-t before:border-[#83a991]">
            <div className="relative min-w-0 rounded-control border border-[#d5d5ef] bg-[#f0f0fb] p-3 before:absolute before:-top-3 before:left-1/2 before:h-3 before:border-l before:border-[#83a991]">
              <span className="flex size-8 items-center justify-center rounded-full bg-white text-[#625eaf]">
                <Wallet className="size-4" aria-hidden="true" />
              </span>
              <p className="text-micro mt-2 text-muted-foreground">생활비 통장</p>
              <p className="text-caption mt-0.5 font-semibold tabular-nums"><Won value={MONTHLY_SPEND} /></p>
            </div>
            <div className="relative min-w-0 rounded-control border border-[#f0dfa8] bg-[#fff8e5] p-3 before:absolute before:-top-3 before:left-1/2 before:h-3 before:border-l before:border-[#83a991]">
              <span className="flex size-8 items-center justify-center rounded-full bg-white text-[#9c7515]">
                <Wallet className="size-4" aria-hidden="true" />
              </span>
              <p className="text-micro mt-2 text-muted-foreground">저축 통장</p>
              <p className="text-caption mt-0.5 font-semibold tabular-nums"><Won value={MONTHLY_SURPLUS} /></p>
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={moneyFlowOpen}
          onClick={() => setMoneyFlowOpen((value) => !value)}
          className="text-body mt-2 flex min-h-11 w-full items-center justify-between rounded-control px-1 text-left font-medium active:bg-muted"
        >
          <span>{moneyFlowOpen ? "항목 접기" : "통장별 사용처 자세히 보기"}</span>
          <ChevronDown className={`size-5 text-muted-foreground transition-transform ${moneyFlowOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {moneyFlowOpen ? (
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div>
              <p className="text-caption mb-1 font-semibold">생활비 통장에서</p>
              <div className="ml-1 h-2 w-px bg-[#625eaf]" aria-hidden="true" />
              <ul className="text-micro ml-1 space-y-1.5 border-l border-[#625eaf] py-1 pl-2">
                {FLOW_CATEGORIES.map((category) => (
                  <li key={category.name} className="relative flex min-h-9 items-center justify-between gap-1 rounded border border-black/5 bg-background px-2 py-1.5 before:absolute before:-left-[9px] before:top-1/2 before:w-2 before:border-t before:border-[#625eaf]">
                    <span className="min-w-0 truncate">{category.name}</span>
                    <span className="shrink-0 font-medium tabular-nums"><Won value={category.amount} /></span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-caption mb-1 font-semibold">저축 통장에서</p>
              <div className="ml-1 h-2 w-px bg-[#9c7515]" aria-hidden="true" />
              <ul className="text-micro ml-1 space-y-1.5 border-l border-[#9c7515] py-1 pl-2">
                {SAVING_FLOW_CATEGORIES.map((category) => (
                  <li key={category.name} className="relative flex min-h-9 items-center justify-between gap-1 rounded border border-black/5 bg-background px-2 py-1.5 before:absolute before:-left-[9px] before:top-1/2 before:w-2 before:border-t before:border-[#9c7515]">
                    <span className="min-w-0 truncate">{category.name}</span>
                    <span className="shrink-0 font-medium tabular-nums"><Won value={category.amount} /></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-2 mt-2 rounded-control bg-secondary p-3">
              <p className="text-micro text-muted-foreground">계좌와 금액은 흐름을 보여주기 위한 예시예요. 실제 화면에서는 계좌 이체와 결제를 구분해 이중 계산하지 않아요.</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="finance-panel min-w-0 px-5" aria-labelledby="home-goal-pace-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="home-goal-pace-title" className="text-heading font-semibold">이번 달 저축 페이스</h2>
          <span className="text-micro rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">예시 계산</span>
        </div>
        <p className="text-caption text-muted-foreground mt-3">수입에서 지출을 뺀 금액을 기준으로 계산했어요.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="min-w-0 rounded-control bg-muted p-3">
            <p className="text-micro text-muted-foreground">이번 달 수입</p>
            <p className="text-caption mt-1 font-semibold tabular-nums"><Won value={MONTHLY_INCOME} /></p>
          </div>
          <div className="min-w-0 rounded-control bg-muted p-3">
            <p className="text-micro text-muted-foreground">이번 달 지출</p>
            <p className="text-caption mt-1 font-semibold tabular-nums"><Won value={MONTHLY_SPEND} /></p>
          </div>
          <div className="min-w-0 rounded-control bg-muted p-3">
            <p className="text-micro text-muted-foreground">남길 수 있는 돈</p>
            <p className="text-caption mt-1 font-semibold tabular-nums"><Won value={MONTHLY_SURPLUS} /></p>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-control bg-secondary p-4">
          {monthlyGap > 0 ? <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> : <ArrowDownRight className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden="true" />}
          <p className="text-caption leading-relaxed">
            현재 흐름이면 매달 <b className="tabular-nums"><Won value={MONTHLY_SURPLUS} /></b> 정도를 남길 수 있어요.
            목표 페이스보다 매달 <b className="tabular-nums"><Won value={Math.abs(monthlyGap)} /></b> {monthlyGap > 0 ? "더 필요해요." : "여유가 있어요."}
          </p>
        </div>
        <p className="text-caption text-muted-foreground mt-3">
          지금 흐름이 이어지면 목표 시점에 약 <b className="text-foreground tabular-nums"><Won value={projectedTotal} /></b>을 모을 수 있어요.
        </p>
        <div className="border-border mt-5 border-t pt-4">
          <label htmlFor="home-savings-scenario" className="text-body flex items-center justify-between gap-3 font-medium">
            <span>월 저축 시나리오</span>
            <span className="tabular-nums"><Won value={scenarioMonthly} /></span>
          </label>
          <input
            id="home-savings-scenario"
            type="range"
            min={0}
            max={5_000_000}
            step={100_000}
            value={scenarioMonthly}
            onChange={(event) => setScenarioMonthly(Number(event.target.value))}
            className="mt-3 h-11 w-full accent-primary"
          />
          <div className="bg-muted rounded-control p-4" aria-live="polite">
            <p className="text-caption text-muted-foreground">{monthLabel(targetMonth)} 예상 자금</p>
            <p className="text-heading mt-1 font-semibold tabular-nums"><Won value={scenarioTotal} /></p>
            <p className="text-caption mt-1">
              {scenarioGap > 0
                ? `목표까지 ${new Intl.NumberFormat("ko-KR").format(scenarioGap)}원이 더 필요해요.`
                : `목표를 채우고 ${new Intl.NumberFormat("ko-KR").format(scenarioTotal - goalAmount)}원이 남아요.`}
            </p>
          </div>
          <p className="text-micro text-muted-foreground mt-3">저축액과 목표 시점을 바꾸어 보는 예시예요. 실제 금융상품 수익은 계산하지 않아요.</p>
        </div>
      </section>
    </>
  );
}
