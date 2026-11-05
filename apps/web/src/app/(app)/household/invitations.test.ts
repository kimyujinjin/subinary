import type { InvitationSummary } from "@family/contracts";
import { describe, expect, it } from "vitest";

import { invitationStatus, splitInvitations } from "./invitations";

const NOW = Date.parse("2026-11-05T09:00:00.000Z");

function invitation(
  changes: Partial<InvitationSummary> = {}
): InvitationSummary {
  return {
    id: "inv-1",
    email: null,
    role: "member",
    status: "pending",
    expiresAt: "2026-11-12T09:00:00.000Z",
    createdAt: "2026-11-05T08:00:00.000Z",
    ...changes,
  };
}

describe("invitationStatus", () => {
  it("keeps a pending invite whose expiry is still ahead", () => {
    expect(invitationStatus(invitation(), NOW)).toBe("pending");
  });

  it("treats a pending invite past its expiry as expired even though the server still says pending", () => {
    expect(
      invitationStatus(
        invitation({ expiresAt: "2026-11-05T08:59:59.999Z" }),
        NOW
      )
    ).toBe("expired");
  });

  it("matches the server boundary: an invite expiring exactly now is still usable", () => {
    expect(
      invitationStatus(
        invitation({ expiresAt: new Date(NOW).toISOString() }),
        NOW
      )
    ).toBe("pending");
  });

  it("never revives accepted or revoked invites", () => {
    const past = "2026-11-01T00:00:00.000Z";
    const future = "2026-12-01T00:00:00.000Z";
    for (const expiresAt of [past, future]) {
      expect(
        invitationStatus(invitation({ status: "accepted", expiresAt }), NOW)
      ).toBe("accepted");
      expect(
        invitationStatus(invitation({ status: "revoked", expiresAt }), NOW)
      ).toBe("revoked");
    }
  });

  it("leaves an unreadable expiry to the server instead of guessing expired", () => {
    expect(invitationStatus(invitation({ expiresAt: "not-a-date" }), NOW)).toBe(
      "pending"
    );
  });
});

describe("splitInvitations", () => {
  it("opens only usable invites and folds the rest, keeping server order", () => {
    const list = [
      invitation({ id: "a" }),
      invitation({ id: "b", expiresAt: "2026-11-04T00:00:00.000Z" }),
      invitation({ id: "c", status: "accepted" }),
      invitation({ id: "d", expiresAt: "2026-11-20T00:00:00.000Z" }),
      invitation({ id: "e", status: "revoked" }),
    ];
    const { pending, past } = splitInvitations(list, NOW);
    expect(pending.map((i) => i.id)).toEqual(["a", "d"]);
    expect(past.map((p) => [p.invitation.id, p.status])).toEqual([
      ["b", "expired"],
      ["c", "accepted"],
      ["e", "revoked"],
    ]);
  });

  it("returns empty groups for an empty list", () => {
    expect(splitInvitations([], NOW)).toEqual({ pending: [], past: [] });
  });
});
