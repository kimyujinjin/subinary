import type { DecidedSeries } from './reconcile';

/** 자동 갱신에서 유지할 미확정 후보와 실제로 사라진 후보를 구분한다. */
export interface CandidateIdentityPlan {
  updates: { seriesId: string; candidateIndex: number }[];
  deletes: string[];
  inserts: number[];
}

/**
 * 사용자 결정에 배정되지 않은 후보끼리 근거 교집합이 1:1일 때 UUID를 유지한다.
 * 병합·분할은 다른 판단 대상이므로 임의로 한 UUID를 고르지 않고 새 후보로 만든다.
 */
export function reconcileCandidateIdentity(
  existing: readonly DecidedSeries[],
  candidates: readonly { transactionIds: readonly string[] }[],
  available: readonly number[],
): CandidateIdentityPlan {
  const matches = new Map<string, number[]>();
  const claimants = new Map<number, string[]>();
  for (const old of existing) {
    const ids = new Set(old.transactionIds);
    const overlaps = available.filter((index) => candidates[index].transactionIds.some((id) => ids.has(id)));
    matches.set(old.id, overlaps);
    for (const index of overlaps) {
      claimants.set(index, [...(claimants.get(index) ?? []), old.id]);
    }
  }
  const updates: CandidateIdentityPlan['updates'] = [];
  const deletes: string[] = [];
  const consumed = new Set<number>();
  for (const old of existing) {
    const overlap = matches.get(old.id) ?? [];
    const index = overlap[0];
    if (overlap.length === 1 && index !== undefined && claimants.get(index)?.length === 1) {
      updates.push({ seriesId: old.id, candidateIndex: index });
      consumed.add(index);
    } else {
      deletes.push(old.id);
    }
  }
  return { updates, deletes, inserts: available.filter((index) => !consumed.has(index)) };
}
