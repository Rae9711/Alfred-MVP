/**
 * Tool: flights.search
 *
 * Searches for flights between two cities using the Kiwi.com Tequila API.
 * Returns flight information including airline, times, price, and duration.
 */

import { registerTool, type ToolContext } from "./registry.js";

// ── helpers ─────────────────────────────────────────────

/**
 * Convert "YYYY-MM-DD" to "DD/MM/YYYY" as required by the Tequila API.
 */
function toKiwiDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Format seconds into a human-readable duration string (e.g. "2h 35m").
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ── types ───────────────────────────────────────────────

type FlightSearchArgs = {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  max_price?: number;
  count?: number;
};

type FlightResult = {
  airline: string;
  departure: string;
  arrival: string;
  price: string;
  duration: string;
};

// ── tool registration ───────────────────────────────────

registerTool({
  id: "flights.search",
  name: "航班搜索",
  description: "搜索两个城市之间的航班信息和价格",
  category: "data",
  permissions: [],
  argsSchema:
    '{ "origin": "出发城市/机场代码", "destination": "到达城市/机场代码", "departure_date": "YYYY-MM-DD", "return_date": "(可选) YYYY-MM-DD", "max_price": "(可选) 最高价格(USD)", "count": "(可选) 结果数量，默认 5" }',
  outputSchema:
    '{ "flights": [{ "airline": "...", "departure": "...", "arrival": "...", "price": "...", "duration": "..." }] }',

  async execute(args: FlightSearchArgs, _ctx: ToolContext) {
    const apiKey = process.env.KIWI_API_KEY;
    if (!apiKey) {
      return { error: "KIWI_API_KEY is not configured" };
    }

    const origin = (args.origin ?? "").trim();
    const destination = (args.destination ?? "").trim();
    const departureDate = (args.departure_date ?? "").trim();

    if (!origin || !destination || !departureDate) {
      return { error: "origin, destination, and departure_date are required" };
    }

    const limit = args.count ?? 5;
    const kiwiDepartureDate = toKiwiDate(departureDate);

    // Build query parameters
    const params = new URLSearchParams({
      fly_from: origin,
      fly_to: destination,
      date_from: kiwiDepartureDate,
      date_to: kiwiDepartureDate,
      curr: "USD",
      limit: String(limit),
    });

    if (args.return_date) {
      const kiwiReturnDate = toKiwiDate(args.return_date.trim());
      params.set("return_from", kiwiReturnDate);
      params.set("return_to", kiwiReturnDate);
    }

    if (args.max_price != null) {
      params.set("price_to", String(args.max_price));
    }

    const url = `https://api.tequila.kiwi.com/v2/search?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { apikey: apiKey },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          error: `Kiwi API returned HTTP ${response.status}: ${body}`,
        };
      }

      const data = (await response.json()) as {
        data?: Array<{
          airlines?: string[];
          local_departure?: string;
          local_arrival?: string;
          price?: number;
          duration?: { total?: number };
        }>;
      };

      const flights: FlightResult[] = (data.data ?? []).map((flight) => ({
        airline: (flight.airlines ?? []).join(", ") || "Unknown",
        departure: flight.local_departure ?? "",
        arrival: flight.local_arrival ?? "",
        price: flight.price != null ? `$${flight.price} USD` : "N/A",
        duration:
          flight.duration?.total != null
            ? formatDuration(flight.duration.total)
            : "N/A",
      }));

      return { flights };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error occurred";
      return { error: `Flight search failed: ${message}` };
    }
  },
});
