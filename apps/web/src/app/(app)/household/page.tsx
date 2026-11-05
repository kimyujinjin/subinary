"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 가족 (오늘의집 톤)
 *
 * - 머리 = 가족 이름 + `이름 바꾸기`(소유자·관리자, PATCH /v1/households/:id).
 * - 구성원 = ListRow(이니셜 원형 아바타 · 이름 · 이메일 subtitle · 역할
 *   Select(소유자만)/역할 라벨). 나간 구성원은 접어 둔다.
 * - 아바타 클릭 = 구성원 색상 선택(본인, 또는 소유자·관리자는 모두). 색은 거래·
 *   카드 아이콘 배경으로 전 화면에서 쓰인다. null = 자동(해시) 색.
 * - 나가기/내보내기/초대 취소는 행 끝 ⋯ 메뉴 안에만 두고 AlertDialog로 확인한다(§3.3).
 *   메뉴가 없는 행에도 같은 폭의 빈 자리를 두어 값 칼럼이 세로로 맞게 한다.
 * - 초대 = 쓸 수 있는 초대만 펼치고 지난 초대(수락·만료·취소)는 접는다. 만료 시각이
 *   지난 초대는 서버가 아직 `pending`으로 줘도 만료로 본다(./invitations.ts).
 * - "초대하기" 주 CTA(소유자) → 초대 Dialog. 토큰/링크 1회 노출 Dialog + 복사 보존.
 * - 가족에서 나가면 멤버십을 다시 받아 남은 가족(없으면 온보딩)으로 옮긴다.
 * 권한은 서버에서도 강제(PRD §26). 여기서는 UI 노출/비활성으로 보조.
 * ------------------------------------------------------------------------- */
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Mail, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import type {
  HouseholdRole,
  InvitationCreated,
  InvitationCreateRequest,
  InvitationSummary,
  MemberColor,
  MemberSummary,
} from "@family/contracts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ListLoading,
  ListRow,
  OverflowMenu,
  PageBackHeader,
  SectionHeader,
  StatusChip,
  type OverflowAction,
} from "@/components/widgets";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import {
  MEMBER_COLOR_KEYS,
  MEMBER_COLOR_LABELS,
  MEMBER_COLOR_SWATCH_CLASSES,
  memberColorClass,
  sharedColorClass,
} from "@/lib/member-color";
import {
  queryKeys,
  useHouseholdMembers,
  useHouseholdSummary,
} from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { publicWebUrl } from "@/lib/web-url";

import { PAST_INVITATION_CHIP, splitInvitations } from "./invitations";

const ROLE_LABEL: Record<HouseholdRole, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "구성원",
  viewer: "뷰어",
};

type InvitableRole = "admin" | "member" | "viewer";
const INVITABLE_ROLES: ReadonlyArray<InvitableRole> = [
  "member",
  "admin",
  "viewer",
];

/** 초대 폼: email은 빈 문자열 허용(→ 미지정), expiresInHours는 1~720 정수. */
const inviteFormSchema = z.object({
  email: z
    .union([z.literal(""), z.string().email("올바른 이메일 형식이 아니에요")])
    .optional(),
  role: z.enum(["member", "admin", "viewer"]),
  expiresInHours: z.coerce
    .number()
    .int("정수로 입력해 주세요")
    .min(1, "1~720 사이로 입력해 주세요")
    .max(720, "1~720 사이로 입력해 주세요"),
});
type InviteFormValues = z.input<typeof inviteFormSchema>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** 확인 창이 묻는 대상. */
type ConfirmTarget =
  | { type: "remove" | "leave"; member: MemberSummary }
  | { type: "revoke"; invitation: InvitationSummary };

/** 접힌 목록(나간 구성원·지난 초대)의 여는 줄 — budgets 화면과 같은 모양 + 열림 화살표. */
const FOLD_SUMMARY_CLASS =
  "text-caption text-muted-foreground hover:text-foreground flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium active:text-foreground";
const FOLD_CHEVRON = (
  <ChevronDown
    aria-hidden="true"
    className="size-4 transition-transform group-open:rotate-180"
  />
);

