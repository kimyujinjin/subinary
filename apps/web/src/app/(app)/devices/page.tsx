"use client";
/* ---------------------------------------------------------------------------
 * 문자 연동 — 연결 확인과 실제 문자 수신을 구분한다.
 *
 * - 기기 행의 메타는 **마지막 문자**(lastEventAt)다. 연결 확인(lastSeenAt)만 보면 자동화의
 *   문자 트리거가 죽어도(인증만 계속 성공) 정상으로 보이고, 사용자는 지출이 왜 비었는지 알 수
 *   없다(진단 D-2). 받다가 끊기면 `끊김` 칩을 단다 — 판정은 deviceSignalChip(diagnoseDeviceSignal의
 *   36시간 기준)이라 워커의 수집 공백 알림과 같은 말을 한다.
 * - 첫 문자 전 기기에는 `설정 미완료` 칩 + 연결 확인 여부 한 줄 + '설정 계속하기'를 둔다.
 *   연결 열쇠를 보여주는 것만으로는 설정이 끝나지 않는다 — 첫 문자가 들어와야 끝난 것이고,
 *   수집 설정 마법사(로드맵 C-2)가 그 지점까지 데려간다.
 * - 다시 발급·연결 해제는 ⋯ 메뉴 안에만 두고 확인 시트를 거친다(§3.3).
 * ------------------------------------------------------------------------- */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Smartphone } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import type {
  DevicePlatform,
  DeviceRegisterRequest,
  DeviceSecretResponse,
  DeviceSummary,
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
import { CollectSetupWizard } from "@/components/collect-setup-wizard";
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
  BottomSheet,
  EmptyState,
  ListLoading,
  ListRow,
  OverflowMenu,
  PageBackHeader,
  StatusChip,
} from "@/components/widgets";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { canManageDevice, findMyMemberId } from "@/lib/device-permission";
import { deviceSignalChip, isSetupComplete } from "@/lib/device-signal";
import { useHousehold } from "@/lib/household-context";
import { useDevices, useHouseholdMembers } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";

/** 플랫폼 표시 라벨. */
const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  ios: "iOS",
  android: "Android",
  other: "기타",
};

const PLATFORM_OPTIONS = (["ios", "android", "other"] as const).map(
  (value) => ({ value, label: PLATFORM_LABEL[value] }),
);

