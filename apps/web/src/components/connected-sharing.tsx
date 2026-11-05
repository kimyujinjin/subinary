"use client";

import { useId, useState } from "react";
import { CONNECTED_ACCOUNT_SHARING_CONSENT_TEXT } from "@family/contracts";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { useConnectedAccounts, useSetConnectedAccountSharing } from "@/lib/connected-accounts-client";

/** 공유 동의 시트. 켤 때만 동의 문구를 보여주고, 끌 때는 확인만 받는다. */
function SharingSheet({ open, onOpenChange, share }: { open: boolean; onOpenChange: (open: boolean) => void; share: boolean }) {
  const mutation = useSetConnectedAccountSharing();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // 닫고 다시 열었을 때 지난 실패 문구가 남지 않게 한다.
        if (!next) mutation.reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{share ? "연결 계좌를 가족과 공유할까요?" : "가족 공유를 끌까요?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {share ? CONNECTED_ACCOUNT_SHARING_CONSENT_TEXT : "가족 화면과 가족 자산 합계에서 내 연결 계좌가 빠져요. 나에게는 계속 보여요."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError ? <InlineNotice tone="error">저장하지 못했어요. 잠시 후 다시 시도해 주세요.</InlineNotice> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
          {/* 저장이 끝나야 닫는다 — AlertDialogAction은 누르는 즉시 닫혀 실패를 보여줄 수 없다. */}
          <Button
            variant={share ? "default" : "destructive"}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(share, { onSuccess: () => onOpenChange(false) })}
          >
            {mutation.isPending ? "저장 중…" : share ? "동의하고 공유하기" : "공유 끄기"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 자산 화면: 내 연결 계좌가 있는데 아직 공유하지 않았을 때만 한 줄로 권한다. */
export function ConnectedSharingPrompt() {
  const connected = useConnectedAccounts();
  const [open, setOpen] = useState(false);
  const hasOwn = connected.data?.holdings.some((holding) => holding.own) ?? false;
  if (!connected.data || connected.data.sharing.shared || !hasOwn) return null;
  return (
    <section className="finance-panel flex items-center justify-between gap-3 px-5 py-4" aria-label="연결 계좌 가족 공유">
      <p className="text-body min-w-0">내 연결 계좌는 아직 나에게만 보여요</p>
      <Button variant="weak" className="shrink-0" onClick={() => setOpen(true)}>
        공유하기
      </Button>
      <SharingSheet open={open} onOpenChange={setOpen} share />
    </section>
  );
}

/**
 * 자동 연결 화면: 공유 켜고 끄기 한 줄(라벨 왼쪽·스위치 오른쪽).
 * 예전에는 부제·'공유 중' 칩·'켜기/끄기' 버튼이 같은 상태를 세 번 말했다(2026-11-05 HIG 검수).
 * 스위치는 저장이 끝나야 바뀐다 — 누르면 확인 시트만 열고, 값은 서버 응답을 따른다.
 */
export function ConnectedSharingRow() {
  const connected = useConnectedAccounts();
  const [open, setOpen] = useState(false);
  const switchId = useId();
  if (!connected.data) return null;
  const shared = connected.data.sharing.shared;
  return (
    <section className="finance-panel flex min-h-16 items-center justify-between gap-3 px-5 py-3" aria-label="연결 계좌 가족 공유">
      <label htmlFor={switchId} className="min-w-0 flex-1">
        <span className="text-body block font-semibold">가족과 공유</span>
        <span className="text-caption text-muted-foreground block">
          {shared ? "가족 화면과 가족 자산 합계에 포함돼요" : "나에게만 보여요"}
        </span>
      </label>
      <Switch id={switchId} checked={shared} onCheckedChange={() => setOpen(true)} />
      <SharingSheet open={open} onOpenChange={setOpen} share={!shared} />
    </section>
  );
}
