"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 화면 맨 아래 '새 가족 만들기' 줄 + 입력 폼
 *
 * - 예전에는 모든 화면 머리의 가족 전환 메뉴에 있었다. '가족 구성원 추가'로 읽혔고, 만들면 빈 가족으로
 *   곧바로 넘어가 모든 화면이 빈 채로 보였다(docs/ux-renewal-2026-11.md §8 결정 대기 정리 ③).
 * - 그래서 가족 화면 맨 아래 창 여는 줄(›)로 옮기고, 줄 아래에 '따로 관리되는 새 가족'과 '사람을 더하려면
 *   초대'를 적는다. 초대 버튼은 소유자에게만 보이므로 다른 역할에게는 소유자에게 부탁하라고 적는다.
 * - 만든 뒤에는 넘어가지 않는다. 토스트의 '그 가족으로 가기'만 머리 메뉴와 같은 전환(setHouseholdId)을 부른다.
 * ------------------------------------------------------------------------- */
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  householdCreateRequestSchema,
  type HouseholdCreateRequest,
  type HouseholdSummary,
} from "@family/contracts";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FieldRow } from "@/components/widgets";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";

export const CREATE_HOUSEHOLD_FAILED =
  "가족을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";

export type CreateHouseholdResult =
  | { ok: true; household: HouseholdSummary; listed: boolean }
  | { ok: false; message: string };

/**
 * 가족을 만들고 가족 목록을 새로 받는다. 넘어가지는 않는다.
 * 목록을 못 받아도 실패로 돌려주지 않는다 — 가족은 이미 생겼고, 실패로 알리면 다시 눌러 같은 가족이 하나 더 생긴다.
 */
export async function createHousehold(
  create: () => Promise<HouseholdSummary>,
  refreshMemberships: () => Promise<void>
): Promise<CreateHouseholdResult> {
  let household: HouseholdSummary;
  try {
    household = await create();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof ApiError ? err.message : CREATE_HOUSEHOLD_FAILED,
    };
  }
  try {
    await refreshMemberships();
    return { ok: true, household, listed: true };
  } catch {
    return { ok: true, household, listed: false };
  }
}

/** 만든 결과를 알린다. 넘어갈지는 사람이 토스트에서 고른다. */
export function announceCreatedHousehold(
  result: Extract<CreateHouseholdResult, { ok: true }>,
  goTo: (householdId: string) => void
) {
  const { id, name } = result.household;
  if (!result.listed) {
    // 가족 목록에 아직 없어서 넘어가도 지금 가족으로 되돌아온다 — 동작을 달지 않는다.
    toast.success(
      `'${name}' 가족을 만들었어요. 앱을 다시 열면 가족 목록에 보여요.`
    );
    return;
  }
  toast.success(`'${name}' 가족을 만들었어요.`, {
    // 기본 4초는 동작을 읽고 누르기에 짧다. 놓쳐도 머리의 가족 메뉴에서 고를 수 있다.
    duration: 8000,
    action: { label: "그 가족으로 가기", onClick: () => goTo(id) },
  });
}

export function CreateHouseholdSection({ isOwner }: { isOwner: boolean }) {
  const { authedFetch, refreshMemberships } = useAuth();
  const { setHouseholdId } = useHousehold();
  const [open, setOpen] = useState(false);

  const form = useForm<HouseholdCreateRequest>({
    resolver: zodResolver(householdCreateRequestSchema),
    defaultValues: { name: "" },
  });

  async function onCreate(values: HouseholdCreateRequest) {
    const result = await createHousehold(
      () => authedFetch((token) => api.households.create(token, values)),
      refreshMemberships
    );
    if (!result.ok) {
      form.setError("name", { message: result.message });
      return;
    }
    setOpen(false);
    form.reset();
    announceCreatedHousehold(result, setHouseholdId);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // 닫으면 쓰던 이름과 오류를 비운다 — 다시 열었을 때 지난 오류가 남아 있지 않게.
    if (!next) form.reset();
  }

  return (
    <>
      <section
        className="finance-panel min-w-0 px-5 pt-1"
        aria-label="새 가족 만들기"
      >
        <FieldRow
          label="새 가족 만들기"
          value={null}
          onClick={() => setOpen(true)}
        >
          기록이 따로 관리되는 새 가족을 만들어요.{" "}
          {isOwner
            ? "지금 가족에 사람을 더하려면 위의 초대하기를 써 주세요."
            : "지금 가족에 사람을 더하려면 소유자에게 초대를 부탁해 주세요."}
        </FieldRow>
      </section>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 가족 만들기</DialogTitle>
            <DialogDescription>
              내가 소유자인 가족이 하나 더 생기고, 지금 가족은 그대로예요. 만든
              가족은 맨 위 가족 이름을 눌러 고를 수 있어요.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              id="create-household-form"
              onSubmit={form.handleSubmit(onCreate)}
              noValidate
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>가족 이름</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="예: 우리집"
                        maxLength={100}
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
          <DialogFooter className="flex-col sm:flex-col">
            <Button
              type="submit"
              form="create-household-form"
              className="h-11 w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "만드는 중…" : "만들기"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