const ROTATE_FAILED = "연결 열쇠를 다시 발급하지 못했어요.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function DevicesPage() {
  const { authedFetch, user } = useAuth();
  const { householdId, activeMembership } = useHousehold();
  const queryClient = useQueryClient();

  const devicesQuery = useDevices();

  // 다시 발급·연결 해제 권한 판정 재료. 둘 다 서버 응답에서 온다 — 역할은 /auth/me의 멤버십,
  // 내 memberId는 구성원 목록에서 내 userId로 찾는다(lib/device-permission.ts).
  // 이 화면에 구성원 목록 요청이 하나 는다(가족·거래·예산 화면과 같은 queryKey라
  // 거기서 오면 캐시가 재사용된다). 소유자는 이 응답 없이도 판정되므로 목록이
  // 늦거나 실패해도 소유자가 자기 기기에서 잠기지 않는다.
  const membersQuery = useHouseholdMembers();
  const memberNames = new Map((membersQuery.data ?? []).map((member) => [member.memberId, member.name]));
  const permission = useMemo(
    () => ({
      role: activeMembership?.role ?? null,
      myMemberId: findMyMemberId(membersQuery.data, user?.id),
    }),
    [activeMembership, membersQuery.data, user?.id],
  );

  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<DevicePlatform>("ios");
  const [formError, setFormError] = useState<string | null>(null);

  // "기기 등록" 주 CTA → 등록 Dialog.
  const [registerOpen, setRegisterOpen] = useState(false);

  /**
   * 수집 설정 마법사. `issued`는 등록/재발급 응답에서 **한 번만** 오는 연결 열쇠라
   * 이 상태 밖에는 저장하지 않는다(뮤테이션 캐시도 닫을 때 reset). 마법사를
   * '설정 계속하기'로 여는 경우에는 null이며, 그때는 재발급만 제안할 수 있다.
   */
  const [wizard, setWizard] = useState<{
    deviceId: string;
    issued: DeviceSecretResponse | null;
    initialStep: 1 | 2;
  } | null>(null);

  // 되돌리기 어려운 행동 확인(다시 발급/연결 해제). 닫히는 동안 문구가 바뀌지 않게 대상은 따로 둔다.
  const [confirm, setConfirm] = useState<
    { type: "rotate" | "revoke"; device: DeviceSummary } | null
  >(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const invalidateDevices = () =>
    queryClient.invalidateQueries({ queryKey: ["devices", householdId] });

  const registerMutation = useMutation({
    mutationFn: (body: DeviceRegisterRequest) =>
      authedFetch((token) => api.devices.register(token, body)),
    onSuccess: (result) => {
      void invalidateDevices();
      setName("");
      setPlatform("ios");
      setFormError(null);
      setRegisterOpen(false);
      // 등록은 시작이지 완료가 아니다 — 바로 설정 마법사로 이어 붙인다.
      setWizard({ deviceId: result.device.id, issued: result, initialStep: 1 });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) =>
      authedFetch((token) => api.devices.rotate(token, id)),
    onSuccess: (result) => {
      void invalidateDevices();
      // 다시 발급하면 자동화에 넣어둔 옛 열쇠가 즉시 죽는다. 새 열쇠를 어디에 넣어야
      // 하는지까지 안내해야 수집이 멈춘 채 방치되지 않는다(앱은 이미 깔려 있으므로 2단계).
      setWizard({ deviceId: result.device.id, issued: result, initialStep: 2 });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      authedFetch((token) => api.devices.revoke(token, id)),
    onSuccess: () => void invalidateDevices(),
  });

  function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!householdId) return;
    if (name.trim() === "") {
      setFormError("기기 이름을 입력해 주세요.");
      return;
    }
    registerMutation.mutate({
      householdId,
      name: name.trim(),
      platform,
    });
  }

  function askConfirm(type: "rotate" | "revoke", device: DeviceSummary) {
    setConfirm({ type, device });
    setConfirmOpen(true);
  }

  function runConfirm() {
    if (!confirm) return;
    if (confirm.type === "rotate") {
      rotateMutation.mutate(confirm.device.id);
    } else {
      revokeMutation.mutate(confirm.device.id);
    }
    setConfirmOpen(false);
  }

  /**
   * 마법사 닫기. 연결 열쇠가 mutation cache
   * (registerMutation.data / rotateMutation.data)에 남지 않도록 reset까지 수행
   * — '지금만 볼 수 있어요' 계약을 메모리 상태에도 동일하게 적용한다.
   */
  function closeWizard() {
    setWizard(null);
    registerMutation.reset();
    rotateMutation.reset();
  }

  const devices = devicesQuery.data ?? [];
  const isEmpty =
    !devicesQuery.isLoading && !devicesQuery.isError && devices.length === 0;
  const actionPending = rotateMutation.isPending || revokeMutation.isPending;

  // 마법사가 보는 기기는 **목록의 최신 행**이다 — 등록 응답 스냅샷을 계속 보면
  // 폴링으로 firstEventAt이 채워져도 화면이 영영 '대기 중'에 머문다.
  const wizardDevice = useMemo(
    () =>
      wizard
        ? (devices.find((d) => d.id === wizard.deviceId) ??
          wizard.issued?.device ??
          null)
        : null,
    [wizard, devices],
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-5 pb-8">
      <PageBackHeader title="문자 연동" />

      {devicesQuery.isLoading ? (
        <ListLoading rows={2} label="기기를 불러오는 중이에요." />
      ) : devicesQuery.isError ? (
        <p className="text-caption text-destructive" role="alert">
          {errorMessage(devicesQuery.error, "기기를 불러오지 못했어요.")}
        </p>
      ) : devices.length === 0 ? (
        <section className="finance-panel px-5">
          <EmptyState
            icon={<Smartphone />}
            title="아직 등록한 기기가 없어요"
            description="휴대폰의 카드 승인·취소 문자를 가계부로 가져와요."
            action={
              <Button
                type="button"
                className="w-full"
                onClick={() => setRegisterOpen(true)}
              >
                <Plus /> 기기 등록
              </Button>
            }
          />
        </section>
      ) : (
        <section
          className="finance-panel min-w-0 px-5 pt-4 pb-1"
          aria-labelledby="devices-heading"
        >
          <h2
            id="devices-heading"
            className="text-caption text-muted-foreground font-semibold"
          >
            등록한 기기
          </h2>
          <ul className="divide-y divide-border/60">
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                owner={memberNames.get(d.memberId) ?? null}
                canManage={canManageDevice(permission, d.memberId)}
                busy={actionPending}
                onRotate={() => askConfirm("rotate", d)}
                onRevoke={() => askConfirm("revoke", d)}
                onContinue={() => {
                  // 지난 재발급 실패 문구를 다른 마법사로 들고 가지 않는다.
                  rotateMutation.reset();
                  setWizard({ deviceId: d.id, issued: null, initialStep: 2 });
                }}
              />
            ))}
          </ul>
        </section>
      )}
      {revokeMutation.isError ? (
        <p className="text-caption text-destructive" role="alert">
          {errorMessage(revokeMutation.error, "연결을 해제하지 못했어요.")}
        </p>
      ) : null}
      {/* 마법사가 열려 있으면 재발급 실패는 마법사 안에서 보인다 — 여기 두면 마법사에 가려진다. */}
      {rotateMutation.isError && !wizard ? (
        <p className="text-caption text-destructive" role="alert">
          {errorMessage(rotateMutation.error, ROTATE_FAILED)}
        </p>
      ) : null}

      {/* 주 CTA — 빈 상태에서는 빈 상태 안의 CTA 하나만 노출 */}
      {!isEmpty ? (
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => setRegisterOpen(true)}
        >
          <Plus /> 기기 등록
        </Button>
      ) : null}

      {/* 등록 Dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>기기 등록</DialogTitle>
            <DialogDescription>
              등록하면 연결 열쇠를 한 번만 보여 드려요.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onRegister} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="device-name">기기 이름</Label>
              <Input
                id="device-name"
                type="text"
                placeholder="예: 엄마 아이폰"
                maxLength={100}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="device-platform">기기 종류</Label>
              <Select
                value={platform}
                onValueChange={(value) => setPlatform(value as DevicePlatform)}
              >
                <SelectTrigger id="device-platform" className="min-h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formError ? (
              <p className="text-caption text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            {registerMutation.isError ? (
              <p className="text-caption text-destructive" role="alert">
                {errorMessage(
                  registerMutation.error,
                  "기기를 등록하지 못했어요.",
                )}
              </p>
            ) : null}
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? "등록 중…" : "등록하기"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full"
                onClick={() => setRegisterOpen(false)}
              >
                다음에 할게요
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 수집 설정 마법사 — 등록/재발급 직후, 그리고 '설정 계속하기'로 진입 */}
      {wizard && wizardDevice ? (
        <CollectSetupWizard
          open
          onOpenChange={(o) => !o && closeWizard()}
          device={wizardDevice}
          issued={wizard.issued}
          initialStep={wizard.initialStep}
          // 재발급 권한이 없으면 아예 넘기지 않는다 — 마법사가 버튼을 감춘다.
          onReissue={
            canManageDevice(permission, wizardDevice.memberId)
              ? () => rotateMutation.mutate(wizard.deviceId)
              : undefined
          }
          reissuePending={rotateMutation.isPending}
          reissueError={
            rotateMutation.isError
              ? errorMessage(rotateMutation.error, ROTATE_FAILED)
              : null
          }
        />
      ) : null}

      {/* 되돌리기 어려운 행동 확인 */}
      <BottomSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          confirm?.type === "rotate"
            ? "연결 열쇠를 다시 발급할까요?"
            : "이 기기 연결을 해제할까요?"
        }
      >
        <p className="text-body text-muted-foreground pb-3">
          {confirm?.type === "rotate"
            ? `'${confirm.device.name}'에 넣어 둔 지금 열쇠는 바로 쓸 수 없게 되니, 새 열쇠를 단축어·MacroDroid에 다시 넣어 주세요.`
            : confirm
              ? `'${confirm.device.name}'에서 오는 카드 문자를 더 이상 받지 않아요.`
              : ""}
        </p>
        <Button
          variant={confirm?.type === "revoke" ? "destructive" : "default"}
          size="lg"
          className="w-full"
          disabled={actionPending}
          onClick={runConfirm}
        >
          {confirm?.type === "revoke" ? "연결 해제" : "다시 발급"}
        </Button>
      </BottomSheet>
    </div>
  );
}

