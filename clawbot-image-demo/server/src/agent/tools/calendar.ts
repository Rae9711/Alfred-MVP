/**
 * Tool: calendar.manage
 *
 * Manages Google Calendar events via Google Calendar API.
 * Supports creating, listing, updating, and deleting calendar events.
 */

import { registerTool, type ToolContext } from "./registry.js";
import { getGoogleToken } from "../../googleAuth.js";

// ── Google Calendar API base URL ────────────────────────

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

// ── types ───────────────────────────────────────────────

type CalendarAction = "create" | "list" | "update" | "delete";

type CalendarArgs = {
  action: CalendarAction;
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  event_id?: string;
  date_range_start?: string;
  date_range_end?: string;
};

type GoogleEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
};

// ── helpers ─────────────────────────────────────────────

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function formatEvent(ev: GoogleEvent) {
  return {
    id: ev.id ?? "",
    subject: ev.summary ?? "",
    start: ev.start?.dateTime ?? ev.start?.date ?? "",
    end: ev.end?.dateTime ?? ev.end?.date ?? "",
    location: ev.location ?? "",
  };
}

/**
 * Resolve symbolic dates like "TODAY", "TOMORROW", or partial dates into RFC 3339.
 */
function resolveDate(input: string, endOfDay = false): string {
  const s = input.trim().toUpperCase();
  const now = new Date();

  if (s === "TODAY" || s === "NOW") {
    const d = new Date(now);
    if (endOfDay) d.setHours(23, 59, 59, 0);
    else d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (s === "TOMORROW") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    if (endOfDay) d.setHours(23, 59, 59, 0);
    else d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (s.startsWith("TOMORROW_")) {
    // e.g. "TOMORROW_15:00"
    const time = s.replace("TOMORROW_", "");
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const [h, m] = time.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toISOString();
  }
  if (s.startsWith("TODAY_")) {
    const time = s.replace("TODAY_", "");
    const d = new Date(now);
    const [h, m] = time.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toISOString();
  }

  // If it looks like a date without time, append T00:00:00Z
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return endOfDay ? `${input.trim()}T23:59:59Z` : `${input.trim()}T00:00:00Z`;
  }

  // Already ISO or unknown — return as-is
  return input.trim();
}

// ── tool registration ───────────────────────────────────

registerTool({
  id: "calendar.manage",
  name: "日历管理",
  description: "通过 Google Calendar 创建、查看、更新或删除日历事件",
  category: "data",
  permissions: ["calendar.write"],
  argsSchema:
    '{ "action": "create | list | update | delete", "title": "(创建时) 事件标题", "start": "(创建时) ISO 日期时间", "end": "(创建时) ISO 日期时间", "location": "(可选) 地点", "event_id": "(更新/删除时) 事件ID", "date_range_start": "(列表时) ISO 日期", "date_range_end": "(列表时) ISO 日期" }',
  outputSchema:
    '{ "success": true, "event": { "id": "...", "subject": "...", "start": "...", "end": "...", "location": "..." } } 或 { "events": [...] }',

  async execute(args: CalendarArgs, _ctx: ToolContext) {
    const token = await getGoogleToken();
    if (!token) {
      return { error: "Google account not connected. Please set GOOGLE_ACCESS_TOKEN." };
    }

    const action = (args.action ?? "").trim() as CalendarAction;
    if (!action) {
      return { error: "calendar.manage requires an action (create | list | update | delete)" };
    }

    const calendarId = "primary";

    try {
      // ── create ──────────────────────────────────────
      if (action === "create") {
        const title = (args.title ?? "").trim();
        const start = resolveDate((args.start ?? "").trim());
        const end = resolveDate((args.end ?? "").trim());

        if (!title || !start || !end) {
          return { error: "create requires title, start, and end" };
        }

        const body: Record<string, any> = {
          summary: title,
          start: { dateTime: start, timeZone: "UTC" },
          end: { dateTime: end, timeZone: "UTC" },
        };

        if (args.location) {
          body.location = args.location;
        }

        const response = await fetch(
          `${CAL_BASE}/calendars/${calendarId}/events`,
          {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Calendar API returned ${response.status}: ${text || response.statusText}` };
        }

        const event = (await response.json()) as GoogleEvent;
        return { success: true, event: formatEvent(event) };
      }

      // ── list ────────────────────────────────────────
      if (action === "list") {
        const rangeStartRaw = (args.date_range_start ?? "").trim();
        const rangeEndRaw = (args.date_range_end ?? "").trim();

        if (!rangeStartRaw || !rangeEndRaw) {
          return { error: "list requires date_range_start and date_range_end" };
        }

        const rangeStart = resolveDate(rangeStartRaw);
        const rangeEnd = resolveDate(rangeEndRaw, true);

        const url = new URL(`${CAL_BASE}/calendars/${calendarId}/events`);
        url.searchParams.set("timeMin", rangeStart);
        url.searchParams.set("timeMax", rangeEnd);
        url.searchParams.set("maxResults", "20");
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Calendar API returned ${response.status}: ${text || response.statusText}` };
        }

        const data = (await response.json()) as { items?: GoogleEvent[] };
        const events = (data.items ?? []).map(formatEvent);
        return { success: true, events };
      }

      // ── update ──────────────────────────────────────
      if (action === "update") {
        const eventId = (args.event_id ?? "").trim();
        if (!eventId) {
          return { error: "update requires event_id" };
        }

        const body: Record<string, any> = {};
        if (args.title) body.summary = args.title;
        if (args.start) body.start = { dateTime: resolveDate(args.start), timeZone: "UTC" };
        if (args.end) body.end = { dateTime: resolveDate(args.end), timeZone: "UTC" };
        if (args.location) body.location = args.location;

        if (Object.keys(body).length === 0) {
          return { error: "update requires at least one field to change" };
        }

        const response = await fetch(
          `${CAL_BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
          {
            method: "PATCH",
            headers: authHeaders(token),
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Calendar API returned ${response.status}: ${text || response.statusText}` };
        }

        const event = (await response.json()) as GoogleEvent;
        return { success: true, event: formatEvent(event) };
      }

      // ── delete ──────────────────────────────────────
      if (action === "delete") {
        const eventId = (args.event_id ?? "").trim();
        if (!eventId) {
          return { error: "delete requires event_id" };
        }

        const response = await fetch(
          `${CAL_BASE}/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { error: `Google Calendar API returned ${response.status}: ${text || response.statusText}` };
        }

        return { success: true, deleted: eventId };
      }

      return { error: `Unknown action: ${action}. Use create, list, update, or delete.` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Calendar operation failed: ${message}` };
    }
  },
});
