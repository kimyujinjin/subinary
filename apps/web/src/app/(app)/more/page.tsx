"use client";
/**
 * 전체 탭(ADR-0037): 가계부 관리·가족·연결·계정.
 * 기존 메뉴, 네이티브 생체인식 설정과 owner/admin 운영 도구의 조건을 보존한다.
 */
import {
  Activity,
  Bell,
  ChevronRight,
  CreditCard,
  Fingerprint,
  Flag,
  KeyRound,
  Link2,
  LogOut,
  Repeat,
  ShieldCheck,
  Smartphone,
  Store,
  Sparkles,
  Tags,
  Users,
  Wallet,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ThemeSettingRow } from "@/components/theme-toggle";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth-context";
import {
  authenticateBiometric,
  getBiometricPref,
  isBiometryAvailable,
  setBiometricPref,
} from "@/lib/biometric";
import { useHousehold } from "@/lib/household-context";

interface MoreItem {
  href: string;
  icon: LucideIcon;
  title: string;
}

interface MoreGroup {
  key: string;
  title: string;
  items: ReadonlyArray<MoreItem>;
}

/**
 * 전체 탭(ADR-0037). 행은 아이콘 · 제목 · 화살표 한 줄이다 — 설명 문구를 붙이지 않는다
 * (docs/ux-renewal-2026-11.md §5 설정). 할 일·실패한 결제는 가계부 '할 일'에 있으므로 여기서 뺐다.
 */
const GROUPS: ReadonlyArray<MoreGroup> = [
  {
    key: "ledger",
    title: "가계부",
    items: [
      { href: "/ai", icon: Sparkles, title: "AI 도우미" },
      { href: "/more/recurring", icon: Repeat, title: "정기 지출" },
      { href: "/categories", icon: Tags, title: "카테고리" },
      { href: "/more/category-rules", icon: Wand2, title: "자동 분류 규칙" },
      { href: "/more/merchants", icon: Store, title: "가맹점 정리" },
    ],
  },
  {
    key: "household",
    title: "가족 · 연결",
    items: [
      { href: "/household", icon: Users, title: "가족 관리" },
      { href: "/cards", icon: CreditCard, title: "결제 카드" },
      { href: "/devices", icon: Smartphone, title: "문자 연동" },
      { href: "/more/connections", icon: Link2, title: "은행·증권 연결" },
    ],
  },
  {
    key: "account",
    title: "내 계정",
    items: [
      { href: "/more/notifications", icon: Bell, title: "알림" },
      { href: "/more/privacy", icon: ShieldCheck, title: "개인정보" },
      { href: "/more/password", icon: KeyRound, title: "비밀번호 변경" },
    ],
  },
];
const LEGACY_RECORDS_GROUP: MoreGroup = {
  key: "legacy",
  title: "보관한 기록",
  items: [
    { href: "/assets?scope=private", icon: Wallet, title: "비공개 자산" },
    { href: "/plan?scope=private", icon: Flag, title: "비공개 주택 계획" },
  ],
};

/** owner·admin에게만 보이는 운영 화면. 일반 목록과 섞지 않는다. */
const OPERATIONS_GROUP: MoreGroup = {
  key: "operations",
  title: "운영자 도구",
  items: [{ href: "/ai-operations", icon: Activity, title: "AI 처리 현황" }],
};

const ROW_CLASS =
  "hover:bg-muted/60 active:bg-muted focus-visible:ring-ring flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset";

/** 아이콘(배경 없음) · 제목 · 화살표. */
function MoreRow({ item }: Readonly<{ item: MoreItem }>) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className={ROW_CLASS}>
      <Icon className="text-muted-foreground size-[22px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
      <span className="text-body min-w-0 flex-1">{item.title}</span>
      <ChevronRight className="text-muted-foreground/40 size-5 shrink-0" aria-hidden="true" />
    </Link>
  );
}

