/** Validation and request lifetime for the amount/date editor. No browser or API I/O. */
export interface TransactionEditPatch {
  amount?: number;
  occurredAt?: string;
}

export interface TransactionEditErrors {
  amount?: string;
  occurredAt?: string;
}

export interface TransactionEditInput {
  amount: string;
  date: string;
  initialAmount: number;
  initialDate: string;
  canEditAmount: boolean;
}

/** Reject rollover dates (February 30, etc.) rather than letting Date normalize them. */
function localDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) === 0) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
  return parts.every((part, index) => part === Number(match[index + 1])) ? date : null;
}

export function validateTransactionEdit(input: TransactionEditInput):
  | { ok: true; patch: TransactionEditPatch }
  | { ok: false; errors: TransactionEditErrors } {
  const errors: TransactionEditErrors = {};
  const patch: TransactionEditPatch = {};
  if (input.canEditAmount) {
    const digits = input.amount.replace(/[,\s]/g, "");
    const amount = Number(digits);
    if (!/^\d+$/.test(digits) || !Number.isSafeInteger(amount) || amount <= 0) {
      errors.amount = "금액은 1 이상의 정수로 입력해 주세요.";
    } else if (amount !== input.initialAmount) {
      patch.amount = amount;
    }
  }
  const date = localDate(input.date);
  if (!date) {
    errors.occurredAt = "올바른 날짜와 시각을 입력해 주세요.";
  } else if (input.date !== input.initialDate) {
    patch.occurredAt = date.toISOString();
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, patch };
}

/**
 * Claim before React renders pending state. Closing/unmounting invalidates the
 * claim, so an old response cannot close or replace a newer editing session.
 * This does not cancel a request that may already have reached the server.
 */
export function createTransactionEditSession() {
  let active: object | null = null;
  return {
    get pending() { return active !== null; },
    invalidate() { active = null; },
    async save<T>(
      request: () => Promise<T>,
      succeeded: (result: T) => void,
      failed: (error: unknown) => void,
    ): Promise<"busy" | "saved" | "failed" | "stale"> {
      if (active) return "busy";
      const claim = {};
      active = claim;
      try {
        const result = await request();
        if (active !== claim) return "stale";
        active = null;
        succeeded(result);
        return "saved";
      } catch (error) {
        if (active !== claim) return "stale";
        active = null;
        failed(error);
        return "failed";
      }
    },
  };
}
