"use client";

import { useState } from "react";
import { CONNECTED_ACCOUNT_SHARING_CONSENT_TEXT } from "@family/contracts";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
import { StatusChip } from "@/components/widgets/status-chip";
import { useConnectedAccounts, useSetConnectedAccountSharing } from "@/lib/connected-accounts-client";

/** 공유 동의 시트. 켤 때만 동의 문구를 보여주고, 끌 때는 확인만 받는다. */
function SharingSheet({ open, onOpenChange, share }: { open: boolean; onOpenChange: (open: boolean) => void; share: boolean }) {
  const mutation = useSetConnectedAccountSharing();
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={share ? "연결 계좌를 가족과 공유할까요?" : "가족 공유를 끌까요?"}>
      <p className="text-body text-muted-foreground pb-3">
        {share ? CONNECTED_ACCOUNT_SHARING_CONSENT_TEXT : "가족 화면과 가족 자산 합계에서 내 연결 계좌가 빠져요. 나에게는 계속 보여요."}
      </p>
      {mutation.isError ? <p role="alert" className="text-caption text-destructive pb-2">저장하지 못했어요. 잠시 후 다시 시도해 주세요.</p> : null}
      <Button
        size="lg"
        className="w-full"
        variant={share ? "default" : "destructive"}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(share, { onSuccess: () => onOpenChange(false) })}
      >
        {mutation.isPending ? "저장 중…" : share ? "동의하고 공유" : "공유 끄기"}
      </Button>
    </BottomSheet>
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
      <Button variant="weak" size="sm" onClick={() => setOpen(true)}>
        공유하기
      </Button>
      <SharingSheet open={open} onOpenChange={setOpen} share />
    </section>
  );
}

/** 자동 연결 화면: 공유 상태와 켜기·끄기. */
export function ConnectedSharingRow() {
  const connected = useConnectedAccounts();
  const [open, setOpen] = useState(false);
  if (!connected.data) return null;
  const shared = connected.data.sharing.shared;
  return (
    <section className="finance-panel flex min-h-16 items-center justify-between gap-3 px-5 py-3" aria-label="연결 계좌 가족 공유">
      <span className="min-w-0">
        <span className="text-body block font-semibold">가족과 공유</span>
        <span className="text-caption text-muted-foreground block">
          {shared ? "가족 화면과 가족 자산 합계에 포함돼요" : "나에게만 보여요"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {shared ? <StatusChip tone="ok">공유 중</StatusChip> : null}
        <Button variant={shared ? "ghost" : "weak"} size="sm" onClick={() => setOpen(true)}>
          {shared ? "끄기" : "켜기"}
        </Button>
      </span>
      <SharingSheet open={open} onOpenChange={setOpen} share={!shared} />
    </section>
  );
}
