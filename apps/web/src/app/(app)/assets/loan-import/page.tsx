"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 옛 대출 가져오기 주소 — 저장된 옛 링크만 받아 신한은행 연결 화면으로 넘긴다. 앱 안의 링크는 여기를 거치지 않는다
 * (자산 화면의 가져온 대출 줄은 `asset-rows.ts`의 기록 화면으로 바로 간다).
 * 넘기는 사이에 스켈레톤을 그리면 연결 화면이 뜨기 전에 한 번 깜빡여서, 화면에는 아무것도 그리지 않는다(2026-11-06 결정 ①).
 */
export default function LoanImportPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/more/connections?provider=shinhan_bank"); }, [router]);
  return <p role="status" className="sr-only">신한은행 연결 관리로 이동하고 있어요</p>;
}
