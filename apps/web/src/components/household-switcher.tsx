"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 스위처 (앱 셸 상단)
 *
 * - 여러 가족 전환(Zustand store에 선택 저장) + 현재 가족/역할 표시. 가족 고르기는 값 고르기
 *   메뉴(PickerMenu)와 같은 모양 — 지금 가족에 오른쪽 체크, 항목 44px, 역할 이름은 가족 화면과 같은 말.
 * - "새 가족 만들기": 기존 사용자도 가족을 추가로 만들 수 있는 입력 창
 *   (온보딩과 동일한 create 흐름 재사용). 생성 후 그 가족으로 전환. 구성원 추가로 읽히지 않도록
 *   창 설명에 '따로 만드는 새 가족'과 '사람을 더하려면 초대'를 적는다(위치는 소유자 결정 대기).
 * ------------------------------------------------------------------------- */
import { zodResolver } from "@hookform/resolvers/zod";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  householdCreateRequestSchema,
  type HouseholdCreateRequest,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { ROLE_LABEL } from "@/lib/household-roles";

/** 가족 항목 — PickerMenu 항목과 같은 줄(44px 이상·본문 글자·눌림 바탕). */
const HOUSEHOLD_ITEM =
  "relative flex min-h-11 cursor-default items-center gap-3 rounded-control px-3 py-2 text-body outline-hidden select-none focus:bg-muted data-[highlighted]:bg-muted dark:focus:bg-foreground/10 dark:data-[highlighted]:bg-foreground/10 data-[state=checked]:font-semibold";

export function HouseholdSwitcher() {
  const { authedFetch, refreshMemberships } = useAuth();
  const { householdId, setHouseholdId, activeMembership, memberships } =
    useHousehold();
  const [createOpen, setCreateOpen] = useState(false);

  const form = useForm<HouseholdCreateRequest>({
    resolver: zodResolver(householdCreateRequestSchema),
    defaultValues: { name: "" },
  });

  async function onCreate(values: HouseholdCreateRequest) {
    try {
      const created = await authedFetch((token) =>
        api.households.create(token, values),
      );
      await refreshMemberships();
      setHouseholdId(created.id);
      toast.success(`'${created.name}' 가족을 만들었어요.`);
      setCreateOpen(false);
      form.reset();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "가족을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
      form.setError("name", { message });
    }
  }

  function onCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    // 닫으면 쓰던 이름과 오류를 비운다 — 다시 열었을 때 지난 오류가 남아 있지 않게.
    if (!open) form.reset();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="text-caption min-h-11 min-w-0 max-w-56 shrink justify-between gap-1.5 px-2 font-medium"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Users className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">
                {activeMembership?.name ?? "가족 선택"}
              </span>
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64 max-w-[calc(100vw-2rem)] p-1"
        >
          <DropdownMenuLabel>내 가족</DropdownMenuLabel>
          <DropdownMenuPrimitive.RadioGroup
            value={householdId ?? ""}
            onValueChange={(next) => {
              if (next !== householdId) setHouseholdId(next);
            }}
          >
            {memberships.map((m) => (
              <DropdownMenuPrimitive.RadioItem
                key={m.householdId}
                value={m.householdId}
                className={HOUSEHOLD_ITEM}
              >
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="text-muted-foreground text-caption shrink-0 font-normal">
                  {ROLE_LABEL[m.role]}
                </span>
                {/* 체크 자리는 늘 비워 둔다 — 지금 가족만 체크가 있어도 역할 칸이 세로로 맞는다. */}
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <DropdownMenuPrimitive.ItemIndicator>
                    <Check aria-hidden="true" className="text-primary size-4" />
                  </DropdownMenuPrimitive.ItemIndicator>
                </span>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> 새 가족 만들기
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 가족 만들기</DialogTitle>
            <DialogDescription>
              내가 소유자인 새 가족을 따로 만들고, 만든 가족으로 바로 바꿔요.
              지금 가족에 사람을 더하려면 가족 화면에서 초대해 주세요.
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
                      <Input placeholder="예: 우리집" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
          {/* 폼 아래 버튼은 '주 버튼 / 닫기' 한 가지 — 예전에는 X만 출구였다(2026-11 HIG 검수). */}
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
              onClick={() => onCreateOpenChange(false)}
            >
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
