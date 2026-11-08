"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleDollarSign, GitBranch, Plus, Wallet } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHousehold } from "@/lib/household-context";

type FlowRow = { id: string; name: string; amount: number };
type FlowMember = FlowRow & { toShared: number; toSavings: number; extraTransfers: Record<string, number> };
type ExtraFlowAccount = { id: string; name: string; kind: "shared" | "savings"; buckets: FlowBucket[] };
type BucketId = string;
type FlowBucket = { id: BucketId; name: string; sharedTransfer: number; rows: FlowRow[] };
type MoneyFlowDraft = { members: FlowMember[]; directSavingsAccount: string; sharedAccount: string; destinations: Array<"shared" | "savings">; additionalAccounts: ExtraFlowAccount[]; buckets: FlowBucket[] };
type EditTarget =
  | { type: "member"; id: string }
  | { type: "member-transfer"; id: string; destination: "shared" | "savings" }
  | { type: "extra-transfer"; id: string; accountId: string }
  | { type: "extra-account"; id: string }
  | { type: "direct-savings" }
  | { type: "shared" }
  | { type: "bucket"; bucketId: BucketId; accountId?: string }
  | { type: "bucket-transfer"; bucketId: BucketId; accountId?: string }
  | { type: "row"; bucketId: BucketId; id: string; accountId?: string }
  | { type: "new-member" }
  | { type: "new-account" }
  | { type: "new-row"; bucketId: BucketId; accountId?: string };

const WON = new Intl.NumberFormat("ko-KR");
const STORAGE_PREFIX = "moa-money-flow-draft-v5";
const LEGACY_STORAGE_PREFIX = "moa-money-flow-draft-v4";
const SAMPLE_FLOW: MoneyFlowDraft = {
  members: [
    { id: "yujin", name: "유진 급여", amount: 2_400_000, toShared: 1_800_000, toSavings: 600_000, extraTransfers: {} },
    { id: "sujin", name: "수빈 급여", amount: 1_800_000, toShared: 1_800_000, toSavings: 0, extraTransfers: {} },
  ],
  directSavingsAccount: "청년도약",
  sharedAccount: "공용통장",
  destinations: ["shared", "savings"],
  additionalAccounts: [],
  buckets: [
    { id: "living", name: "생활비 통장", sharedTransfer: 2_486_300, rows: [
      { id: "fixed", name: "고정비·그 외", amount: 1_191_600 },
      { id: "food", name: "식비", amount: 684_200 },
      { id: "life-transport", name: "생활·교통", amount: 610_500 },
    ] },
    { id: "savings", name: "저축 통장", sharedTransfer: 1_113_700, rows: [
      { id: "home", name: "가족 적금", amount: 600_000 },
      { id: "emergency", name: "주택청약", amount: 300_000 },
      { id: "saving", name: "비상금", amount: 213_700 },
    ] },
  ],
};
const EMPTY_FLOW: MoneyFlowDraft = {
  members: [],
  directSavingsAccount: "청년도약",
  sharedAccount: "공용통장",
  destinations: [],
  additionalAccounts: [],
  buckets: [
    { id: "living", name: "생활비 통장", sharedTransfer: 0, rows: [] },
    { id: "savings", name: "저축 통장", sharedTransfer: 0, rows: [] },
  ],
};

function Amount({ value }: { value: number }) {
  return <>{WON.format(value)}원</>;
}

