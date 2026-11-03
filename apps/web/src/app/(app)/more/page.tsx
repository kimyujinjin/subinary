"use client";
/**
 * 설정: 가족·연결·계정과 가끔 사용하는 관리 도구.
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
  Link2,
  LogOut,
  ListChecks,
  Repeat,
  Search,
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
import { Input } from "@/components/ui/input";
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
  description?: string;
}

interface MoreGroup {
  key: string;
  title: string;
  items: ReadonlyArray<MoreItem>;
}

const GROUPS: ReadonlyArray<MoreGroup> = [
  { key: "household", title: "가족 · 연결", items: [
    { href: "/more/connections", icon: Link2, title: "자동 연결", description: "신한·토스증권·토스뱅크·국민은행" },
    { href: "/cards", icon: CreditCard, title: "결제 카드" },
    { href: "/devices", icon: Smartphone, title: "문자 연동", description: "카드 문자를 보내는 휴대폰" },
    { href: "/household", icon: Users, title: "가족 관리" },
  ] },
  { key: "account", title: "내 계정", items: [
    { href: "/more/notifications", icon: Bell, title: "알림" },
    { href: "/more/privacy", icon: ShieldCheck, title: "개인정보" },
    { href: "/more/password", icon: KeyRound, title: "비밀번호 변경", description: "변경 후 모든 기기에서 다시 로그인" },
  ] },
];
const ADVANCED_GROUP: MoreGroup = { key: "advanced", title: "가계부 관리", items: [
  { href: "/categories", icon: Tags, title: "카테고리", description: "지출 분류 추가·수정" },
  { href: "/more/merchants", icon: Store, title: "가맹점 정리", description: "같은 가게의 여러 이름 묶기" },
  { href: "/more/recurring", icon: Repeat, title: "정기 지출", description: "반복되는 결제 확인" },
  { href: "/more/category-rules", icon: Wand2, title: "자동 분류 규칙", description: "분류 기준과 지난 거래에 적용" },
  { href: "/todo", icon: ListChecks, title: "확인할 거래", description: "문자 확인과 결제 처리 상태" },
  { href: "/declines", icon: AlertTriangle, title: "실패한 결제", description: "이전 결제 실패 내역" },
  { href: "/ai", icon: Sparkles, title: "AI 도우미", description: "질문하기와 자료 가져오기" },
] };
const LEGACY_RECORDS_GROUP: MoreGroup = { key: "legacy", title: "기존 비공개 기록", items: [
  { href: "/assets?scope=private", icon: Wallet, title: "기존 비공개 자산", description: "이전에 나만 보도록 저장한 기록" },
  { href: "/plan?scope=private", icon: Flag, title: "기존 비공개 주택 계획", description: "가족에게 공개하지 않고 보관 중인 기록" },
] };

/** owner·admin에게만 보이는 개발자 화면. 일반 목록과 섞지 않는다. */
const OPERATIONS_GROUP: MoreGroup = {
  key: "operations",
  title: "운영자 도구",
  items: [
    {
      href: "/ai-operations",
      icon: Activity,
      title: "AI 처리 현황",
      description: "대기 작업·오류·사용량",
    },
  ],
};

