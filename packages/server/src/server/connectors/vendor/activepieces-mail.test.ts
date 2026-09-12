import { describe, expect, it } from "vitest";
import { composeGoogleMail, forwardGoogleMail, parseGoogleMail, replyGoogleMail } from "./activepieces-mail.js";

describe("vendored Gmail MIME operations", () => {
  it("preserves Unicode subjects, Bcc and binary attachments across forwarding", async () => {
    const original = await parseGoogleMail(await composeGoogleMail({
      from: "sender@example.org", to: ["me@example.org"], bcc: ["hidden@example.org"],
      subject: "Résumé ☕", body: "Original body", attachments: [{ filename: "data.bin", content: Buffer.from([0, 128, 255]) }],
    }));
    expect(original.subject).toBe("Résumé ☕");
    expect(original.bcc).toMatchObject({ value: [{ address: "hidden@example.org" }] });
    const forwarded = await parseGoogleMail(await forwardGoogleMail({ original, from: "me@example.org", to: ["next@example.org"], note: "Please read" }));
    expect(forwarded.subject).toBe("Fwd: Résumé ☕");
    expect(forwarded.text).toContain("Please read");
    expect(forwarded.attachments[0]?.content).toEqual(Buffer.from([0, 128, 255]));
    expect(forwarded.bcc).toBeUndefined();
  });

  it("replies to Reply-To and parses quoted names without splitting their commas", async () => {
    const original = await parseGoogleMail(Buffer.from([
      'From: "Last, First" <sender@example.org>', 'Reply-To: replies@example.org',
      'To: me@example.org, "Other, Person" <other@example.org>', 'Cc: cc@example.org',
      'Message-ID: <original@example.org>', 'References: <ancestor@example.org>',
      'Subject: Existing thread', '', 'Hello',
    ].join('\r\n')).toString('base64url'));
    const reply = await parseGoogleMail(await replyGoogleMail({ original, from: "me@example.org", body: "Response", replyAll: true }));
    expect(reply.to).toMatchObject({ value: [{ address: "replies@example.org" }, { address: "other@example.org" }] });
    expect(reply.cc).toMatchObject({ value: [{ address: "cc@example.org" }] });
    expect(reply.subject).toBe("Existing thread");
    expect(reply.inReplyTo).toBe("<original@example.org>");
    expect(reply.references).toEqual(["<ancestor@example.org>", "<original@example.org>"]);
  });
});