/**
 * 기기 한 줄: 이름 / `소유자 · Android · 마지막 문자 3시간 전` + 문제일 때만 칩(정상은 칩 없음, §8).
 * 권한이 없으면 ⋯ 메뉴 자체를 감춘다 — 눌러도 항상 403인 행동을 비활성으로 남겨 두면
 * "언젠가 되는 것"으로 읽힌다.
 */
function DeviceRow({
  device,
  owner,
  canManage,
  busy,
  onRotate,
  onRevoke,
  onContinue,
}: {
  device: DeviceSummary;
  owner: string | null;
  canManage: boolean;
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => void;
  onContinue: () => void;
}) {
  const setupComplete = isSetupComplete(device);
  const chip = deviceSignalChip(device);
  const meta = [
    owner,
    PLATFORM_LABEL[device.platform],
    `마지막 문자 ${device.lastEventAt ? formatRelativeTime(device.lastEventAt) : "없음"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <ListRow
          className="min-w-0 flex-1"
          icon={device.platform === "other" ? <Bot /> : <Smartphone />}
          title={device.name}
          subtitle={meta}
          valueSub={
            chip ? <StatusChip tone="attention">{chip}</StatusChip> : undefined
          }
        />
        {canManage ? (
          <OverflowMenu
            label={`${device.name} 메뉴`}
            className="shrink-0"
            actions={[
              { label: "연결 열쇠 다시 발급", onSelect: onRotate, disabled: busy },
              { label: "연결 해제", onSelect: onRevoke, destructive: true, disabled: busy },
            ]}
          />
        ) : null}
      </div>
      {/* 첫 문자가 오기 전까지는 등록이 끝난 게 아니다 — 다음 행동을 남겨둔다. */}
      {!setupComplete ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <p className="text-caption text-muted-foreground min-w-0 flex-1 basis-36">
            {device.lastSeenAt
              ? "기기는 연결됐지만 아직 받은 문자가 없어요."
              : "기기 연결을 아직 확인하지 못했어요."}
          </p>
          <Button
            type="button"
            variant="weak"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={onContinue}
          >
            설정 계속하기
          </Button>
        </div>
      ) : null}
    </li>
  );
}
