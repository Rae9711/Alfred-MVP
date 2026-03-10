/**
 * Tool: email.read
 *
 * Searches and reads emails from the user's Gmail inbox using Google Gmail API.
 * Requires a valid Google OAuth access token (set via GOOGLE_ACCESS_TOKEN env var).
 */

import { registerTool, type ToolContext } from "./registry.js";
import { getGoogleToken } from "../../googleAuth.js";

// ── Gmail API types ─────────────────────────────────────

type GmailHeader = { name?: string; value?: string };

type GmailMessagePart = {
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id?: string;
  snippet?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
};

type GmailListResponse = {
  messages?: Array<{ id?: string }>;
};

// ── helpers ──────────────────────────────────────────────

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function extractPlainText(part: GmailMessagePart): string {
  if (part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const p of part.parts) {
      const text = extractPlainText(p);
      if (text) return text;
    }
  }
  return "";
}

// ── tool registration ───────────────────────────────────

registerTool({
  id: "email.read",
  name: "读取邮件",
  description: "搜索和读取用户 Gmail 收件箱中的邮件",
  category: "data",
  permissions: ["email.read"],
  argsSchema:
    '{ "query": "(可选) Gmail 搜索语法", "count": "(可选) 邮件数量，默认 5" }',
  outputSchema:
    '{ "emails": [{ "from": "...", "subject": "...", "preview": "...", "date": "..." }] }',

  async execute(
    args: {
      query?: string;
      count?: number;
    },
    _ctx: ToolContext,
  ) {
    const token = await getGoogleToken();
    if (!token) {
      return {
        error: "Google account not connected. Please set GOOGLE_ACCESS_TOKEN.",
      };
    }

    const count = Math.min(Math.max(args.count ?? 5, 1), 50);

    // 1. List message IDs
    const listUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    listUrl.searchParams.set("maxResults", String(count));

    const query = (args.query ?? "").trim();
    if (query) {
      listUrl.searchParams.set("q", query);
    }

    try {
      const listResp = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!listResp.ok) {
        const errBody = await listResp.text().catch(() => "");
        return {
          error: `Gmail API returned ${listResp.status}: ${errBody || listResp.statusText}`,
        };
      }

      const listData = (await listResp.json()) as GmailListResponse;
      const messageIds = (listData.messages ?? [])
        .map((m) => m.id)
        .filter(Boolean) as string[];

      if (messageIds.length === 0) {
        return { emails: [] };
      }

      // 2. Fetch each message in parallel (metadata + snippet)
      const emails = await Promise.all(
        messageIds.map(async (id) => {
          const msgResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } },
          );

          if (!msgResp.ok) return null;

          const msg = (await msgResp.json()) as GmailMessage;
          const headers = msg.payload?.headers;

          return {
            from: getHeader(headers, "From"),
            subject: getHeader(headers, "Subject") || "(no subject)",
            preview: msg.snippet ?? "",
            date: getHeader(headers, "Date"),
          };
        }),
      );

      return { emails: emails.filter(Boolean) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to read emails: ${message}` };
    }
  },
});