function MoreSection({
  group,
  children,
}: Readonly<{ group: MoreGroup; children?: ReactNode }>) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-caption text-muted-foreground px-1 font-semibold">{group.title}</h2>
      <div className="finance-panel overflow-hidden py-1">
        {group.items.map((item) => (
          <MoreRow key={item.href} item={item} />
        ))}
        {children}
      </div>
    </section>
  );
}

/**
 * 생체인식 잠금 토글 행(네이티브 전용).
 * 켜기는 본인 확인을 통과해야 하고, 끄기는 즉시 반영한다.
 * '내 계정' 묶음 안에 든다 — 이 기기의 내 잠금이지 가족 설정이 아니다.
 */
function BiometricToggleRow() {
  // null = 로딩/미지원(행 숨김), 그 외 = 토글 상태.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!(await isBiometryAvailable())) return;
      setEnabled((await getBiometricPref()) === "on");
    })();
  }, []);

  if (enabled === null) return null;

  async function onToggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        const gate = await authenticateBiometric(
          "생체인식 잠금을 켜려면 본인 확인이 필요해요"
        );
        if (gate !== "ok") {
          if (gate === "unsupported") {
            toast.error("이 기기에서는 생체인식을 사용할 수 없어요.");
          } else if (gate === "failed") {
            toast.error("본인 확인에 실패했어요.");
          } else if (gate === "interrupted") {
            // 사용자가 취소한 게 아니라 화면이 프롬프트를 거둔 것이다. 아무 말도
            // 없이 토글이 되돌아가면 "눌러도 안 되는 버튼"으로 읽힌다.
            toast.error("본인 확인 창이 닫혔어요. 다시 눌러 주세요.");
          }
          return;
        }
        await setBiometricPref("on");
        setEnabled(true);
        toast.success("생체인식 잠금을 켰어요.");
      } else {
        await setBiometricPref("off");
        setEnabled(false);
        toast.success("생체인식 잠금을 껐어요.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-14 items-center gap-4 px-5 py-3">
      <Fingerprint className="text-muted-foreground size-[22px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
      <span className="text-body min-w-0 flex-1">생체인식 잠금</span>
      <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Switch
          className="relative before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']"
          checked={enabled}
          disabled={busy}
          onCheckedChange={(next) => void onToggle(next)}
          aria-label="생체인식 잠금"
        />
      </span>
    </div>
  );
}

/**
 * 로그아웃 — 예전에는 헤더 아바타 드롭다운에 있었다. 아바타가 `/more`로 가는 링크가
 * 되면서 이리로 내려왔고, 계정 묶음의 마지막 행이 자연스러운 자리다.
 */
function LogoutRow() {
  const router = useRouter();
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
    } finally {
      // 보안 저장소 삭제 오류가 나도 메모리 세션은 이미 닫혔으므로 로그인 화면으로 이동한다.
      router.replace("/login");
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onLogout()}
      className={`${ROW_CLASS} disabled:opacity-60`}
    >
      <LogOut className="text-muted-foreground size-[22px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
      <span className="text-body text-muted-foreground">
        {busy ? "로그아웃하는 중…" : "로그아웃"}
      </span>
    </button>
  );
}

export default function MorePage() {
  const { activeMembership } = useHousehold();
  const { user } = useAuth();
  const canViewOperations =
    activeMembership?.role === "owner" || activeMembership?.role === "admin";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-1 px-1">
        <h1 className="text-title">전체</h1>
        {/* 누구로 로그인해 있는지 — 계정 확인은 한 줄이면 충분하다. */}
        <p className="text-caption text-muted-foreground truncate">
          {user?.name ?? "사용자"} · {user?.email ?? ""}
        </p>
      </header>

      {GROUPS.map((group) =>
        group.key === "account" ? (
          <MoreSection key={group.key} group={group}>
            <ThemeSettingRow />
            <BiometricToggleRow />
            <LogoutRow />
          </MoreSection>
        ) : (
          <MoreSection key={group.key} group={group} />
        )
      )}
      <MoreSection group={LEGACY_RECORDS_GROUP} />
      {canViewOperations ? <MoreSection group={OPERATIONS_GROUP} /> : null}
    </div>
  );
}
