"use client";

import { ChevronRight, Link2, PenLine, X } from "lucide-react";
import Link from "next/link";

import { CONNECTABLE_PROVIDER_LABEL } from "@/components/finance-connections/providers";

/** 추가 경로만 선택하며 금융 연결이나 기록 저장은 각 기존 화면에서 진행한다. */
export function AssetAddChoices({
  onManual,
  onClose,
}: {
  onManual: () => void;
  onClose: () => void;
}) {
  const rowClass =
    "hover:bg-muted/60 focus-visible:outline-ring flex min-h-16 w-full items-center gap-3 rounded-lg px-2 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <section
      id="asset-add-choices"
      aria-label="자산 추가 방법"
      className="min-w-0 border-y py-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 pl-2">
        <h2 className="text-sm font-semibold">어떤 방법으로 추가할까요?</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="추가 방법 닫기"
          className="text-muted-foreground hover:bg-muted focus-visible:outline-ring flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="divide-y">
        <button
          type="button"
          autoFocus
          onClick={onManual}
          className={rowClass}
          aria-label="직접 입력"
        >
          <PenLine
            className="text-primary size-5 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">직접 입력</span>
            <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
              통장·적금·주식·대출 금액 기록
            </span>
          </span>
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </button>
        <Link
          href="/more/connections"
          className={rowClass}
          aria-label="은행·증권 자동 연결"
        >
          <Link2 className="text-primary size-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              은행·증권 자동 연결
            </span>
            <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
              {CONNECTABLE_PROVIDER_LABEL}
            </span>
          </span>
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </Link>
      </div>
    </section>
  );
}
