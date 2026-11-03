"use client";

import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  createManualSaveSession,
  manualFailureMessage,
  manualFailureRequiresRead,
  manualRecordVersionChanged,
} from "./model";

interface RecordMeta {
  id: string;
  version: number;
  canEdit: boolean;
  visibility: "private" | "household";
}
type Validation<T> = { ok: true; body: T } | { ok: false; message: string };
const statusOf = (failure: unknown) =>
  failure && typeof failure === "object" && "status" in failure
    ? (failure as { status: unknown }).status
    : null;
function canonical(body: unknown) {
  const value = body as Record<string, unknown>;
  return JSON.stringify({
    ...value,
    ...(Array.isArray(value.payments)
      ? {
          payments: [...value.payments].sort((a, b) =>
            String(a.id).localeCompare(String(b.id))
          ),
        }
      : {}),
  });
}

/** No mutation is retried automatically; the same create UUID lives for this entire editor. */
export function useRecordEditor<D, B, R extends { item: RecordMeta }>(options: {
  initial: R | null;
  observedVersion?: number;
  emptyDraft: () => D;
  toDraft: (read: R) => D;
  validate: (draft: D, id: string) => Validation<B>;
  save: (body: B, current: R | null) => Promise<R>;
  read: (id: string) => Promise<R>;
  remove: (current: R) => Promise<unknown>;
  onChanged: (read: R) => void;
  onClose: () => void;
  changed: (clear?: boolean) => void;
}) {
  const [id] = useState(() => options.initial?.item.id ?? crypto.randomUUID());
  const [current, setCurrent] = useState(options.initial);
  const [draft, setDraft] = useState<D>(() =>
    options.initial ? options.toDraft(options.initial) : options.emptyDraft()
  );
  const base = useRef(draft);
  const [phase, setPhase] = useState<
    "idle" | "saving" | "reading" | "removing"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readRequired, setReadRequired] = useState(false);
  const [latest, setLatest] = useState<R | null>(null);
  const operation = useRef<"save" | "remove">("save");
  const session = useRef(createManualSaveSession());
  const observedVersion = useRef(options.initial?.item.version);
  if (
    options.observedVersion !== undefined &&
    (observedVersion.current === undefined ||
      options.observedVersion > observedVersion.current)
  )
    observedVersion.current = options.observedVersion;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.current);
  const canEdit = current?.item.canEdit !== false;
  const versionChanged = manualRecordVersionChanged(
    current?.item.version ?? null,
    observedVersion.current
  );
  const requiresRead = readRequired || versionChanged;
  const unavailable = () => {
    session.current.invalidate();
    options.changed(true);
    options.onClose();
    toast.error(
      "기록의 권한이나 상태가 바뀌어 닫았어요. 목록을 다시 확인해 주세요."
    );
  };
  const failed = (failure: unknown) => {
    setPhase("idle");
    if (statusOf(failure) === 403 || (statusOf(failure) === 404 && current)) {
      unavailable();
      return;
    }
    setError(manualFailureMessage(failure));
    setReadRequired(manualFailureRequiresRead(failure));
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.current.pending || requiresRead || !canEdit) return;
    const validation = options.validate(draft, id);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setError(null);
    setNotice(null);
    setLatest(null);
    setPhase("saving");
    operation.current = "save";
    await session.current.run(
      async () => {
        try {
          return await options.save(validation.body, current);
        } finally {
          options.changed();
        }
      },
      (read) => {
        setPhase("idle");
        toast.success(
          read.item.visibility === "private"
            ? "비공개로 저장했어요. 나만 보기에서 확인해 주세요."
            : "가족 공개로 저장했어요."
        );
        options.onChanged(read);
      },
      failed
    );
  };
  const read = async () => {
    if (session.current.pending) return;
    setPhase("reading");
    setNotice(null);
    await session.current.run(
      () => options.read(id),
      (read) => {
        setPhase("idle");
        const ours = options.validate(draft, id),
          saved = options.validate(options.toDraft(read), id);
        if (
          operation.current === "save" &&
          ours.ok &&
          saved.ok &&
          canonical(ours.body) === canonical(saved.body)
        ) {
          options.changed();
          toast.success("입력한 기록이 저장된 것을 확인했어요.");
          options.onChanged(read);
          return;
        }
        setLatest(read);
        setReadRequired(true);
        setNotice(
          "현재 기록을 가져왔어요. 이전 입력은 그대로 남겨뒀어요. 비교한 뒤 현재 기록으로 다시 시작해 주세요."
        );
      },
      (failure) => {
        setPhase("idle");
        if (
          statusOf(failure) === 404 &&
          !current &&
          operation.current === "save"
        ) {
          setReadRequired(false);
          setError(null);
          setNotice(
            "현재 해당 기록을 찾지 못했어요. 같은 식별자로 다시 저장할 수 있어요. 이미 처리되었더라도 새 기록을 중복 생성하지 않아요."
          );
        } else if (statusOf(failure) === 403 || statusOf(failure) === 404)
          unavailable();
        else {
          setReadRequired(true);
          setError(
            "현재 기록을 확인하지 못했어요. 입력은 그대로 남아 있어요. 다시 저장하거나 삭제하지 말고 잠시 뒤 확인해 주세요."
          );
        }
      }
    );
  };
  const resetLatest = () => {
    if (!latest) return;
    const next = options.toDraft(latest);
    setCurrent(latest);
    base.current = next;
    setDraft(next);
    setReadRequired(false);
    setLatest(null);
    setError(null);
    setNotice("현재 기록으로 다시 시작했어요.");
  };
  const remove = async () => {
    if (!current || !canEdit || session.current.pending || requiresRead) return;
    operation.current = "remove";
    setPhase("removing");
    setError(null);
    setNotice(null);
    await session.current.run(
      async () => {
        try {
          const result = await options.remove(current);
          if (
            !result ||
            typeof result !== "object" ||
            !("deleted" in result) ||
            result.deleted !== true
          )
            throw new Error("manual deletion outcome unconfirmed");
          return result;
        } finally {
          options.changed();
        }
      },
      () => {
        setPhase("idle");
        toast.success("수동 기록을 목록에서 삭제했어요.");
        options.onClose();
      },
      failed
    );
  };
  return {
    id,
    current,
    draft,
    setDraft,
    dirty,
    phase,
    busy: phase !== "idle",
    error: versionChanged
      ? "다른 곳에서 현재 기록이 바뀌었어요. 입력은 그대로 남아 있어요. 다시 저장하기 전에 현재 기록을 확인해 주세요."
      : error,
    notice,
    readRequired: requiresRead,
    latest,
    canEdit,
    save,
    read,
    remove,
    resetLatest,
    pending: () => session.current.pending,
    invalidate: () => session.current.invalidate(),
  };
}