function sumRows(rows: Array<{ amount: number }>) {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function makeId() {
  return `flow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeDefaultBuckets(uniqueIds = false): FlowBucket[] {
  return [
    { id: uniqueIds ? makeId() : "living", name: "생활비 통장", sharedTransfer: 0, rows: [] },
    { id: uniqueIds ? makeId() : "savings", name: "저축 통장", sharedTransfer: 0, rows: [] },
  ];
}

function MoneyFlowPageContent() {
  const searchParams = useSearchParams();
  const { householdId } = useHousehold();
  const sample = searchParams.get("sample") === "1";
  const preview = searchParams.get("preview") === "1" || sample;
  const storageSuffix = sample ? "sample" : preview ? "empty-preview" : householdId ?? "no-household";
  const storageKey = `${STORAGE_PREFIX}:${storageSuffix}`;
  const legacyStorageKey = `${LEGACY_STORAGE_PREFIX}:${storageSuffix}`;
  const [flow, setFlow] = useState<MoneyFlowDraft>(EMPTY_FLOW);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editor, setEditor] = useState<EditTarget | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ target: EditTarget; message: string } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState(0);
  const [sharedTransferDraft, setSharedTransferDraft] = useState(0);
  const [savingsTransferDraft, setSavingsTransferDraft] = useState(0);
  const [includeShared, setIncludeShared] = useState(false);
  const [includeSavings, setIncludeSavings] = useState(false);
  const [extraTransferDraft, setExtraTransferDraft] = useState<Record<string, number>>({});
  const [includeExtraTransfers, setIncludeExtraTransfers] = useState<Record<string, boolean>>({});
  const [accountDestination, setAccountDestination] = useState<"shared" | "savings">("shared");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const stored = window.sessionStorage.getItem(storageKey) ?? window.sessionStorage.getItem(legacyStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as MoneyFlowDraft;
        const next = {
          ...parsed,
          destinations: parsed.destinations ?? (parsed.members.length ? ["shared", "savings"] : []),
          additionalAccounts: (parsed.additionalAccounts ?? []).map((account) => ({ ...account, buckets: account.buckets ?? (account.kind === "shared" ? makeDefaultBuckets(true) : []) })),
          members: parsed.members.map((member) => ({ ...member, extraTransfers: member.extraTransfers ?? {}, ...(sample && member.id === "sujin" && member.name === "수진 급여" ? { name: "수빈 급여" } : {}) })),
        };
        setFlow(next);
        if (next !== parsed) window.sessionStorage.setItem(storageKey, JSON.stringify(next));
        setSaved(true);
      } catch {
        window.sessionStorage.removeItem(storageKey);
        setFlow(sample ? SAMPLE_FLOW : EMPTY_FLOW);
        setSaved(false);
      }
    } else {
      setFlow(sample ? SAMPLE_FLOW : EMPTY_FLOW);
      setSaved(false);
    }
    setReady(true);
  }, [preview, sample, storageKey, legacyStorageKey]);

  const sharedIncoming = useMemo(() => flow.members.reduce((sum, member) => sum + member.toShared, 0), [flow.members]);
  const directSavings = useMemo(() => flow.members.reduce((sum, member) => sum + member.toSavings, 0), [flow.members]);
  const sharedOutgoing = useMemo(() => flow.buckets.reduce((sum, bucket) => sum + bucket.sharedTransfer, 0), [flow.buckets]);
  const hasFlow = flow.members.length > 0;
  const hasSharedAccount = flow.destinations.includes("shared");
  const hasSavingsAccount = flow.destinations.includes("savings");
  const hasBothDestinations = hasSharedAccount && hasSavingsAccount;
  const sharedDifference = sharedIncoming - sharedOutgoing;

  function bucketsFor(accountId?: string) {
    return accountId ? flow.additionalAccounts.find((account) => account.id === accountId)?.buckets ?? [] : flow.buckets;
  }

  function updateBuckets(accountId: string | undefined, update: (buckets: FlowBucket[]) => FlowBucket[]) {
    if (!accountId) return { ...flow, buckets: update(flow.buckets) };
    return { ...flow, additionalAccounts: flow.additionalAccounts.map((account) => account.id === accountId ? { ...account, buckets: update(account.buckets) } : account) };
  }

  function bucketTotal(bucket: FlowBucket) {
    return bucket.sharedTransfer;
  }

  function openEditor(target: EditTarget) {
    setNotice("");
    setEditor(target);
    if (target.type === "member") {
      const row = flow.members.find((item) => item.id === target.id);
      setNameDraft(row?.name ?? "");
      setAmountDraft(row?.amount ?? 0);
      setSharedTransferDraft(row?.toShared ?? 0);
      setSavingsTransferDraft(row?.toSavings ?? 0);
      setIncludeShared((row?.toShared ?? 0) > 0);
      setIncludeSavings((row?.toSavings ?? 0) > 0);
      setExtraTransferDraft(Object.fromEntries(flow.additionalAccounts.map((account) => [account.id, row?.extraTransfers?.[account.id] ?? 0])));
      setIncludeExtraTransfers(Object.fromEntries(flow.additionalAccounts.map((account) => [account.id, (row?.extraTransfers?.[account.id] ?? 0) > 0])));
    } else if (target.type === "member-transfer") {
      const member = flow.members.find((item) => item.id === target.id);
      setNameDraft(member?.name ?? "");
      setAmountDraft(target.destination === "shared" ? member?.toShared ?? 0 : member?.toSavings ?? 0);
    } else if (target.type === "extra-transfer") {
      const member = flow.members.find((item) => item.id === target.id);
      setNameDraft(member?.name ?? "");
      setAmountDraft(member?.extraTransfers?.[target.accountId] ?? 0);
    } else if (target.type === "extra-account") {
      const account = flow.additionalAccounts.find((item) => item.id === target.id);
      setNameDraft(account?.name ?? "");
      setAmountDraft(flow.members.reduce((total, member) => total + (member.extraTransfers?.[target.id] ?? 0), 0));
    } else if (target.type === "direct-savings") {
      setNameDraft(flow.directSavingsAccount);
      setAmountDraft(directSavings);
    } else if (target.type === "shared") {
      setNameDraft(flow.sharedAccount);
      setAmountDraft(sharedIncoming);
    } else if (target.type === "bucket-transfer") {
      const bucket = bucketsFor(target.accountId).find((item) => item.id === target.bucketId);
      setNameDraft(bucket?.name ?? "");
      setAmountDraft(bucket?.sharedTransfer ?? 0);
    } else if (target.type === "bucket") {
      const bucket = bucketsFor(target.accountId).find((item) => item.id === target.bucketId);
      setNameDraft(bucket?.name ?? "");
      setAmountDraft(bucket ? bucketTotal(bucket) : 0);
    } else if (target.type === "row") {
      const row = bucketsFor(target.accountId).find((item) => item.id === target.bucketId)?.rows.find((item) => item.id === target.id);
      setNameDraft(row?.name ?? "");
      setAmountDraft(row?.amount ?? 0);
    } else if (target.type === "new-account") {
      const destination: "shared" | "savings" = flow.destinations.includes("shared") && !flow.destinations.includes("savings") ? "savings" : "shared";
      setAccountDestination(destination);
      const sameKindCount = flow.additionalAccounts.filter((account) => account.kind === destination).length + (flow.destinations.includes(destination) ? 1 : 0);
      const baseName = destination === "shared" ? flow.sharedAccount : flow.directSavingsAccount;
      setNameDraft(sameKindCount === 0 ? baseName : `${baseName} ${sameKindCount + 1}`);
      setAmountDraft(0);
    } else {
      setNameDraft("");
      setAmountDraft(0);
      setSharedTransferDraft(0);
      setSavingsTransferDraft(0);
      setIncludeShared(true);
      setIncludeSavings(false);
      setExtraTransferDraft(Object.fromEntries(flow.additionalAccounts.map((account) => [account.id, 0])));
      setIncludeExtraTransfers(Object.fromEntries(flow.additionalAccounts.map((account) => [account.id, false])));
    }
  }

  function commitFlow(next: MoneyFlowDraft) {
    setFlow(next);
    window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    setSaved(true);
    setNotice("이 브라우저 세션에 임시 저장했어요.");
    setPendingRemoval(null);
    setEditor(null);
  }

  function saveEditor() {
    if (!editor || !nameDraft.trim()) return;
    let next = flow;
    if (editor.type === "member") {
      const extraTransfers = Object.fromEntries(flow.additionalAccounts.filter((account) => includeExtraTransfers[account.id] && (extraTransferDraft[account.id] ?? 0) > 0).map((account) => [account.id, extraTransferDraft[account.id]]));
      next = { ...flow, members: flow.members.map((row) => row.id === editor.id ? { ...row, name: nameDraft.trim(), amount: amountDraft, toShared: includeShared ? sharedTransferDraft : 0, toSavings: includeSavings ? savingsTransferDraft : 0, extraTransfers } : row) };
    } else if (editor.type === "member-transfer") {
      next = { ...flow, members: flow.members.map((row) => row.id === editor.id ? { ...row, [editor.destination === "shared" ? "toShared" : "toSavings"]: amountDraft } : row) };
    } else if (editor.type === "extra-transfer") {
      next = { ...flow, members: flow.members.map((row) => row.id === editor.id ? { ...row, extraTransfers: { ...row.extraTransfers, [editor.accountId]: amountDraft } } : row) };
    } else if (editor.type === "extra-account") {
      next = { ...flow, additionalAccounts: flow.additionalAccounts.map((account) => account.id === editor.id ? { ...account, name: nameDraft.trim() } : account) };
    } else if (editor.type === "direct-savings") {
      next = { ...flow, directSavingsAccount: nameDraft.trim() };
    } else if (editor.type === "shared") {
      next = { ...flow, sharedAccount: nameDraft.trim() };
    } else if (editor.type === "new-account") {
      if (flow.destinations.includes(accountDestination)) {
        next = { ...flow, additionalAccounts: [...flow.additionalAccounts, { id: makeId(), name: nameDraft.trim(), kind: accountDestination, buckets: accountDestination === "shared" ? makeDefaultBuckets(true) : [] }] };
      } else {
        next = { ...flow, destinations: [...flow.destinations, accountDestination], ...(accountDestination === "shared" ? { sharedAccount: nameDraft.trim(), ...(flow.buckets.length === 0 ? { buckets: makeDefaultBuckets() } : {}) } : { directSavingsAccount: nameDraft.trim() }) };
      }
    } else if (editor.type === "bucket-transfer") {
      next = updateBuckets(editor.accountId, (buckets) => buckets.map((bucket) => bucket.id === editor.bucketId ? { ...bucket, sharedTransfer: amountDraft } : bucket));
    } else if (editor.type === "bucket") {
      next = updateBuckets(editor.accountId, (buckets) => buckets.map((bucket) => bucket.id === editor.bucketId ? { ...bucket, name: nameDraft.trim() } : bucket));
    } else if (editor.type === "row") {
      next = updateBuckets(editor.accountId, (buckets) => buckets.map((bucket) => bucket.id === editor.bucketId ? { ...bucket, rows: bucket.rows.map((row) => row.id === editor.id ? { ...row, name: nameDraft.trim(), amount: amountDraft } : row) } : bucket));
    } else if (editor.type === "new-member") {
      const extraTransfers = Object.fromEntries(flow.additionalAccounts.filter((account) => includeExtraTransfers[account.id] && (extraTransferDraft[account.id] ?? 0) > 0).map((account) => [account.id, extraTransferDraft[account.id]]));
      next = { ...flow, members: [...flow.members, { id: makeId(), name: nameDraft.trim(), amount: amountDraft, toShared: includeShared ? sharedTransferDraft : 0, toSavings: includeSavings ? savingsTransferDraft : 0, extraTransfers }] };
    } else {
      next = updateBuckets(editor.accountId, (buckets) => buckets.map((bucket) => bucket.id === editor.bucketId ? { ...bucket, rows: [...bucket.rows, { id: makeId(), name: nameDraft.trim(), amount: amountDraft }] } : bucket));
    }
    commitFlow(next);
  }

  function removalMessage(target: EditTarget) {
    if (target.type === "member") {
      const member = flow.members.find((item) => item.id === target.id);
      if (!member) return "이 항목을 삭제할까요?";
      const remaining = flow.members.filter((item) => item.id !== target.id);
      const willRemoveShared = member.toShared > 0 && !remaining.some((item) => item.toShared > 0);
      const willRemoveSavings = member.toSavings > 0 && !remaining.some((item) => item.toSavings > 0);
      const willRemoveExtras = flow.additionalAccounts.filter((account) => (member.extraTransfers[account.id] ?? 0) > 0 && !remaining.some((item) => (item.extraTransfers[account.id] ?? 0) > 0));
      const descendants: string[] = [];
      if (willRemoveShared) {
        descendants.push(`${flow.sharedAccount}과 하위 통장 ${flow.buckets.length}개`);
        const rowCount = flow.buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0);
        if (rowCount > 0) descendants.push(`사용처 ${rowCount}개`);
      }
      if (willRemoveSavings) descendants.push(flow.directSavingsAccount);
      descendants.push(...willRemoveExtras.map((account) => `${account.name}${account.buckets.length ? `과 하위 통장 ${account.buckets.length}개` : ""}`));
      const extraUsageCount = willRemoveExtras.reduce((sum, account) => sum + account.buckets.reduce((childSum, bucket) => childSum + bucket.rows.length, 0), 0);
      if (extraUsageCount) descendants.push(`사용처 ${extraUsageCount}개`);
      return descendants.length > 0
        ? `${member.name}을 삭제하면 연결된 ${descendants.join(", ")}도 함께 삭제돼요. 계속할까요?`
        : `${member.name}과 이 수입에 연결된 금액을 삭제할까요?`;
    }
    if (target.type === "shared") {
      const rowCount = flow.buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0);
      return `${flow.sharedAccount}에 연결된 생활비·저축 통장 ${flow.buckets.length}개${rowCount ? `와 사용처 ${rowCount}개` : ""}, 그리고 급여에서 들어오는 연결 금액이 함께 삭제돼요. 계속할까요?`;
    }
    if (target.type === "direct-savings") {
      const count = flow.members.filter((member) => member.toSavings > 0).length;
      return `${flow.directSavingsAccount}과 여기에 연결된 급여 이체 ${count}건이 삭제돼요. 계속할까요?`;
    }
    if (target.type === "extra-account") {
      const account = flow.additionalAccounts.find((item) => item.id === target.id);
      const count = flow.members.filter((member) => (member.extraTransfers[ target.id ] ?? 0) > 0).length;
      const childCount = account?.buckets.length ?? 0;
      const rowCount = account?.buckets.reduce((sum, bucket) => sum + bucket.rows.length, 0) ?? 0;
      return `${account?.name ?? "추가 통장"}${childCount ? `과 하위 통장 ${childCount}개` : ""}${rowCount ? `, 사용처 ${rowCount}개` : ""}, 연결된 급여 이체 ${count}건이 함께 삭제돼요. 계속할까요?`;
    }
    if (target.type === "bucket") {
      const bucket = bucketsFor(target.accountId).find((item) => item.id === target.bucketId);
      const count = bucket?.rows.length ?? 0;
      return `${bucket?.name ?? "이 통장"}${count ? `과 연결된 사용처 ${count}개` : ""}가 함께 삭제돼요. 계속할까요?`;
    }
    return "이 항목을 삭제할까요?";
  }

  function requestRemoveEditorItem() {
    if (!editor) return;
    if (editor.type === "row") {
      applyRemoval(editor);
      return;
    }
    setPendingRemoval({ target: editor, message: removalMessage(editor) });
  }

  function applyRemoval(target: EditTarget) {
    let next = flow;
    if (target.type === "member") {
      const removed = flow.members.find((row) => row.id === target.id);
      const members = flow.members.filter((row) => row.id !== target.id);
      const removeShared = Boolean(removed?.toShared) && !members.some((row) => row.toShared > 0);
      const removeSavings = Boolean(removed?.toSavings) && !members.some((row) => row.toSavings > 0);
      const orphanedExtras = flow.additionalAccounts.filter((account) => (removed?.extraTransfers[account.id] ?? 0) > 0 && !members.some((row) => (row.extraTransfers[account.id] ?? 0) > 0)).map((account) => account.id);
      next = {
        ...flow,
        destinations: flow.destinations.filter((destination) => !(destination === "shared" && removeShared) && !(destination === "savings" && removeSavings)),
        additionalAccounts: flow.additionalAccounts.filter((account) => !orphanedExtras.includes(account.id)),
        members: members.map((member) => ({ ...member, extraTransfers: Object.fromEntries(Object.entries(member.extraTransfers).filter(([id]) => !orphanedExtras.includes(id))) })),
        ...(removeShared ? { buckets: [] } : {}),
      };
      if (removeShared) next = { ...next, members: next.members.map((row) => ({ ...row, toShared: 0 })) };
      if (removeSavings) next = { ...next, members: next.members.map((row) => ({ ...row, toSavings: 0 })) };
    } else if (target.type === "shared") {
      next = { ...flow, destinations: flow.destinations.filter((destination) => destination !== "shared"), members: flow.members.map((row) => ({ ...row, toShared: 0 })), buckets: [] };
    } else if (target.type === "direct-savings") {
      next = { ...flow, destinations: flow.destinations.filter((destination) => destination !== "savings"), members: flow.members.map((row) => ({ ...row, toSavings: 0 })) };
    } else if (target.type === "extra-account") {
      next = { ...flow, additionalAccounts: flow.additionalAccounts.filter((account) => account.id !== target.id), members: flow.members.map((member) => { const extraTransfers = { ...member.extraTransfers }; delete extraTransfers[target.id]; return { ...member, extraTransfers }; }) };
    } else if (target.type === "bucket") {
      next = updateBuckets(target.accountId, (buckets) => buckets.filter((bucket) => bucket.id !== target.bucketId));
    } else if (target.type === "row") {
      next = updateBuckets(target.accountId, (buckets) => buckets.map((bucket) => bucket.id === target.bucketId ? { ...bucket, rows: bucket.rows.filter((row) => row.id !== target.id) } : bucket));
    }
    commitFlow(next);
  }

  const editorTitle = editor?.type === "member" ? "가족 수입 수정"
    : editor?.type === "member-transfer" ? `${editor.destination === "shared" ? flow.sharedAccount : flow.directSavingsAccount}으로 보내는 금액`
    : editor?.type === "extra-transfer" ? `${flow.additionalAccounts.find((account) => account.id === editor.accountId)?.name ?? "통장"}으로 보내는 금액`
    : editor?.type === "extra-account" ? "추가 통장 수정"
    : editor?.type === "direct-savings" ? "직접 저축 계좌 수정"
    : editor?.type === "shared" ? "공용통장 수정"
      : editor?.type === "bucket" ? "통장 이름 수정"
        : editor?.type === "bucket-transfer" ? "통장 배분 금액"
        : editor?.type === "row" ? "사용처 수정"
    : editor?.type === "new-member" ? "가족 수입 추가"
      : editor?.type === "new-account" ? "통장 추가" : "사용처 추가";
  const amountReadOnly = editor?.type === "shared" || editor?.type === "bucket" || editor?.type === "direct-savings" || editor?.type === "extra-account";
  const canRemove = editor?.type === "member" || editor?.type === "row" || editor?.type === "shared" || editor?.type === "direct-savings" || editor?.type === "bucket" || editor?.type === "extra-account";
  const incomeEditor = editor?.type === "member" || editor?.type === "new-member";
  const transferEditor = editor?.type === "member-transfer" || editor?.type === "extra-transfer" || editor?.type === "bucket-transfer";
  const showNameEditor = Boolean(editor && !transferEditor);
  const showAmountEditor = Boolean(editor && editor.type !== "shared" && editor.type !== "bucket" && editor.type !== "direct-savings" && editor.type !== "extra-account" && editor.type !== "new-account");
  const routingEnabled = flow.destinations.length > 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header className="flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-title font-bold">머니플로우</h1>
          <p className="text-caption mt-1 text-muted-foreground">박스를 눌러 우리 가족의 돈 흐름을 바로 수정해요.</p>
        </div>
        {ready ? <div className="flex shrink-0 flex-col items-end">
          <button type="button" onClick={() => openEditor({ type: "new-member" })} className="text-caption flex min-h-11 items-center gap-1 rounded-control px-2 font-medium text-primary active:bg-muted"><Plus className="size-4" aria-hidden="true" />수입 추가</button>
        {flow.members.length > 0 && routingEnabled ? <button type="button" onClick={() => openEditor({ type: "new-account" })} className="text-micro flex min-h-9 items-center gap-1 rounded-control px-2 font-medium text-muted-foreground active:bg-muted"><Plus className="size-3.5" aria-hidden="true" />통장 추가</button> : null}
        </div> : null}
      </header>

      {hasFlow ? (
        <section className="finance-panel px-5" aria-labelledby="money-flow-title">
          <div className="flex items-center justify-between gap-3">
            <div><h2 id="money-flow-title" className="text-heading font-semibold">가족 돈 흐름</h2><p className="text-micro mt-1 text-muted-foreground">급여에서 각 통장으로 보내는 금액을 선에서 수정해요</p></div>
            {preview && !saved ? <span className="text-micro rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground">예시</span> : null}
          </div>

          <div className="mt-5 rounded-card bg-muted p-4">
            <div className={`grid grid-cols-2 gap-2 ${flow.members.length === 1 ? "[&>button]:col-span-2" : ""}`}>
              {flow.members.map((member) => (
                <button key={member.id} type="button" onClick={() => openEditor({ type: "member", id: member.id })} className="min-w-0 rounded-control bg-background p-3 text-left transition-colors hover:ring-1 hover:ring-primary/30 focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="text-caption block truncate text-muted-foreground">{member.name}</span>
                  <span className="text-body mt-1 block font-semibold tabular-nums"><Amount value={member.amount} /></span>
                  {routingEnabled && member.amount !== member.toShared + member.toSavings + sumRows(Object.values(member.extraTransfers).map((amount) => ({ amount }))) ? <span className={`text-micro mt-1 block ${member.amount > member.toShared + member.toSavings + sumRows(Object.values(member.extraTransfers).map((amount) => ({ amount }))) ? "text-muted-foreground" : "text-destructive"}`}>{member.amount > member.toShared + member.toSavings + sumRows(Object.values(member.extraTransfers).map((amount) => ({ amount }))) ? "미배분" : "배분 초과"} <Amount value={Math.abs(member.amount - member.toShared - member.toSavings - sumRows(Object.values(member.extraTransfers).map((amount) => ({ amount }))))} /></span> : null}
                </button>
              ))}
            </div>
            {!routingEnabled ? (
              <div className="mt-4 rounded-control border border-dashed border-border bg-background p-4 text-center">
                <p className="text-caption font-semibold">다음 단계: 첫 통장 등록</p>
                <p className="text-micro mt-1 text-muted-foreground">통장을 등록하면 이 수입을 어디로 보낼지 연결할 수 있어요.</p>
                <button type="button" onClick={() => openEditor({ type: "new-account" })} className="text-body mt-3 inline-flex min-h-11 items-center gap-1 rounded-control bg-primary px-4 font-medium text-primary-foreground"><Plus className="size-4" aria-hidden="true" />첫 통장 등록</button>
              </div>
            ) : <>
            <div className="relative h-[6.25rem]">
              <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full text-[#83a991]">
                {hasBothDestinations
                  ? flow.members.length === 1
                    ? <path d="M150 0v14M60 14h150M60 14v82M210 14v82" fill="none" stroke="currentColor" strokeWidth="2" />
                    : <path d="M75 0v14M60 14h150M60 14v82M225 0v14h-15v82" fill="none" stroke="currentColor" strokeWidth="2" />
                  : flow.members.length === 1
                    ? <path d="M150 0v96" fill="none" stroke="currentColor" strokeWidth="2" />
                    : <path d="M75 0v14M225 0v14M75 14h150M150 14v82" fill="none" stroke="currentColor" strokeWidth="2" />}
                {hasBothDestinations ? <path d="m56 92 4 6 4-6M206 92l4 6 4-6" fill="none" stroke="currentColor" strokeWidth="2" /> : <path d="m146 92 4 6 4-6" fill="none" stroke="currentColor" strokeWidth="2" />}
              </svg>
              {hasBothDestinations ? <><div className="absolute left-[2%] top-5 flex w-[42%] flex-col items-center gap-1">
                {flow.members.filter((member) => member.toSavings > 0).map((member) => <button type="button" key={member.id} onClick={() => openEditor({ type: "member-transfer", id: member.id, destination: "savings" })} className="text-micro max-w-full truncate rounded-full border border-[#f0dfa8] bg-[#fff8e5] px-2 py-0.5 font-medium text-[#795b10] shadow-sm hover:ring-1 hover:ring-[#9c7515]/40">{member.name.replace(/\s*급여$/, "")} · <Amount value={member.toSavings} /></button>)}
              </div>
              <div className="absolute right-[2%] top-5 flex w-[52%] flex-col items-center gap-1">
                {flow.members.filter((member) => member.toShared > 0).map((member) => <button type="button" key={member.id} onClick={() => openEditor({ type: "member-transfer", id: member.id, destination: "shared" })} className="text-micro max-w-full truncate rounded-full border border-[#c5dbc9] bg-[#eff7f0] px-2 py-0.5 font-medium text-[#356a44] shadow-sm hover:ring-1 hover:ring-[#438456]/40">{member.name.replace(/\s*급여$/, "")} · <Amount value={member.toShared} /></button>)}
              </div></> : <div className="absolute inset-x-[22%] top-5 flex w-[56%] flex-col items-center gap-1">{flow.members.filter((member) => (hasSharedAccount ? member.toShared : member.toSavings) > 0).map((member) => <button type="button" key={member.id} onClick={() => openEditor({ type: "member-transfer", id: member.id, destination: hasSharedAccount ? "shared" : "savings" })} className="text-micro max-w-full truncate rounded-full border border-border bg-background px-2 py-0.5 font-medium shadow-sm">{member.name.replace(/\s*급여$/, "")} · <Amount value={hasSharedAccount ? member.toShared : member.toSavings} /></button>)}</div>}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {hasSavingsAccount ? <div className={`${hasBothDestinations ? "col-span-2" : "col-span-5"} min-w-0 rounded-control border border-[#f0dfa8] bg-[#fff8e5] p-3`}>
                <button type="button" onClick={() => openEditor({ type: "direct-savings" })} className="w-full text-left focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="flex size-8 items-center justify-center rounded-full bg-white text-[#9c7515]"><Wallet className="size-4" aria-hidden="true" /></span>
                  <span className="text-caption mt-2 block truncate text-muted-foreground">{flow.directSavingsAccount}</span>
                  <span className="text-body mt-0.5 block font-semibold tabular-nums"><Amount value={directSavings} /></span>
                </button>
                <div className="mt-2 space-y-1 border-t border-[#9c7515]/20 pt-2">
                  {flow.members.filter((member) => member.toSavings > 0).map((member) => <button key={member.id} type="button" onClick={() => openEditor({ type: "member-transfer", id: member.id, destination: "savings" })} className="text-micro flex min-h-8 w-full justify-between gap-1 rounded px-1 text-left hover:bg-white/70"><span className="truncate">{member.name.replace(/\s*급여$/, "")}</span><span className="shrink-0 tabular-nums"><Amount value={member.toSavings} /></span></button>)}
                  {directSavings === 0 ? <p className="text-micro text-muted-foreground">연결된 급여가 없어요</p> : null}
                </div>
              </div> : null}
              {hasSharedAccount ? <div className={`${hasBothDestinations ? "col-span-3" : "col-span-5"} flex min-w-0 items-start gap-3 rounded-control border border-[#c5dbc9] bg-[#eff7f0] p-3`}>
                <button type="button" onClick={() => openEditor({ type: "shared" })} className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="text-caption block truncate text-muted-foreground">{flow.sharedAccount}</span>
                  <span className="text-body mt-0.5 block font-semibold tabular-nums"><Amount value={sharedIncoming} /></span>
                  <span className="text-micro mt-1 block text-muted-foreground">입금 합계</span>
                </button>
                <div className="min-w-[5.5rem] flex-1 space-y-1 border-l border-[#438456]/20 pl-2">
                  <span className="text-micro block px-1 text-muted-foreground">입금 내역</span>
                  {flow.members.filter((member) => member.toShared > 0).map((member) => <button key={member.id} type="button" onClick={() => openEditor({ type: "member-transfer", id: member.id, destination: "shared" })} className="text-micro flex min-h-8 w-full justify-between gap-1 rounded px-1 text-left hover:bg-white/70"><span className="truncate">{member.name.replace(/\s*급여$/, "")}</span><span className="shrink-0 tabular-nums"><Amount value={member.toShared} /></span></button>)}
                </div>
              </div> : null}
              {flow.additionalAccounts.map((account) => {
                const total = flow.members.reduce((sum, member) => sum + (member.extraTransfers[account.id] ?? 0), 0);
                const outgoing = account.buckets.reduce((sum, bucket) => sum + bucket.sharedTransfer, 0);
                const tone = account.kind === "shared" ? "border-[#c5dbc9] bg-[#eff7f0] text-[#438456]" : "border-[#f0dfa8] bg-[#fff8e5] text-[#9c7515]";
                return <div key={account.id} className={`col-span-5 sm:col-span-2 min-w-0 rounded-control border p-3 ${tone}`}>
                  <button type="button" onClick={() => openEditor({ type: "extra-account", id: account.id })} className="flex min-h-14 w-full items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white">{account.kind === "shared" ? <CircleDollarSign className="size-5" aria-hidden="true" /> : <Wallet className="size-4" aria-hidden="true" />}</span>
                    <span className="min-w-0 flex-1"><span className="text-caption block truncate text-muted-foreground">{account.name}</span><span className="text-body block font-semibold tabular-nums text-foreground"><Amount value={total} /></span></span>
                    <span className="text-micro rounded-full bg-white/70 px-2 py-1">{account.kind === "shared" ? "공용" : "저축"}</span>
                  </button>
                  <div className="mt-2 space-y-1 border-t border-black/10 pt-2">
                    <span className="text-micro block px-1 text-muted-foreground">입금 내역</span>
                    {flow.members.filter((member) => (member.extraTransfers[account.id] ?? 0) > 0).map((member) => <button key={member.id} type="button" onClick={() => openEditor({ type: "extra-transfer", id: member.id, accountId: account.id })} className="text-micro flex min-h-8 w-full justify-between gap-2 rounded px-1 text-left text-foreground hover:bg-white/70"><span className="truncate">{member.name.replace(/\s*급여$/, "")}</span><span className="shrink-0 tabular-nums"><Amount value={member.extraTransfers[account.id]} /></span></button>)}
                    {!flow.members.some((member) => (member.extraTransfers[account.id] ?? 0) > 0) ? <p className="text-micro px-1 py-1 text-muted-foreground">연결된 급여가 없어요</p> : null}
                  </div>
                  {account.kind === "shared" ? <div className="mt-3 border-t border-black/10 pt-2 text-foreground">
                    <p className="text-micro mb-1 font-semibold">이 통장에서 나가는 금액</p>
                    {account.buckets.map((bucket) => <div key={bucket.id} className="mt-2 rounded-control border border-black/5 bg-white/75 p-2">
                      <button type="button" onClick={() => openEditor({ type: "bucket", bucketId: bucket.id, accountId: account.id })} className="text-caption flex min-h-8 w-full justify-between gap-2 text-left font-medium"><span className="truncate">{bucket.name}</span><span className="shrink-0 tabular-nums"><Amount value={bucket.sharedTransfer} /></span></button>
                      <ul className="mt-1 space-y-1 border-l border-current/30 pl-2">
                        {bucket.rows.map((row) => <li key={row.id}><button type="button" onClick={() => openEditor({ type: "row", bucketId: bucket.id, id: row.id, accountId: account.id })} className="text-micro flex min-h-7 w-full justify-between gap-2 rounded bg-background/80 px-2 text-left"><span className="truncate">{row.name}</span><span className="shrink-0 tabular-nums"><Amount value={row.amount} /></span></button></li>)}
                        {bucket.rows.length === 0 ? <li className="text-micro py-1 text-muted-foreground">사용처를 추가할 수 있어요</li> : null}
                      </ul>
                      <button type="button" onClick={() => openEditor({ type: "new-row", bucketId: bucket.id, accountId: account.id })} className="text-micro mt-1 flex min-h-7 w-full items-center justify-center gap-1 rounded bg-background/70 font-medium text-primary"><Plus className="size-3" aria-hidden="true" />사용처 추가</button>
                    </div>)}
                    {outgoing !== total ? <p className="text-micro mt-2 text-destructive">입금액과 배분 합계가 <Amount value={Math.abs(total - outgoing)} /> 차이 나요.</p> : null}
                  </div> : null}
                </div>;
              })}
            </div>
            {hasSharedAccount ? <>
            <div className="relative h-[4.5rem]">
              <svg viewBox="0 0 300 72" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full text-[#83a991]">
                <path d="M210 0v12M75 12h150M75 12v54M225 12v54" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="m71 60 4 6 4-6M221 60l4 6 4-6" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span className="text-micro absolute left-[2%] top-5 flex w-[46%] justify-center truncate rounded-full border border-[#d5d5ef] bg-[#f0f0fb] px-2 py-0.5 font-medium text-[#514c9d] shadow-sm">{flow.buckets.find((bucket) => bucket.id === "living")?.name} · <Amount value={flow.buckets.find((bucket) => bucket.id === "living")?.sharedTransfer ?? 0} /></span>
              <span className="text-micro absolute right-[2%] top-5 flex w-[46%] justify-center truncate rounded-full border border-[#f0dfa8] bg-[#fff8e5] px-2 py-0.5 font-medium text-[#795b10] shadow-sm">{flow.buckets.find((bucket) => bucket.id === "savings")?.name} · <Amount value={flow.buckets.find((bucket) => bucket.id === "savings")?.sharedTransfer ?? 0} /></span>
            </div>
            {sharedDifference !== 0 ? <p className={`text-micro mt-2 text-center ${sharedDifference > 0 ? "text-muted-foreground" : "text-destructive"}`}>{sharedDifference > 0 ? "공용통장에 남겨둘 금액" : "공용통장 배분 초과"}: <Amount value={Math.abs(sharedDifference)} /></p> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {flow.buckets.map((bucket) => (
                <div key={bucket.id} className={`min-w-0 rounded-control border p-3 ${bucket.id === "living" ? "border-[#d5d5ef] bg-[#f0f0fb]" : "border-[#f0dfa8] bg-[#fff8e5]"}`}>
                  <button type="button" onClick={() => openEditor({ type: "bucket", bucketId: bucket.id })} className="flex min-h-14 w-full items-center gap-2 rounded-control text-left focus-visible:outline-2 focus-visible:outline-ring">
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-white ${bucket.id === "living" ? "text-[#625eaf]" : "text-[#9c7515]"}`}><Wallet className="size-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="text-caption block truncate text-muted-foreground">{bucket.name}</span><span className="text-body block font-semibold tabular-nums"><Amount value={bucketTotal(bucket)} /></span></span>
                  </button>
                  <div className={`ml-1 h-2 w-px ${bucket.id === "living" ? "bg-[#625eaf]" : "bg-[#9c7515]"}`} aria-hidden="true" />
                  <ul className={`text-micro ml-1 space-y-1.5 border-l py-1 pl-2 ${bucket.id === "living" ? "border-[#625eaf]" : "border-[#9c7515]"}`}>
                    {bucket.rows.map((row) => <li key={row.id}><button type="button" onClick={() => openEditor({ type: "row", bucketId: bucket.id, id: row.id })} className={`relative flex min-h-9 w-full justify-between gap-1 rounded border border-black/5 bg-white/80 px-2 py-1.5 text-left hover:bg-white focus-visible:outline-2 focus-visible:outline-ring before:absolute before:-left-[9px] before:top-1/2 before:w-2 before:border-t ${bucket.id === "living" ? "before:border-[#625eaf]" : "before:border-[#9c7515]"}`}><span className="min-w-0 truncate">{row.name}</span><span className="shrink-0 tabular-nums"><Amount value={row.amount} /></span></button></li>)}
                    {bucket.rows.length === 0 ? <li className="text-micro py-1 text-muted-foreground">아직 연결된 사용처가 없어요</li> : null}
                  </ul>
                  {bucketTotal(bucket) !== sumRows(bucket.rows) ? <p className="text-micro mt-2 text-destructive">통장으로 들어오는 금액과 사용처 합계가 <Amount value={Math.abs(bucketTotal(bucket) - sumRows(bucket.rows))} /> 차이 나요.</p> : null}
                  <button type="button" onClick={() => openEditor({ type: "new-row", bucketId: bucket.id })} className="text-micro mt-2 flex min-h-9 w-full items-center justify-center gap-1 rounded-control bg-white/70 font-medium text-primary"><Plus className="size-3.5" aria-hidden="true" />사용처 추가</button>
                </div>
              ))}
            </div>
            </> : null}
            </>}
          </div>
          <p className="text-micro mt-3 text-muted-foreground">{saved ? "이 브라우저 세션에 임시 저장돼요. 서버 저장과 가족 계정 동기화는 아직 연결되지 않았습니다." : "예시 금액이에요. 원하는 박스를 눌러 이름과 금액을 바꿔보세요."}</p>
        </section>
      ) : (
        <section className="finance-panel px-5" aria-labelledby="money-flow-empty-title">
          <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary"><GitBranch className="size-5" aria-hidden="true" /></span>
          <p className="text-micro mt-3 font-medium text-primary">1단계 · 수입 등록</p>
          <h2 id="money-flow-empty-title" className="text-heading mt-1 font-semibold">가족 수입부터 등록해요</h2>
          <p className="text-body mt-2 text-muted-foreground">수입 이름과 월 금액을 입력해요. 가족의 수입은 여러 개 등록할 수 있고, 통장은 다음 단계에서 추가해요.</p>
          <button type="button" onClick={() => openEditor({ type: "new-member" })} className="text-body mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-primary font-semibold text-primary-foreground"><Plus className="size-4" aria-hidden="true" />수입 등록</button>
          <p className="text-caption mt-4 rounded-control bg-muted p-3 text-muted-foreground">등록 내용은 이 브라우저 세션에만 임시 저장되며, 서버 저장과 가족 간 동기화는 아직 연결되지 않았습니다.</p>
        </section>
      )}

      {notice ? <p className="text-caption px-1 text-success-strong" role="status">{notice}</p> : null}

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent layout="sheet">
          <DialogHeader>
            <DialogTitle>{editorTitle}</DialogTitle>
            <DialogDescription>이 항목만 수정하고 흐름도에 바로 반영해요.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {showNameEditor ? <label className="block">
              <span className="text-caption mb-1.5 block text-muted-foreground">{editor?.type === "new-account" ? "통장 이름" : "이름"}</span>
              <input autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} className="h-12 w-full rounded-control border border-input bg-background px-3 text-body" />
            </label> : null}
            {editor?.type === "new-account" ? <fieldset className="space-y-2">
              <legend className="text-caption mb-1.5 text-muted-foreground">추가할 통장 종류</legend>
              {(["shared", "savings"] as const).map((destination) => <label key={destination} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-control border px-3 ${accountDestination === destination ? "border-primary bg-accent" : "border-border bg-background"}`}>
                <input type="radio" name="account-destination" checked={accountDestination === destination} onChange={() => { setAccountDestination(destination); const baseName = destination === "shared" ? flow.sharedAccount : flow.directSavingsAccount; const count = flow.additionalAccounts.filter((account) => account.kind === destination).length + (flow.destinations.includes(destination) ? 1 : 0); setNameDraft(count ? `${baseName} ${count + 1}` : baseName); }} className="size-4 accent-primary" />
                <span className="text-body">{destination === "shared" ? "공용통장" : "목표·저축 통장"}</span>
              </label>)}
              <p className="text-micro text-muted-foreground">공용통장과 저축 통장은 같은 종류도 여러 개 등록할 수 있어요.</p>
            </fieldset> : null}
            {showAmountEditor ? (
              <label className="block">
                <span className="text-caption mb-1.5 block text-muted-foreground">{incomeEditor ? "월 급여" : "이동 금액"}</span>
                <input type="number" min={0} step={10_000} value={amountDraft || ""} onChange={(event) => setAmountDraft(Math.max(0, Number(event.target.value) || 0))} className="h-12 w-full rounded-control border border-input bg-background px-3 text-right text-body tabular-nums" />
              </label>
            ) : amountReadOnly ? (
              <p className="text-caption rounded-control bg-muted p-3 text-muted-foreground">통장에 연결된 선의 금액을 합산해 표시해요: <b className="text-foreground"><Amount value={amountDraft} /></b></p>
            ) : null}
            {incomeEditor && routingEnabled ? (
              <div className="space-y-3 rounded-control bg-muted p-3">
                <p className="text-caption font-semibold">급여를 보낼 통장과 금액을 선택해요</p>
                {hasSharedAccount ? <>
                  <label className="flex min-h-10 items-center gap-2 text-body"><input type="checkbox" checked={includeShared} onChange={(event) => { setIncludeShared(event.target.checked); if (!event.target.checked) setSharedTransferDraft(0); }} className="size-4 accent-primary" />{flow.sharedAccount}</label>
                  {includeShared ? <label className="block"><span className="text-micro mb-1 block text-muted-foreground">{flow.sharedAccount}으로 보낼 금액</span><input type="number" min={0} step={10_000} value={sharedTransferDraft || ""} onChange={(event) => setSharedTransferDraft(Math.max(0, Number(event.target.value) || 0))} className="h-11 w-full rounded-control border border-input bg-background px-3 text-right text-body tabular-nums" /></label> : null}
                </> : null}
                {hasSavingsAccount ? <>
                  <label className="flex min-h-10 items-center gap-2 text-body"><input type="checkbox" checked={includeSavings} onChange={(event) => { setIncludeSavings(event.target.checked); if (!event.target.checked) setSavingsTransferDraft(0); }} className="size-4 accent-primary" />{flow.directSavingsAccount}</label>
                  {includeSavings ? <label className="block"><span className="text-micro mb-1 block text-muted-foreground">{flow.directSavingsAccount}으로 보낼 금액</span><input type="number" min={0} step={10_000} value={savingsTransferDraft || ""} onChange={(event) => setSavingsTransferDraft(Math.max(0, Number(event.target.value) || 0))} className="h-11 w-full rounded-control border border-input bg-background px-3 text-right text-body tabular-nums" /></label> : null}
                </> : null}
                {flow.additionalAccounts.map((account) => <div key={account.id} className="space-y-2">
                  <label className="flex min-h-10 items-center gap-2 text-body"><input type="checkbox" checked={includeExtraTransfers[account.id] ?? false} onChange={(event) => { setIncludeExtraTransfers((current) => ({ ...current, [account.id]: event.target.checked })); if (!event.target.checked) setExtraTransferDraft((current) => ({ ...current, [account.id]: 0 })); }} className="size-4 accent-primary" />{account.name}</label>
                  {includeExtraTransfers[account.id] ? <label className="block"><span className="text-micro mb-1 block text-muted-foreground">{account.name}으로 보낼 금액</span><input type="number" min={0} step={10_000} value={extraTransferDraft[account.id] || ""} onChange={(event) => setExtraTransferDraft((current) => ({ ...current, [account.id]: Math.max(0, Number(event.target.value) || 0) }))} className="h-11 w-full rounded-control border border-input bg-background px-3 text-right text-body tabular-nums" /></label> : null}
                </div>)}
                <p className="text-micro text-muted-foreground">각 통장 금액은 여기에 연결한 수입액을 합산해 보여줘요.</p>
              </div>
            ) : null}
            {incomeEditor && !routingEnabled ? <p className="text-caption rounded-control bg-muted p-3 text-muted-foreground">먼저 수입을 등록한 뒤 통장을 추가해요. 통장을 추가하면 여기서 보낼 곳과 금액을 정할 수 있어요.</p> : null}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between">
            {canRemove ? <button type="button" onClick={requestRemoveEditorItem} className="text-body min-h-12 rounded-control px-4 font-medium text-destructive active:bg-muted">삭제</button> : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditor(null)} className="text-body min-h-12 flex-1 rounded-control bg-muted px-5 font-medium active:opacity-80">취소</button>
              <button type="button" disabled={!nameDraft.trim()} onClick={saveEditor} className="text-body min-h-12 flex-1 rounded-control bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-40">저장</button>
            </div>
          </DialogFooter>
          {amountReadOnly ? <span className="sr-only">금액은 하위 항목의 합계로 계산됩니다.</span> : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>삭제 내용을 확인해 주세요</AlertDialogTitle>
            <AlertDialogDescription>{pendingRemoval?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (pendingRemoval) applyRemoval(pendingRemoval.target); }}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function MoneyFlowPage() {
  return <Suspense fallback={null}><MoneyFlowPageContent /></Suspense>;
}
