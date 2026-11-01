/** 순수 수동 기록 정책. DB 조회/권한 잠금/감사는 API 트랜잭션의 책임이다. */
export interface ManualFinancePolicyActor {
  userId: string; householdId: string; activeMembership: boolean;
  /** 기존 순수 호출자 호환용 optional. API는 잠근 멤버십의 실제 role을 사용한다. */
  role?: 'owner' | 'admin' | 'member' | 'viewer';
}
export interface ManualFinancePolicyRecord {
  householdId: string; ownerUserId: string; visibility: 'private' | 'household';
  ownerActiveMembership: boolean; deletedAt?: string | Date | null;
}

export function manualFinanceCanRead(actor: ManualFinancePolicyActor, row: ManualFinancePolicyRecord, scope: 'private' | 'household'): boolean {
  if (!actor.activeMembership || !row.ownerActiveMembership || actor.householdId.toLowerCase() !== row.householdId.toLowerCase() || row.deletedAt != null) return false;
  if (scope === 'private') return row.visibility === 'private' && row.ownerUserId.toLowerCase() === actor.userId.toLowerCase();
  return scope === 'household' && row.visibility === 'household';
}

export function manualFinanceCanWrite(actor: ManualFinancePolicyActor, row: ManualFinancePolicyRecord): boolean {
  return actor.role !== 'viewer' && actor.activeMembership && row.ownerActiveMembership && actor.householdId.toLowerCase() === row.householdId.toLowerCase()
    && actor.userId.toLowerCase() === row.ownerUserId.toLowerCase() && row.deletedAt == null;
}

export function manualFinanceSeoulDate(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('manual_finance_invalid_date');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}

function isCalendarDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

export function assertManualFinanceNotFuture(date: string | null, todaySeoul: string = manualFinanceSeoulDate()): void {
  if (!isCalendarDate(todaySeoul) || (date !== null && (!isCalendarDate(date) || date > todaySeoul))) throw new RangeError('manual_finance_invalid_recorded_date');
}

function amount(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) throw new RangeError('manual_finance_invalid_amount');
  return BigInt(value);
}

export interface ManualAssetSummaryInput {
  id: string; kind: 'account' | 'saving' | 'stock' | 'loan'; amount: string | null;
  currency: string; asOfDate: string | null; source: string | null;
}
type Completeness = 'empty' | 'partial' | 'complete';
export interface ManualAssetTotals {
  currency: 'KRW'; grossAssets: string | null; debt: string | null; netAssets: string | null;
  assetsCompleteness: Completeness; debtCompleteness: Completeness; completeness: Completeness;
  asOfDate: string | null; oldestAsOfDate: string | null; newestAsOfDate: string | null; mixedAsOfDates: boolean;
}

/** 반드시 인가된 한 scope의 행만 전달한다. 미입력은 0으로 바꾸지 않는다. */
export function summarizeManualAssets(input: readonly ManualAssetSummaryInput[]): ManualAssetTotals {
  const unique = new Map<string, ManualAssetSummaryInput>();
  for (const row of input) {
    if (!['account', 'saving', 'stock', 'loan'].includes(row.kind) || row.currency !== 'KRW') throw new RangeError('manual_finance_invalid_snapshot');
    if (row.amount === null) {
      if (row.asOfDate !== null || row.source !== null) throw new RangeError('manual_finance_invalid_snapshot');
    } else {
      amount(row.amount);
      if (row.source !== 'manual' || row.asOfDate === null) throw new RangeError('manual_finance_invalid_snapshot');
      assertManualFinanceNotFuture(row.asOfDate);
    }
    const key = row.id.toLowerCase(); const existing = unique.get(key);
    if (existing && (existing.kind !== row.kind || existing.amount !== row.amount || existing.asOfDate !== row.asOfDate || existing.source !== row.source || existing.currency !== row.currency)) throw new RangeError('manual_finance_conflicting_record');
    unique.set(key, row);
  }
  const rows = [...unique.values()];
  const assets = rows.filter((row) => row.kind !== 'loan'); const loans = rows.filter((row) => row.kind === 'loan');
  const sum = (entries: ManualAssetSummaryInput[]): { value: string | null; completeness: Completeness } => {
    if (entries.length === 0) return { value: null, completeness: 'empty' };
    const known = entries.filter((row) => row.amount !== null);
    return { value: known.length === 0 ? null : known.reduce((total, row) => total + amount(row.amount!), 0n).toString(), completeness: known.length === entries.length ? 'complete' : 'partial' };
  };
  const a = sum(assets); const d = sum(loans);
  const complete = a.completeness === 'complete' && d.completeness === 'complete';
  const dates = [...new Set(rows.flatMap((row) => row.asOfDate === null ? [] : [row.asOfDate]))].sort();
  return {
    currency: 'KRW', grossAssets: a.value, debt: d.value, netAssets: complete ? (BigInt(a.value!) - BigInt(d.value!)).toString() : null,
    assetsCompleteness: a.completeness, debtCompleteness: d.completeness,
    completeness: rows.length === 0 ? 'empty' : complete ? 'complete' : 'partial',
    asOfDate: rows.every((row) => row.amount !== null) && dates.length === 1 ? dates[0]! : null,
    oldestAsOfDate: dates[0] ?? null, newestAsOfDate: dates.at(-1) ?? null, mixedAsOfDates: dates.length > 1,
  };
}

