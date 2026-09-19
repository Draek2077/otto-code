/**
 * Adapted from Activepieces gmail/src/lib/common/mime.ts,
 * actions/reply-to-email-action.ts and actions/forward-message-action.ts.
 * Upstream: activepieces/activepieces@89aeeae8c1eb98428210ec7d214f933b96aa1987.
 * Otto changes: independent of the pieces framework, parsed address lists,
 * bounded attachments, no file/URL reads, and native Unicode header encoding.
 *
 * Copyright (c) 2020-2024 Activepieces Inc.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Use the exact public export: the Nix dependency tracer cannot resolve
// Nodemailer's overlapping wildcard exports for the legacy /index.js path.
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type Mail from "nodemailer/lib/mailer/index.js";

export interface OfficeMailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: boolean;
}

export async function parseGoogleMail(raw: string): Promise<ParsedMail> {
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length > 8 * 1024 * 1024) throw new Error("This email is too large to read or forward in one operation.");
  return simpleParser(bytes, { skipImageLinks: true });
}

export async function composeGoogleMail(input: OfficeMailInput & {
  from: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Mail.Attachment[];
}): Promise<string> {
  const composer = new MailComposer({
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.html ? undefined : input.body,
    html: input.html ? input.body : undefined,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: input.attachments,
    disableFileAccess: true,
    disableUrlAccess: true,
  }).compile();
  composer.keepBcc = true;
  return (await composer.build()).toString("base64url");
}

function addresses(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => item.value)
    .map((item) => item.address)
    .filter((address): address is string => !!address);
}

export function summarizeGoogleMail(mail: ParsedMail) {
  return {
    subject: mail.subject ?? "",
    from: addresses(mail.from),
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    date: mail.date?.toISOString(),
    body: (mail.text ?? "").slice(0, 24_000),
    truncated: (mail.text?.length ?? 0) > 24_000,
    attachments: mail.attachments.map((item) => ({ name: item.filename, contentType: item.contentType, size: item.size })),
  };
}

export async function replyGoogleMail(input: {
  original: ParsedMail;
  from: string;
  body: string;
  replyAll?: boolean;
}): Promise<string> {
  const mail = input.original;
  const sender = addresses(mail.replyTo ?? mail.from);
  const excludeSelf = (items: string[]) => [...new Set(items)].filter((value) => value.toLowerCase() !== input.from.toLowerCase());
  const to = excludeSelf([...sender, ...(input.replyAll ? addresses(mail.to) : [])]);
  if (!to.length) throw new Error("The original message has no reply recipient.");
  return composeGoogleMail({
    from: input.from,
    to,
    cc: input.replyAll ? excludeSelf(addresses(mail.cc)).filter((value) => !to.includes(value)) : undefined,
    subject: mail.subject ?? "",
    body: input.body,
    inReplyTo: mail.messageId,
    references: [...(typeof mail.references === "string" ? [mail.references] : mail.references ?? []), ...(mail.messageId ? [mail.messageId] : [])],
  });
}

export async function forwardGoogleMail(input: {
  original: ParsedMail;
  from: string;
  to: string[];
  note?: string;
}): Promise<string> {
  const mail = input.original;
  return composeGoogleMail({
    from: input.from,
    to: input.to,
    subject: /^fwd:/i.test(mail.subject ?? "") ? mail.subject! : `Fwd: ${mail.subject ?? ""}`,
    body: `${input.note ?? ""}\n\n---------- Forwarded message ----------\nFrom: ${mail.from?.text ?? ""}\nDate: ${mail.date?.toUTCString() ?? ""}\nSubject: ${mail.subject ?? ""}\nTo: ${addresses(mail.to).join(", ")}\n\n${mail.text ?? ""}`,
    attachments: mail.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
      cid: attachment.cid,
    })),
  });
}
