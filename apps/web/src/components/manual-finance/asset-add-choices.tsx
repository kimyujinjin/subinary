"use client";

import { Link2, PenLine } from "lucide-react";

import { CONNECTABLE_PROVIDER_LABEL } from "@/components/finance-connections/providers";
import { BottomSheet, SheetOption } from "@/components/widgets/bottom-sheet";

/** 추가 경로만 고른다. 금융 연결이나 기록 저장은 각 기존 화면에서 진행한다. */
export function AssetAddSheet({
  open,
  onOpenChange,
  onManual,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onManual: () => void;
}) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="자산 추가">
      <SheetOption
        icon={<Link2 />}
        title="은행·증권 연결"
        description={CONNECTABLE_PROVIDER_LABEL}
        href="/more/connections"
      />
      <SheetOption
        icon={<PenLine />}
        title="직접 입력"
        description="통장·적금·주식·대출 금액"
        onSelect={() => {
          onOpenChange(false);
          onManual();
        }}
      />
    </BottomSheet>
  );
}