type PaymentKind = 'contract' | 'interim' | 'balance' | 'option';
export interface ManualHousingSummaryInput {
  id: string; label: string; payments: readonly {
    id: string; kind: PaymentKind; installment: number | null; dueDate: string | null;
    amount: string | null; paidAmount: string | null; paidDate: string | null;
  }[];
}
export interface ManualHousingTotals {
  nextPayment: { planId: string; paymentId: string; label: string; kind: PaymentKind; installment: number | null; dueDate: string; remainingAmountKrw: string } | null;
  hasIncompletePayments: boolean;
}

/** 인가된 계획과 자식만 입력. 입력된 미지급 일정 중 가장 이른 행이며 현금 전망이 아니다. */
export function summarizeManualHousingPlans(plans: readonly ManualHousingSummaryInput[]): ManualHousingTotals {
  const candidates: NonNullable<ManualHousingTotals['nextPayment']>[] = [];
  const seenPlans = new Map<string, string>(); const seenPayments = new Map<string, string>();
  let hasIncompletePayments = false;
  for (const plan of plans) {
    const planKey = plan.id.toLowerCase(); const canonical = JSON.stringify({ label: plan.label, payments: plan.payments });
    if (seenPlans.has(planKey)) {
      if (seenPlans.get(planKey) !== canonical) throw new RangeError('manual_finance_conflicting_record');
      continue;
    }
    seenPlans.set(planKey, canonical);
    if (plan.payments.length === 0) hasIncompletePayments = true;
    for (const payment of plan.payments) {
      const paymentKey = payment.id.toLowerCase(); const paymentCanonical = JSON.stringify({ planId: planKey, ...payment });
      if (seenPayments.has(paymentKey)) {
        if (seenPayments.get(paymentKey) !== paymentCanonical) throw new RangeError('manual_finance_conflicting_record');
        continue;
      }
      seenPayments.set(paymentKey, paymentCanonical);
      if (!['contract', 'interim', 'balance', 'option'].includes(payment.kind) || (payment.installment !== null && (!Number.isInteger(payment.installment) || payment.installment < 1 || payment.installment > 1000))) throw new RangeError('manual_finance_invalid_payment');
      if (payment.dueDate !== null && !isCalendarDate(payment.dueDate)) throw new RangeError('manual_finance_invalid_payment');
      assertManualFinanceNotFuture(payment.paidDate);
      const planned = payment.amount === null ? null : amount(payment.amount);
      const paid = payment.paidAmount === null ? null : amount(payment.paidAmount);
      if ((paid !== null && (planned === null || paid > planned)) || (paid !== null && paid > 0n ? payment.paidDate === null : payment.paidDate !== null)) throw new RangeError('manual_finance_invalid_payment');
      if (planned === null || paid === null || payment.dueDate === null) {
        hasIncompletePayments = true;
        continue;
      }
      const remaining = planned - paid;
      if (remaining > 0n) candidates.push({ planId: plan.id, paymentId: payment.id, label: plan.label, kind: payment.kind, installment: payment.installment, dueDate: payment.dueDate, remainingAmountKrw: remaining.toString() });
    }
  }
  candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.planId.localeCompare(b.planId) || a.paymentId.localeCompare(b.paymentId));
  return { nextPayment: candidates[0] ?? null, hasIncompletePayments };
}
