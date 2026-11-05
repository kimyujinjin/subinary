"use client";
/**
 * 결제 카드 등록·수정 창의 설정 줄 — 설정 앱 스타일 한 목록(`FieldList`·`FieldRow`).
 *
 * 수정 창은 라벨 붙은 드롭다운 3개(결제일은 32개 항목)에 스위치와 설명 4줄을 쌓아 입력 양식처럼 보였다.
 * 거래 상세에서 사용자 지적으로 걷어 낸 바로 그 모양이라(.claude/rules/web-ui.md 3번, 2026-11-05 HIG 검수)
 * 한 줄 = 이름 · 회색 값 · ⌃⌄ 로 바꾸고, 값은 누른 자리 아래 드롭다운(PickerMenu)으로 고른다. 켜고 끄는 값은
 * 같은 줄 모양의 스위치다. 설명은 값을 바꿔서 알아야 할 것이 생길 때만 그 줄 아래에 한 줄 붙인다.
 */
import { CreditCard } from "lucide-react";
import type { ReactNode } from "react";

import type { CardSummary, CardVisibility } from "@family/contracts";

import type { PickerOption } from "@/components/ui/picker-menu";
import { Switch } from "@/components/ui/switch";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { cn } from "@/lib/utils";

import type { OwnerOption } from "./card-rows";

/** 표준 카드사 목록 — 분석 라벨('alias · issuer') 표기 일관성을 위해 자유입력 대신 고정. */
export const ISSUER_OPTIONS = [
  "신한",
  "삼성",
  "현대",
  "KB국민",
  "롯데",
  "하나",
  "우리",
  "BC",
  "NH농협",
  "카카오뱅크",
  "토스뱅크",
  "기타",
] as const;

/** visibility 선택지 + 설명(이후 자동연결 거래에 상속되는 프라이버시 값). */
export const VISIBILITY_OPTIONS: ReadonlyArray<{
  value: CardVisibility;
  label: string;
  description: string;
}> = [
  {
    value: "household",
    label: "가족 공개",
    description: "가맹점과 금액을 가족과 모두 공유해요.",
  },
  {
    value: "summary_only",
    label: "금액만 공개",
    description: "가족에게는 금액만 보이고 가맹점은 가려져요.",
  },
  {
    value: "private",
    label: "나만 보기",
    description: "가족에게 보이지 않고 가족 합계에서도 빠져요.",
  },
];

const BILLING_NONE = "none";

/** 결제일 선택지(선택 안 함 + 매월 1~31일). 그 달에 없는 날은 말일로 본다. */
export const BILLING_DAY_OPTIONS: readonly PickerOption[] = [
  { value: BILLING_NONE, label: "선택 안 함" },
  ...Array.from({ length: 31 }, (_, index) => ({
    value: String(index + 1),
    label: `매월 ${index + 1}일`,
  })),
];

const ISSUER_PICKER: readonly PickerOption[] = ISSUER_OPTIONS.map((issuer) => ({
  value: issuer,
  label: issuer,
}));

const VISIBILITY_PICKER: readonly PickerOption[] = VISIBILITY_OPTIONS.map(
  ({ value, label }) => ({ value, label })
);

function visibilityOf(value: CardVisibility) {
  return VISIBILITY_OPTIONS.find((option) => option.value === value);
}

/** 칸 아래 오류 한 줄 — 폼 맨 아래에 모으면 긴 폼에서 어느 칸 문제인지 보이지 않는다. */
function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-destructive">
      {children}
    </p>
  );
}

/**
 * 소유자 값: 구성원 색 동그라미 + 이름. 카드 아이콘 색이 소유자 색을 따르므로, 소유자를 바꾸면
 * 색이 바뀐다는 것을 창 안에서 바로 보인다(목록 아이콘과 같은 규칙).
 */
function OwnerValue({
  name,
  colorClass,
}: {
  name: string;
  colorClass: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center justify-end gap-2 align-middle">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
          colorClass
        )}
      >
        <CreditCard className="size-3.5" />
      </span>
      <span className="min-w-0 break-words">{name}</span>
    </span>
  );
}

