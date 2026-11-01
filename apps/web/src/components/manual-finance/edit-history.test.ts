import { describe, expect, it, vi } from "vitest";
import { createManualEditorHistory } from "./edit-history";

function browser() {
  const events = new EventTarget();
  const entries: Array<{ url: string; data: unknown }> = [
    {
      url: "https://synthetic.invalid/assets?scope=private",
      data: { next: "kept" },
    },
  ];
  let cursor = 0;
  const port = {
    location: {
      get href() {
        return entries[cursor]!.url;
      },
    },
    history: {
      get state() {
        return entries[cursor]!.data;
      },
      pushState(data: unknown, _unused: string, url?: string | URL | null) {
        entries.splice(cursor + 1);
        entries.push({ data, url: String(url ?? entries[cursor]!.url) });
        cursor++;
      },
      replaceState(data: unknown, _unused: string, url?: string | URL | null) {
        entries[cursor] = { data, url: String(url ?? entries[cursor]!.url) };
      },
      back() {
        if (cursor > 0) {
          cursor--;
          events.dispatchEvent(new Event("popstate"));
        }
      },
    },
    addEventListener: (type: "popstate", listener: EventListener) =>
      events.addEventListener(type, listener),
    removeEventListener: (type: "popstate", listener: EventListener) =>
      events.removeEventListener(type, listener),
  };
  return {
    port,
    entries,
    get cursor() {
      return cursor;
    },
    depart() {
      entries[cursor] = { url: "https://synthetic.invalid/more", data: null };
      events.dispatchEvent(new Event("popstate"));
    },
  };
}
describe("manual editor browser-back ownership", () => {
  it("creates one entry while preserving the router state and reuses it on StrictMode attach", () => {
    const fake = browser(),
      back = vi.fn();
    const history = createManualEditorHistory(fake.port, "editor", {
      shouldConfirm: () => true,
      onBack: back,
      onAbandon: vi.fn(),
    });
    history.attach();
    expect(fake.entries).toHaveLength(2);
    expect(fake.port.history.state).toMatchObject({ next: "kept" });
    history.attach();
    history.detach();
    history.attach();
    expect(fake.entries).toHaveLength(2);
    expect(history.hasOwnedEntry).toBe(true);
  });
  it("restores one entry for dirty or pending input without growing history on repeated back", () => {
    const fake = browser(),
      back = vi.fn();
    const history = createManualEditorHistory(fake.port, "editor", {
      shouldConfirm: () => true,
      onBack: back,
      onAbandon: vi.fn(),
    });
    history.attach();
    for (let n = 0; n < 8; n++) {
      fake.port.history.back();
      expect(fake.entries).toHaveLength(2);
      expect(fake.cursor).toBe(1);
    }
    expect(back).toHaveBeenCalledTimes(8);
    history.close();
    expect(fake.cursor).toBe(0);
    history.close();
    expect(fake.cursor).toBe(0);
  });
  it("allows a clean back to close without another history back", () => {
    const fake = browser();
    let history: ReturnType<typeof createManualEditorHistory>;
    const back = vi.fn(() => history.close());
    history = createManualEditorHistory(fake.port, "editor", {
      shouldConfirm: () => false,
      onBack: back,
      onAbandon: vi.fn(),
    });
    history.attach();
    fake.port.history.back();
    expect(back).toHaveBeenCalledOnce();
    expect(fake.cursor).toBe(0);
    expect(fake.port.location.href).toBe(
      "https://synthetic.invalid/assets?scope=private"
    );
  });
  it("adopts a previous editor marker rather than stacking another entry", () => {
    const fake = browser();
    const first = createManualEditorHistory(fake.port, "first", {
      shouldConfirm: () => true,
      onBack: vi.fn(),
      onAbandon: vi.fn(),
    });
    first.attach();
    first.detach();
    const second = createManualEditorHistory(fake.port, "second", {
      shouldConfirm: () => true,
      onBack: vi.fn(),
      onAbandon: vi.fn(),
    });
    second.attach();
    expect(fake.entries).toHaveLength(2);
    expect(first.hasOwnedEntry).toBe(false);
    first.close();
    expect(fake.cursor).toBe(1);
    second.close();
    expect(fake.cursor).toBe(0);
  });
  it("never restores a stale private editor over a different URL or keeps intercepting after detach", () => {
    const fake = browser(),
      abandoned = vi.fn(),
      back = vi.fn();
    const history = createManualEditorHistory(fake.port, "editor", {
      shouldConfirm: () => true,
      onBack: back,
      onAbandon: abandoned,
    });
    history.attach();
    fake.depart();
    expect(abandoned).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
    expect(fake.port.location.href).toBe("https://synthetic.invalid/more");
    history.close();
    expect(fake.cursor).toBe(1);
    history.detach();
    fake.port.history.back();
    expect(back).not.toHaveBeenCalled();
  });
});
