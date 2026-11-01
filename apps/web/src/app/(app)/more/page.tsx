"use client";
/**
 * 전체: 새 자산·계획과 기존 가계부·관리 도구를 한곳에서 찾는다.
 * 기존 메뉴, 네이티브 생체인식 설정과 owner/admin 운영 도구의 조건을 보존한다.
 */
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronRight,
  CreditCard,
  Fingerprint,
  Flag,
  KeyRound,
  LogOut,
  ListChecks,
  Receipt,
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

import { Card } from "@/components/ui/card";
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
  description: string;
}

interface MoreGroup {
  key: string;
  title: string;
  items: ReadonlyArray<MoreItem>;
}

const GROUPS: ReadonlyArray<MoreGroup> = [
  {
    key: "position",
    title: "자산과 계획",
    items: [
      { href: "/assets", icon: Wallet, title: "자산", description: "현재 자산의 기준과 결제 카드 관리를 확인해요" },
      { href: "/plan", icon: Flag, title: "계획", description: "주택 지급 일정과 준비할 정보를 살펴봐요" },
    ],
  },
  {
    key: "records",
    title: "돈의 기록과 확인",
    items: [
      { href: "/transactions", icon: Receipt, title: "거래 검색", description: "카드 승인·취소와 확인이 필요한 거래를 찾아요" },
      { href: "/ledger/analysis", icon: Activity, title: "소비 분석", description: "기록된 카드 지출을 월별로 살펴봐요" },
      { href: "/budgets", icon: Wallet, title: "예산", description: "선택한 달의 예산과 사용률을 확인해요" },
      { href: "/todo", icon: ListChecks, title: "확인할 일", description: "문자 검토·실패한 결제와 반영 상태를 확인해요" },
      { href: "/ai", icon: Sparkles, title: "AI 도우미", description: "기존 AI 대화와 가져오기 기능으로 이동해요" },
    ],
  },
  {
    key: "household",
    title: "가계 설정",
    items: [
      {
        href: "/household",
        icon: Users,
        title: "가족 관리",
        description: "구성원 초대·역할, 대기 중인 초대를 관리해요",
      },
      {
        href: "/cards",
        icon: CreditCard,
        title: "결제 카드",
        description: "카드를 등록하면 문자 내역이 자동으로 연결돼요",
      },
      {
        href: "/categories",
        icon: Tags,
        title: "카테고리 관리",
        description: "우리 가족만의 지출 카테고리를 만들고 정리해요",
      },
      {
        href: "/more/merchants",
        icon: Store,
        title: "가맹점 정리",
        description: "같은 가게가 여러 이름으로 나뉘어 있으면 하나로 묶어요",
      },
      {
        href: "/more/recurring",
        icon: Repeat,
        title: "정기 지출",
        description: "매달 빠져나가는 결제를 찾아 확인해요",
      },
      {
        href: "/more/category-rules",
        icon: Wand2,
        title: "카테고리 규칙",
        description: "자동으로 붙는 카테고리를 확인하고 과거에도 적용해요",
      },
    ],
  },
  {
    key: "collection",
    title: "수집",
    items: [
      {
        href: "/devices",
        icon: Smartphone,
        title: "연결한 기기",
        description: "카드 문자를 보내는 휴대폰을 등록·관리해요",
      },
      {
        // 처리는 '확인할 일' 화면이 갖는다 — 여기는 해결된 것까지 남는 기록이다.
        // 링크를 지우지 않는 이유: 지난 실패를 볼 수 있는 상시 경로가 여기뿐이다.
        href: "/declines",
        icon: AlertTriangle,
        title: "실패한 결제 기록",
        description: "해결된 것까지 모두 남아 있어요 · 처리는 확인할 일에서 해요",
      },
    ],
  },
  {
    key: "account",
    title: "내 계정",
    items: [
      {
        href: "/more/privacy",
        icon: ShieldCheck,
        title: "개인정보",
        description: "무엇에 동의했고 무엇이 수집·보관되는지 확인해요",
      },
      {
        href: "/more/notifications",
        icon: Bell,
        title: "알림 설정",
        description: "푸시 알림·최소 금액·무음 시간대를 조절해요",
      },
      {
        href: "/more/password",
        icon: KeyRound,
        title: "비밀번호 변경",
        description: "바꾸면 모든 기기에서 다시 로그인해야 해요",
      },
    ],
  },
];

/** owner·admin에게만 보이는 개발자 화면. 일반 목록과 섞지 않는다. */
const OPERATIONS_GROUP: MoreGroup = {
  key: "operations",
  title: "운영자 도구",
  items: [
    {
      href: "/ai-operations",
      icon: Activity,
      title: "AI 파이프라인 운영",
      description: "큐·지연·오류·토큰·학습 품질을 확인해요",
    },
  ],
};

/** 목록 행 1개(원형 아이콘 + 제목/설명 + chevron). 높이 72px → 터치 타깃 충족. */
function MoreRow({ item, divided }: Readonly<{ item: MoreItem; divided: boolean }>) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`hover:bg-muted flex items-center gap-3 px-4 py-4 transition-colors active:scale-[0.99] ${
        divided ? "border-t" : ""
      }`}
    >
      <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{item.title}</span>
        <span className="text-muted-foreground text-[13px]">
          {item.description}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground/50 size-4 shrink-0" />
    </Link>
  );
}

function MoreSection({
  group,
  children,
}: Readonly<{ group: MoreGroup; children?: ReactNode }>) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground px-1 text-[13px] font-semibold">
        {group.title}
      </h2>
      <Card className="gap-0 overflow-hidden p-0">
        {group.items.map((item, i) => (
          <MoreRow key={item.href} item={item} divided={i > 0} />
        ))}
        {children}
      </Card>
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
          "생체인식 잠금을 켜려면 본인 확인이 필요해요",
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
    <div className="flex items-center gap-3 border-t px-4 py-4">
      <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
        <Fingerprint className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">생체인식 잠금</span>
        <span className="text-muted-foreground text-[13px]">
          앱을 열 때 Face ID·지문으로 본인을 확인해요
        </span>
      </span>
      <Switch
        checked={enabled}
        disabled={busy}
        onCheckedChange={(next) => void onToggle(next)}
        aria-label="생체인식 잠금"
      />
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
      className="hover:bg-muted flex w-full items-center gap-3 border-t px-4 py-4 text-left transition-colors active:scale-[0.99] disabled:opacity-60"
    >
      <span className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-full">
        <LogOut className="size-5" />
      </span>
      <span className="text-destructive text-[15px] font-medium">
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* 누구로 로그인해 있는지 — 예전에는 아바타 드롭다운에만 있던 정보다.
          아바타가 링크가 되면서 이 화면이 그 자리를 대신한다. */}
      <div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">전체</h1>
        <p className="text-[15px] font-semibold">{user?.name ?? "사용자"}</p>
        <p className="text-muted-foreground text-sm">
          {user?.email ?? ""}
          {activeMembership ? ` · ${activeMembership.name}` : ""}
        </p>
      </div>

      {GROUPS.map((group) =>
        group.key === "account" ? (
          <MoreSection key={group.key} group={group}>
            <BiometricToggleRow />
            <LogoutRow />
          </MoreSection>
        ) : (
          <MoreSection key={group.key} group={group} />
        ),
      )}

      {canViewOperations ? <MoreSection group={OPERATIONS_GROUP} /> : null}
    </div>
  );
}