/** 아이콘과 설명을 나란히 놓는 설정 행. */
function MoreRow({ item, divided }: Readonly<{ item: MoreItem; divided: boolean }>) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`hover:bg-muted/60 focus-visible:ring-ring flex min-h-16 items-center gap-3 px-4 py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
        divided ? "border-t border-border/50" : ""
      }`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${item.href === "/more/connections" ? "bg-finance-highlight text-finance-highlight-foreground" : "bg-muted/80 text-muted-foreground"}`}>
        <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{item.title}</span>
        {item.description ? <span className="text-muted-foreground text-xs leading-5 [overflow-wrap:anywhere]">{item.description}</span> : null}
      </span>
      <ChevronRight className="text-muted-foreground/40 size-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}

function MoreSection({
  group,
  children,
}: Readonly<{ group: MoreGroup; children?: ReactNode }>) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <h2 className="text-foreground px-1 text-sm font-bold">
        {group.title}
      </h2>
      <div className="finance-panel overflow-hidden">
        {group.items.map((item, i) => (
          <MoreRow key={item.href} item={item} divided={i > 0} />
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
    <div className="flex min-h-16 items-center gap-3 border-t border-border/50 px-4 py-3.5">
      <span className="text-muted-foreground flex size-9 shrink-0 items-center justify-center">
        <Fingerprint className="size-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">생체인식 잠금</span>
        <span className="text-muted-foreground text-xs leading-5">
          앱을 열 때 Face ID·지문으로 본인을 확인해요
        </span>
      </span>
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
      className="hover:bg-muted/60 focus-visible:ring-ring flex min-h-16 w-full items-center gap-3 border-t border-border/50 px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-60"
    >
      <span className="text-muted-foreground flex size-9 shrink-0 items-center justify-center">
        <LogOut className="size-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="text-muted-foreground text-[15px] font-medium">
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
  const [search, setSearch] = useState("");
  const query = search.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  // 권한으로 걸러진 메뉴만 검색한다. 검색이 숨겨진 운영 메뉴를 노출하지 않는다.
  const searchableGroups = [
    ...GROUPS, ADVANCED_GROUP, LEGACY_RECORDS_GROUP,
    ...(canViewOperations ? [OPERATIONS_GROUP] : []),
  ];
  const matchingItems = searchableGroups.flatMap((group) => group.items).filter(
    (item) => `${item.title} ${item.description ?? ""}`.replace(/\s+/g, "").toLocaleLowerCase("ko-KR").includes(query),
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-7">
      {/* 누구로 로그인해 있는지 — 예전에는 아바타 드롭다운에만 있던 정보다.
          아바타가 링크가 되면서 이 화면이 그 자리를 대신한다. */}
      <header className="space-y-5">
        <h1 className="text-[28px] font-bold tracking-tight">설정</h1>
        <div className="finance-panel min-w-0 space-y-1.5 p-5">
          <p className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{user?.name ?? "사용자"}</p>
          <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
            {user?.email ?? ""}
            {activeMembership ? ` · ${activeMembership.name}` : ""}
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <label htmlFor="settings-search" className="sr-only">설정 검색</label>
        <div className="relative">
          <Search aria-hidden="true" className="text-muted-foreground pointer-events-none absolute left-3 top-4 size-4" />
          <Input id="settings-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="카드, 알림, 자동 분류 검색" className="min-h-12 rounded-2xl border-border/70 bg-card pl-10 shadow-none" />
        </div>
        {query ? <p role="status" className="text-muted-foreground text-xs">검색 결과 {matchingItems.length}개</p> : null}
      </div>

      {query ? (
        matchingItems.length ? <MoreSection group={{ key: "search", title: "검색 결과", items: matchingItems }} /> :
          <div className="space-y-2 py-6 text-center"><p className="font-medium">일치하는 메뉴가 없어요</p><p className="text-muted-foreground text-sm">카드, 가족, 알림처럼 짧게 검색해 보세요.</p></div>
      ) : null}

      <div className={query ? "hidden" : "space-y-7"}>
      {GROUPS.map((group) =>
        group.key === "account" ? (
          <MoreSection key={group.key} group={group}>
            <ThemeSettingRow />
            <BiometricToggleRow />
            <LogoutRow />
          </MoreSection>
        ) : (
          <MoreSection key={group.key} group={group} />
        ),
      )}

      <details className="min-w-0 border-t border-border/70 pt-2">
        <summary className="text-muted-foreground focus-visible:outline-ring min-h-11 cursor-pointer rounded-lg py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">상세 설정</summary>
        <div className="mt-4 space-y-7">
          <MoreSection group={ADVANCED_GROUP} />
          <MoreSection group={LEGACY_RECORDS_GROUP} />
          {canViewOperations ? <MoreSection group={OPERATIONS_GROUP} /> : null}
        </div>
      </details>
      </div>
    </div>
  );
}
