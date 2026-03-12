/**
 * Airport Code Resolution
 * 
 * Maps city names to IATA airport codes for Google Flights URL construction.
 * 
 * Design: Fail-safe with helpful errors — never guess or create fake codes.
 */

// ── Types ────────────────────────────────────────────────

export type AirportResolution =
  | { resolved: true; code: string; displayName: string }
  | { resolved: false; input: string; suggestions: string[]; error: string };

// ── City → Airport Code Mapping ──────────────────────────

const CITY_TO_AIRPORT: Record<string, string> = {
  // Major US Cities
  "new york": "NYC",
  "nyc": "NYC",
  "new york city": "NYC",
  "manhattan": "NYC",
  "los angeles": "LAX",
  "la": "LAX",
  "chicago": "ORD",
  "detroit": "DTW",
  "san francisco": "SFO",
  "sf": "SFO",
  "seattle": "SEA",
  "boston": "BOS",
  "miami": "MIA",
  "atlanta": "ATL",
  "dallas": "DFW",
  "denver": "DEN",
  "phoenix": "PHX",
  "las vegas": "LAS",
  "vegas": "LAS",
  "washington": "DCA",
  "washington dc": "DCA",
  "dc": "DCA",
  "philadelphia": "PHL",
  "philly": "PHL",
  "houston": "IAH",
  "san diego": "SAN",
  "minneapolis": "MSP",
  "tampa": "TPA",
  "orlando": "MCO",
  "portland": "PDX",
  "austin": "AUS",
  "nashville": "BNA",
  "new orleans": "MSY",
  "salt lake city": "SLC",
  "cleveland": "CLE",
  "pittsburgh": "PIT",
  "st louis": "STL",
  "saint louis": "STL",
  "kansas city": "MCI",
  "honolulu": "HNL",
  "hawaii": "HNL",
  "anchorage": "ANC",
  "alaska": "ANC",
  
  // International Cities
  "london": "LHR",
  "paris": "CDG",
  "tokyo": "NRT",
  "tokyo narita": "NRT",
  "tokyo haneda": "HND",
  "beijing": "PEK",
  "shanghai": "PVG",
  "hong kong": "HKG",
  "singapore": "SIN",
  "dubai": "DXB",
  "sydney": "SYD",
  "melbourne": "MEL",
  "toronto": "YYZ",
  "vancouver": "YVR",
  "montreal": "YUL",
  "mexico city": "MEX",
  "cancun": "CUN",
  "frankfurt": "FRA",
  "amsterdam": "AMS",
  "rome": "FCO",
  "milan": "MXP",
  "madrid": "MAD",
  "barcelona": "BCN",
  "munich": "MUC",
  "zurich": "ZRH",
  "seoul": "ICN",
  "bangkok": "BKK",
  "taipei": "TPE",
  "manila": "MNL",
  "delhi": "DEL",
  "mumbai": "BOM",
  "istanbul": "IST",
  "dublin": "DUB",
  "lisbon": "LIS",
  "cairo": "CAI",
  "johannesburg": "JNB",
  "auckland": "AKL",
  "sao paulo": "GRU",
  "buenos aires": "EZE",
  "lima": "LIM",
  "bogota": "BOG",
};

// Reverse mapping for display names
const IATA_TO_CITY: Record<string, string> = {};
for (const [city, code] of Object.entries(CITY_TO_AIRPORT)) {
  // Use the first (usually longest) city name for each code
  if (!IATA_TO_CITY[code]) {
    // Capitalize first letter of each word
    IATA_TO_CITY[code] = city
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
}

// ── Resolution Functions ─────────────────────────────────

/**
 * Resolve a city name or airport code to a valid IATA code.
 * 
 * @param input - User input (city name or airport code)
 * @returns Resolution result with code or helpful error
 */
export function resolveAirportCode(input: string): AirportResolution {
  const trimmed = input.trim();
  const normalized = trimmed.toLowerCase();
  
  // Empty input
  if (!trimmed) {
    return {
      resolved: false,
      input: trimmed,
      suggestions: [],
      error: "请输入城市名称或机场代码",
    };
  }
  
  // Check if already a valid IATA code (3 uppercase letters)
  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    const cityName = IATA_TO_CITY[code];
    return {
      resolved: true,
      code,
      displayName: cityName ? `${cityName} (${code})` : code,
    };
  }
  
  // Exact match in city mapping
  if (CITY_TO_AIRPORT[normalized]) {
    const code = CITY_TO_AIRPORT[normalized];
    return {
      resolved: true,
      code,
      displayName: `${trimmed} (${code})`,
    };
  }
  
  // Fuzzy match — find similar city names
  const suggestions = findSimilarCities(normalized, 3);
  
  // Fail with guidance — DO NOT guess
  return {
    resolved: false,
    input: trimmed,
    suggestions,
    error:
      suggestions.length > 0
        ? `无法解析 "${trimmed}"。您是否指的是: ${suggestions.join(", ")}?`
        : `无法解析 "${trimmed}"。请使用城市名称或3字母机场代码（如 NYC, LAX, DTW）。`,
  };
}

/**
 * Find similar city names for suggestions.
 * Uses simple substring matching and Levenshtein distance.
 * 
 * @param input - Normalized user input
 * @param limit - Maximum number of suggestions
 * @returns Array of suggestion strings
 */
function findSimilarCities(input: string, limit: number): string[] {
  const matches: { city: string; score: number }[] = [];
  
  for (const [city, code] of Object.entries(CITY_TO_AIRPORT)) {
    // Skip very short aliases
    if (city.length < 3) continue;
    
    let score = 0;
    
    // Exact prefix match
    if (city.startsWith(input)) {
      score = 100;
    }
    // Substring match
    else if (city.includes(input)) {
      score = 50;
    }
    // Input is substring of city
    else if (input.length >= 3 && city.includes(input)) {
      score = 40;
    }
    // Levenshtein distance for typos
    else {
      const distance = levenshteinDistance(input, city);
      if (distance <= 2) {
        score = 30 - distance * 10;
      }
    }
    
    if (score > 0) {
      // Capitalize for display
      const displayCity = city
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      matches.push({ city: `${displayCity} (${code})`, score });
    }
  }
  
  // Sort by score descending, take top N
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.city);
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Get default date (tomorrow) for flight search.
 */
export function getDefaultDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
}