export default function HouseholdPage() {
  const router = useRouter();
  const { authedFetch, user, refreshMemberships } = useAuth();
  const { householdId, activeMembership } = useHousehold();
  const queryClient = useQueryClient();

  const myRole = activeMembership?.role;
  const isOwner = myRole === "owner";
  // 가족 이름·초대 목록·공용 색은 소유자·관리자가 다룬다(서버 권한과 같은 기준).
  const isManager = myRole === "owner" || myRole === "admin";

  const membersQuery = useHouseholdMembers();
  const invitationsQuery = useQuery({
    queryKey: ["household-invitations", householdId],
    enabled: householdId != null && isManager,
    queryFn: () =>
      authedFetch((token) =>
        api.households.invitations(token, householdId as string),
      ),
  });
  const householdQuery = useHouseholdSummary();
  const householdName =
    householdQuery.data?.name ?? activeMembership?.name ?? "";

  // "초대하기" 주 CTA → 초대 Dialog.
  const [inviteOpen, setInviteOpen] = useState(false);

  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);
  // 확인 창의 내용은 닫히는 동안에도 남겨 둔다 — 열림과 함께 비우면 닫히는 애니메이션
  // 동안 제목과 버튼이 다른 확인 문구로 바뀌어 보인다.
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  function askConfirm(target: ConfirmTarget) {
    setConfirm(target);
    setConfirmOpen(true);
  }

  // 가족 이름 바꾸기(소유자·관리자).
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const invalidateMembers = () =>
    queryClient.invalidateQueries({
      queryKey: ["household-members", householdId],
    });
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({
      queryKey: ["household-invitations", householdId],
    });

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: "", role: "member", expiresInHours: 168 },
  });

  const inviteMutation = useMutation({
    mutationFn: (body: InvitationCreateRequest) =>
      authedFetch((token) =>
        api.households.invite(token, householdId as string, body),
      ),
    onSuccess: (result) => {
      void invalidateInvitations();
      form.reset({ email: "", role: "member", expiresInHours: 168 });
      setCopied(false);
      setInviteOpen(false);
      setCreated(result);
      toast.success("초대를 만들었어요.");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "초대를 만들지 못했어요.")),
  });

  const roleMutation = useMutation({
    mutationFn: (input: { memberId: string; role: InvitableRole }) =>
      authedFetch((token) =>
        api.households.updateRole(token, householdId as string, input.memberId, {
          role: input.role,
        }),
      ),
    onSuccess: () => {
      void invalidateMembers();
      toast.success("역할을 변경했어요.");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "역할을 변경하지 못했어요.")),
  });

  const colorMutation = useMutation({
    mutationFn: (input: { memberId: string; color: MemberColor | null }) =>
      authedFetch((token) =>
        api.households.updateColor(
          token,
          householdId as string,
          input.memberId,
          { color: input.color },
        ),
      ),
    onSuccess: () => {
      void invalidateMembers();
      toast.success("색상을 변경했어요.");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "색상을 변경하지 못했어요.")),
  });

  /**
   * 공용 카드 결제의 표시 색.
   *
   * 구성원 색과 저장 위치가 다르다 — 공용은 구성원이 아니라 **가구에 하나뿐인 귀속
   * 보류 묶음**이라 자기 것이라 할 사람이 없다. 그래서 권한도 owner/admin뿐이다.
   */
  const sharedColor = householdQuery.data?.sharedColor ?? null;
  const sharedColorMutation = useMutation({
    mutationFn: (color: MemberColor | null) =>
      authedFetch((token) =>
        api.households.updateSharedColor(token, householdId as string, {
          color,
        }),
      ),
    onSuccess: () => {
      // 홈·거래·카드가 모두 이 값을 읽으므로 가구 요약 캐시를 무효화한다.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.household(householdId),
      });
      toast.success("공용 색상을 변경했어요.");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "공용 색상을 변경하지 못했어요.")),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      authedFetch((token) =>
        api.households.rename(token, householdId as string, { name }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.household(householdId), updated);
      setRenameOpen(false);
      toast.success("가족 이름을 바꿨어요.");
      // 머리의 가족 전환 메뉴는 멤버십 목록의 이름을 읽는다 — 그쪽도 새로 받는다.
      refreshMemberships().catch(() => undefined);
    },
    onError: (error) =>
      setRenameError(errorMessage(error, "가족 이름을 바꾸지 못했어요.")),
  });

  const removeMutation = useMutation({
    mutationFn: (input: {
      householdId: string;
      householdName: string;
      member: MemberSummary;
      leave: boolean;
    }) =>
      authedFetch((token) =>
        api.households.removeMember(
          token,
          input.householdId,
          input.member.memberId,
        ),
      ),
    onSuccess: async (_result, input) => {
      if (!input.leave) {
        void invalidateMembers();
        toast.success(`${input.member.name} 님을 내보냈어요.`);
        return;
      }
      toast.success(
        input.householdName
          ? `'${input.householdName}' 가족에서 나왔어요.`
          : "가족에서 나왔어요.",
      );
      // 나간 가족에는 이제 모든 요청이 403이다. 멤버십을 다시 받아야 활성 가족이 남은
      // 가족으로(없으면 온보딩으로) 옮겨 간다 — 구성원 목록만 다시 받으면 이 화면에 갇힌다.
      try {
        await refreshMemberships();
        // 떠난 가족의 화면 데이터는 기기 캐시(앱 콜드 스타트 캐시 포함)에 남기지 않는다.
        // 멤버십이 바뀐 뒤라 이 키들을 보는 화면은 이미 없다(있으면 403 재요청이 난다).
        queryClient.removeQueries({
          predicate: (query) => query.queryKey.includes(input.householdId),
        });
      } catch {
        toast.error("가족 목록을 새로 받지 못했으니 앱을 다시 열어 주세요.");
      }
      router.replace("/dashboard");
    },
    onError: (error, input) =>
      toast.error(
        errorMessage(
          error,
          input.leave
            ? "가족에서 나가지 못했어요."
            : "구성원을 내보내지 못했어요.",
        ),
      ),
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) =>
      authedFetch((token) =>
        api.households.revokeInvite(token, householdId as string, invitationId),
      ),
    onSuccess: () => {
      void invalidateInvitations();
      toast.success("초대를 취소했어요.");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "초대를 취소하지 못했어요.")),
  });

  function onInvite(values: InviteFormValues) {
    if (!householdId) return;
    const email = values.email?.trim();
    const body: InvitationCreateRequest = {
      role: values.role,
      expiresInHours: Number(values.expiresInHours),
      ...(email ? { email } : {}),
    };
    inviteMutation.mutate(body);
  }

  function inviteLink(c: InvitationCreated): string {
    // 공개 웹 도메인 기준 — 앱(Capacitor) origin은 localhost라 쓸 수 없다.
    return publicWebUrl(`/join?token=${encodeURIComponent(c.token)}`);
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(inviteLink(created));
      setCopied(true);
      toast.success("수락 링크를 복사했어요.");
    } catch {
      toast.error("복사하지 못했어요. 직접 복사해 주세요.");
    }
  }

  function runConfirm() {
    if (!confirm || !householdId) return;
    if (confirm.type === "revoke") {
      revokeMutation.mutate(confirm.invitation.id);
    } else {
      removeMutation.mutate({
        householdId,
        householdName,
        member: confirm.member,
        leave: confirm.type === "leave",
      });
    }
    setConfirmOpen(false);
  }

  function openRename() {
    setRenameDraft(householdName);
    setRenameError(null);
    setRenameOpen(true);
  }

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = renameDraft.trim();
    if (name === "") {
      setRenameError("가족 이름을 입력해 주세요.");
      return;
    }
    if (name === householdName) {
      setRenameOpen(false);
      return;
    }
    setRenameError(null);
    renameMutation.mutate(name);
  }

  const members = membersQuery.data ?? [];
  const activeMembers = members.filter((m) => m.status === "active");
  const formerMembers = members.filter((m) => m.status !== "active");
  const { pending: pendingInvitations, past: pastInvitations } =
    splitInvitations(invitationsQuery.data ?? [], Date.now());
  const busy = removeMutation.isPending || revokeMutation.isPending;

  /** 행 끝 ⋯ 메뉴. 위험 행동(나가기·내보내기)은 이 메뉴 안에만 둔다(§3.3). */
  function memberActions(m: MemberSummary): OverflowAction[] {
    if (m.status !== "active" || m.role === "owner") return [];
    if (m.userId === user?.id) {
      return [
        {
          label: "가족에서 나가기",
          destructive: true,
          disabled: busy,
          onSelect: () => askConfirm({ type: "leave", member: m }),
        },
      ];
    }
    if (!isOwner) return [];
    return [
      {
        label: "내보내기",
        destructive: true,
        disabled: busy,
        onSelect: () => askConfirm({ type: "remove", member: m }),
      },
    ];
  }
  // 메뉴가 있는 행과 없는 행의 값 칼럼이 세로로 맞도록, 하나라도 있으면 빈 자리를 둔다.
  const hasMemberAction = activeMembers.some(
    (m) => memberActions(m).length > 0,
  );

  function renderMember(m: MemberSummary) {
    const editable = isOwner && m.status === "active" && m.role !== "owner";
    const isSelf = m.userId === user?.id;
    // 색상은 본인, 또는 소유자·관리자가 아무 구성원이나 변경.
    const canEditColor = m.status === "active" && (isSelf || isManager);
    const actions = memberActions(m);
    const initial = m.name.slice(0, 1) || "?";
    return (
      <div key={m.memberId} className="flex items-center gap-1">
        <ListRow
          className="min-w-0 flex-1"
          icon={
            canEditColor ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${m.name} 색상 변경`}
                    className="text-body flex size-full items-center justify-center rounded-full font-semibold transition-transform hover:scale-105 active:scale-95"
                  >
                    {initial}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-auto min-w-0 p-2"
                >
                  {/* 견본은 DropdownMenuItem — 화살표 키 순회/자동 닫힘/menuitem
                      시맨틱을 그대로 얻는다(일반 버튼이면 키보드 접근 불가). */}
                  <div className="grid grid-cols-4 gap-1">
                    {MEMBER_COLOR_KEYS.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        aria-label={`${MEMBER_COLOR_LABELS[key]} 색상 선택`}
                        disabled={colorMutation.isPending}
                        className="size-11 justify-center rounded-full p-0"
                        onSelect={() => {
                          if (m.color !== key) {
                            colorMutation.mutate({
                              memberId: m.memberId,
                              color: key,
                            });
                          }
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-6 rounded-full",
                            MEMBER_COLOR_SWATCH_CLASSES[key],
                            m.color === key &&
                              "ring-ring ring-offset-background ring-2 ring-offset-2",
                          )}
                        />
                      </DropdownMenuItem>
                    ))}
                  </div>
                  <DropdownMenuItem
                    disabled={colorMutation.isPending || m.color === null}
                    className="text-muted-foreground text-caption mt-1 justify-center font-medium"
                    onSelect={() =>
                      colorMutation.mutate({
                        memberId: m.memberId,
                        color: null,
                      })
                    }
                  >
                    자동 색상으로
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-body font-semibold">{initial}</span>
            )
          }
          iconClassName={memberColorClass(m.memberId, m.color)}
          title={
            isSelf ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{m.name}</span>
                <StatusChip>나</StatusChip>
              </span>
            ) : (
              m.name
            )
          }
          subtitle={m.email}
          value={
            editable ? (
              <Select
                value={m.role}
                onValueChange={(role) =>
                  role !== m.role &&
                  roleMutation.mutate({
                    memberId: m.memberId,
                    role: role as InvitableRole,
                  })
                }
                disabled={roleMutation.isPending}
              >
                {/* 채움색은 공용 SelectTrigger 그대로 — 테두리·카드색으로 덮으면 흰 패널
                    위에서 선택칸이 사라진다(2026-11 진단). */}
                <SelectTrigger
                  size="sm"
                  aria-label={`${m.name} 역할 변경`}
                  className="text-caption font-medium"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span
                className={
                  m.role === "owner"
                    ? "text-caption font-semibold"
                    : "text-muted-foreground text-caption font-medium"
                }
              >
                {ROLE_LABEL[m.role]}
              </span>
            )
          }
        />
        {actions.length > 0 ? (
          <OverflowMenu
            label={`${m.name} 메뉴`}
            actions={actions}
            className="shrink-0"
          />
        ) : hasMemberAction && m.status === "active" ? (
          <span aria-hidden="true" className="size-11 shrink-0" />
        ) : null}
      </div>
    );
  }

  function invitationTitle(i: InvitationSummary) {
    return (
      i.email ?? (
        <span className="text-muted-foreground">이메일 지정 없음</span>
      )
    );
  }

  function renderPendingInvitation(i: InvitationSummary) {
    return (
      <div key={i.id} className="flex items-center gap-1">
        <ListRow
          className="min-w-0 flex-1"
          icon={<Mail />}
          iconClassName="bg-muted text-muted-foreground"
          title={invitationTitle(i)}
          subtitle={`${ROLE_LABEL[i.role]} · ${formatDate(i.expiresAt)}까지`}
        />
        {isOwner ? (
          <OverflowMenu
            label={`${i.email ?? "이메일 지정 없음"} 초대 메뉴`}
            className="shrink-0"
            actions={[
              {
                label: "초대 취소",
                destructive: true,
                disabled: busy,
                onSelect: () => askConfirm({ type: "revoke", invitation: i }),
              },
            ]}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageBackHeader title="가족" />

      {/* 가족 이름 + 구성원 */}
      <section
        className="finance-panel min-w-0 px-5 pt-2 pb-3"
        aria-label="구성원"
      >
        <SectionHeader
          title={householdName || "구성원"}
          actionLabel={isManager && householdName ? "이름 바꾸기" : undefined}
          onAction={openRename}
        />
        {membersQuery.isLoading ? (
          <ListLoading rows={2} label="구성원을 불러오는 중이에요." />
        ) : membersQuery.isError ? (
          <p className="text-destructive text-caption py-2" role="alert">
            {errorMessage(membersQuery.error, "구성원을 불러오지 못했어요.")}
          </p>
        ) : activeMembers.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="아직 구성원이 없어요"
            description="초대 링크를 만들어 가족을 초대해 보세요"
          />
        ) : (
          <div className="flex flex-col">{activeMembers.map(renderMember)}</div>
        )}
        {formerMembers.length > 0 ? (
          <details className="group min-w-0">
            <summary className={FOLD_SUMMARY_CLASS}>
              나간 구성원 {formerMembers.length}명
              {FOLD_CHEVRON}
            </summary>
            <div className="flex flex-col">{formerMembers.map(renderMember)}</div>
          </details>
        ) : null}
      </section>

      {/* 초대 (소유자·관리자) — 쓸 수 있는 초대만 펼치고 지난 초대는 접는다. */}
      {isManager ? (
        <section
          className="finance-panel min-w-0 px-5 pt-2 pb-5"
          aria-label="초대"
        >
          <SectionHeader title="초대" />
          {invitationsQuery.isLoading ? (
            <ListLoading rows={1} label="초대를 불러오는 중이에요." />
          ) : invitationsQuery.isError ? (
            <p className="text-destructive text-caption py-2" role="alert">
              {errorMessage(
                invitationsQuery.error,
                "초대를 불러오지 못했어요.",
              )}
            </p>
          ) : pendingInvitations.length === 0 ? (
            <EmptyState
              className="py-6"
              icon={<Mail />}
              title={
                pastInvitations.length > 0
                  ? "대기 중인 초대가 없어요"
                  : "아직 보낸 초대가 없어요"
              }
              description={
                // 초대는 소유자만 만든다(서버 createInvitation도 owner 전용).
                isOwner
                  ? "초대하기를 누르면 수락 링크를 만들 수 있어요"
                  : "초대는 소유자만 만들 수 있어요"
              }
            />
          ) : (
            <div className="flex flex-col">
              {pendingInvitations.map(renderPendingInvitation)}
            </div>
          )}
          {pastInvitations.length > 0 ? (
            <details className="group min-w-0">
              <summary className={FOLD_SUMMARY_CLASS}>
                지난 초대 {pastInvitations.length}개
                {FOLD_CHEVRON}
              </summary>
              <div className="flex flex-col">
                {pastInvitations.map(({ invitation: i, status }) => (
                  <ListRow
                    key={i.id}
                    icon={<Mail />}
                    iconClassName="bg-muted text-muted-foreground"
                    title={invitationTitle(i)}
                    subtitle={`${ROLE_LABEL[i.role]} · ${formatDate(i.createdAt, { dateOnly: true })} 초대`}
                    valueSub={
                      <StatusChip tone={PAST_INVITATION_CHIP[status].tone}>
                        {PAST_INVITATION_CHIP[status].label}
                      </StatusChip>
                    }
                  />
                ))}
              </div>
            </details>
          ) : null}
          {/* 주 CTA — 초대 Dialog 열기 (소유자) */}
          {isOwner ? (
            <Button
              type="button"
              size="lg"
              className="mt-3 w-full"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus /> 초대하기
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* 공용 카드 색상 — 구성원이 아니라 가구 단위 설정이라 따로 둔다.
          owner/admin만 바꿀 수 있다(자기 것이라 할 사람이 없는 값이다). */}
      {isManager ? (
        <section
          className="finance-panel min-w-0 px-5 pt-2 pb-5"
          aria-label="공용 카드 색상"
        >
          <SectionHeader title="공용 카드 색상" />
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "text-caption flex size-10 shrink-0 items-center justify-center rounded-full font-semibold",
                sharedColorClass(sharedColor),
              )}
            >
              공용
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {MEMBER_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`공용 카드 ${MEMBER_COLOR_LABELS[key]} 색상 선택`}
                  disabled={sharedColorMutation.isPending}
                  onClick={() => {
                    if (sharedColor !== key) sharedColorMutation.mutate(key);
                  }}
                  className="rounded-full p-0.5 disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block size-6 rounded-full",
                      MEMBER_COLOR_SWATCH_CLASSES[key],
                      sharedColor === key &&
                        "ring-ring ring-offset-background ring-2 ring-offset-2",
                    )}
                  />
                </button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground ml-1 h-7 px-2"
                disabled={
                  sharedColorMutation.isPending || sharedColor === null
                }
                onClick={() => sharedColorMutation.mutate(null)}
              >
                회색으로
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 가족 이름 바꾸기 (소유자·관리자) */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>가족 이름 바꾸기</DialogTitle>
            <DialogDescription>바꾼 이름은 가족 모두에게 보여요.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onRename} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="household-name">가족 이름</Label>
              <Input
                id="household-name"
                type="text"
                maxLength={100}
                required
                value={renameDraft}
                aria-invalid={renameError ? true : undefined}
                onChange={(e) => {
                  setRenameDraft(e.target.value);
                  setRenameError(null);
                }}
              />
              {renameError ? (
                <p className="text-destructive text-caption" role="alert">
                  {renameError}
                </p>
              ) : null}
            </div>
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={renameMutation.isPending || renameDraft.trim() === ""}
              >
                {renameMutation.isPending ? "저장 중…" : "저장하기"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full"
                onClick={() => setRenameOpen(false)}
              >
                닫기
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 초대 Dialog (소유자) — 기존 RHF 폼 이동, 로직 보존 */}
      {isOwner ? (
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>가족 초대하기</DialogTitle>
              <DialogDescription>
                만들면 수락 링크가 한 번만 보여요.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onInvite)}
                className="flex flex-col gap-4"
                noValidate
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이메일 (선택)</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="초대할 사람의 이메일"
                          {...field}
                        />
                      </FormControl>
                      {/* 메일 발송 기능은 없다 — 서버는 수락할 때 계정 이메일만 대조한다. */}
                      <FormDescription className="text-caption">
                        메일은 보내지 않으며, 적으면 그 이메일로 로그인한 계정만
                        수락할 수 있어요.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>역할</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger className="min-h-12 w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {INVITABLE_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="expiresInHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>만료 (시간)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={720}
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={String(field.value ?? "")}
                            onChange={(e) => field.onChange(e.target.value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter className="flex-col sm:flex-col">
                  <Button
                    type="submit"
                    className="h-11 w-full"
                    disabled={inviteMutation.isPending}
                  >
                    {inviteMutation.isPending
                      ? "만드는 중…"
                      : "초대 만들기"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-full"
                    onClick={() => setInviteOpen(false)}
                  >
                    닫기
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* 초대 생성 결과 — 토큰/링크 1회 노출 */}
      <Dialog
        open={created !== null}
        onOpenChange={(o) => !o && setCreated(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>초대 링크가 만들어졌어요</DialogTitle>
            <DialogDescription>
              링크는 지금만 보이니 닫기 전에 가족에게 보내 주세요.
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="flex flex-col gap-4">
              <div className="bg-muted text-body grid grid-cols-2 gap-3 rounded-control p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-caption">역할</span>
                  <span className="font-medium">
                    {ROLE_LABEL[created.role]}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-caption">만료</span>
                  <span className="font-medium">
                    {formatDate(created.expiresAt)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-caption">
                  수락 링크
                </span>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={inviteLink(created)}
                    className="text-caption font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={copyLink}
                    aria-label="수락 링크 복사"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-col sm:flex-col">
            <Button className="h-11 w-full" onClick={() => setCreated(null)}>
              전달했어요
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 위험 동작 확인 — 메뉴(⋯)에서만 열린다 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === "leave"
                ? householdName
                  ? `'${householdName}' 가족에서 나갈까요?`
                  : "가족에서 나갈까요?"
                : confirm?.type === "remove"
                  ? `${confirm.member.name} 님을 내보낼까요?`
                  : "초대를 취소할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "leave"
                ? "다시 함께하려면 새 초대를 받아야 해요."
                : confirm?.type === "remove"
                  ? "필요하면 언제든 다시 초대할 수 있어요."
                  : "보낸 링크로는 더 이상 들어올 수 없어요."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              onClick={runConfirm}
              variant="destructive"
            >
              {confirm?.type === "leave"
                ? "나가기"
                : confirm?.type === "remove"
                  ? "내보내기"
                  : "초대 취소"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