/**
 * 소유자 줄. 고를 수 있는 사람은 지금 구성원뿐이다 — 가족을 떠난 지금 소유자는 값으로만 보이고
 * 메뉴에는 없다(서버도 새 소유자로 받지 않는다, ./card-rows.ts).
 */
function OwnerRow({
  owners,
  value,
  onChange,
  colorClassOf,
  disabled,
  children,
}: {
  owners: readonly OwnerOption[];
  value: string;
  onChange: (memberId: string) => void;
  colorClassOf: (memberId: string) => string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const selected = owners.find((owner) => owner.memberId === value);
  return (
    <FieldRow
      label="소유자"
      value={
        selected ? (
          <OwnerValue
            name={selected.name}
            colorClass={colorClassOf(selected.memberId)}
          />
        ) : (
          "고르기"
        )
      }
      muted={!selected}
      disabled={disabled}
      menu={{
        label: "소유자",
        options: owners
          .filter((owner) => !owner.disabled)
          .map((owner) => ({ value: owner.memberId, label: owner.name })),
        value: value || null,
        onSelect: onChange,
      }}
    >
      {children}
    </FieldRow>
  );
}

function VisibilityRow({
  value,
  onChange,
  disabled,
  children,
}: {
  value: CardVisibility;
  onChange: (visibility: CardVisibility) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <FieldRow
      label="공개 범위"
      value={visibilityOf(value)?.label ?? ""}
      disabled={disabled}
      menu={{
        label: "공개 범위",
        options: VISIBILITY_PICKER,
        value,
        onSelect: (next) => onChange(next as CardVisibility),
      }}
    >
      {children}
    </FieldRow>
  );
}

/**
 * 켜고 끄는 줄 — `FieldRow`와 같은 높이·글자(이름 왼쪽, 스위치 오른쪽). 이름을 눌러도 켜고 끈다.
 * 줄 아래 설명은 스위치의 설명(aria-describedby)으로 읽힌다.
 */
export function SwitchFieldRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const noteId = children ? `${id}-note` : undefined;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-h-12 w-full min-w-0 items-center gap-3 py-2">
        <label
          htmlFor={id}
          className={cn(
            "text-body text-foreground min-w-0 flex-1 break-words",
            disabled && "opacity-50"
          )}
        >
          {label}
        </label>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-describedby={noteId}
        />
      </div>
      {children ? (
        <div
          id={noteId}
          className="text-caption text-muted-foreground -mt-1 flex flex-col gap-1 pb-3"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** 등록 창의 고르는 값: 카드사 · 소유자 · 공개 범위. 글자로 적는 별칭·뒤 4자리는 이 목록 위의 입력칸이다. */
export function CardRegisterFields({
  issuer,
  onIssuerChange,
  issuerError,
  owners,
  ownerId,
  onOwnerChange,
  colorClassOf,
  visibility,
  onVisibilityChange,
  disabled,
}: {
  issuer: string;
  onIssuerChange: (issuer: string) => void;
  issuerError?: string | null;
  owners: readonly OwnerOption[];
  ownerId: string;
  onOwnerChange: (memberId: string) => void;
  colorClassOf: (memberId: string) => string;
  visibility: CardVisibility;
  onVisibilityChange: (visibility: CardVisibility) => void;
  disabled?: boolean;
}) {
  return (
    <FieldList>
      <FieldRow
        label="카드사"
        value={issuer || "고르기"}
        muted={!issuer}
        disabled={disabled}
        menu={{
          label: "카드사",
          options: ISSUER_PICKER,
          value: issuer || null,
          onSelect: onIssuerChange,
        }}
      >
        {issuerError ? <FieldError>{issuerError}</FieldError> : undefined}
      </FieldRow>
      <OwnerRow
        owners={owners}
        value={ownerId}
        onChange={onOwnerChange}
        colorClassOf={colorClassOf}
        disabled={disabled}
      >
        같은 카드 상품을 각자 쓰면 소유자와 뒤 4자리를 각각 등록해 주세요.
      </OwnerRow>
      <VisibilityRow
        value={visibility}
        onChange={onVisibilityChange}
        disabled={disabled}
      >
        {visibilityOf(visibility)?.description}
      </VisibilityRow>
    </FieldList>
  );
}

/**
 * 수정 창의 값: 소유자 · 공개 범위 · 결제일 · 공용 카드.
 * 소유자·공개 범위의 설명은 처음 값에서 바꿨을 때만 붙인다 — 둘 다 지난 거래에는 소급되지 않는다.
 * '공용 카드'는 반대로 지난 기록까지 바뀌므로 그 차이를 늘 한 줄로 적는다.
 */
export function CardEditFields({
  original,
  owners,
  ownerId,
  onOwnerChange,
  colorClassOf,
  visibility,
  onVisibilityChange,
  billingDay,
  onBillingDayChange,
  isShared,
  onSharedChange,
  sharedError,
  disabled,
}: {
  /** 창을 열 때의 카드 값 — 무엇이 바뀌었는지 보고 설명을 붙인다. */
  original: Pick<CardSummary, "ownerMemberId" | "visibility">;
  owners: readonly OwnerOption[];
  ownerId: string;
  onOwnerChange: (memberId: string) => void;
  colorClassOf: (memberId: string) => string;
  visibility: CardVisibility;
  onVisibilityChange: (visibility: CardVisibility) => void;
  /** "" = 선택 안 함. */
  billingDay: string;
  onBillingDayChange: (day: string) => void;
  isShared: boolean;
  onSharedChange: (shared: boolean) => void;
  sharedError?: string | null;
  disabled?: boolean;
}) {
  const visibilityChanged = visibility !== original.visibility;
  return (
    <FieldList>
      <OwnerRow
        owners={owners}
        value={ownerId}
        onChange={onOwnerChange}
        colorClassOf={colorClassOf}
        disabled={disabled}
      >
        {ownerId !== original.ownerMemberId
          ? "거래에 이미 기록된 구성원은 그대로예요."
          : undefined}
      </OwnerRow>
      <VisibilityRow
        value={visibility}
        onChange={onVisibilityChange}
        disabled={disabled}
      >
        {visibilityChanged
          ? `${
              visibilityOf(visibility)?.description ?? ""
            } 앞으로 들어올 거래부터 적용돼요.`
          : undefined}
      </VisibilityRow>
      <FieldRow
        label="결제일"
        value={billingDay ? `매월 ${billingDay}일` : "선택 안 함"}
        muted={!billingDay}
        disabled={disabled}
        menu={{
          label: "결제일",
          options: BILLING_DAY_OPTIONS,
          value: billingDay || BILLING_NONE,
          onSelect: (next) =>
            onBillingDayChange(next === BILLING_NONE ? "" : next),
        }}
      />
      <SwitchFieldRow
        id="edit-is-shared"
        label="공용 카드"
        checked={isShared}
        onCheckedChange={onSharedChange}
        // 나만 보기면 켤 수 없다. 이미 켜져 있으면 끌 수는 있어야 한다 — 막아 두면 공개 범위를 되돌리는 것 말고는 빠져나갈 길이 없다.
        disabled={disabled || (visibility === "private" && !isShared)}
      >
        {/*
          공개 범위와 달리 이 설정은 **과거까지 함께** 바뀐다. 거래를 고치지 않고 집계가 카드 플래그를
          읽기 때문이다 — 그래서 켜고 끄는 것으로 되돌린다. "앞으로만 적용되겠지"라고 오해하지 않게 적는다.
        */}
        {sharedError ? (
          <FieldError>{sharedError}</FieldError>
        ) : (
          <span>
            {visibility !== "private"
              ? "켜면 구성원별 지출에서 이 카드 결제를 지난 기록까지 '공용'으로 묶어요."
              : isShared
                ? "나만 보기 카드는 공용 카드로 둘 수 없어요. 이 설정을 꺼 주세요."
                : "나만 보기 카드는 공용 카드로 둘 수 없어요."}
          </span>
        )}
      </SwitchFieldRow>
    </FieldList>
  );
}
