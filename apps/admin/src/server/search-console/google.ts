import "server-only";

import { SEARCH_CONSOLE_PROPERTY, type SearchConsoleMetrics, type SearchConsolePermission, type SearchConsoleRow } from "./model";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://www.googleapis.com/webmasters/v3";
export const SEARCH_CONSOLE_ROW_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export type SearchConsoleEnvironment = Record<string, string | undefined>;

type SearchConsoleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type CredentialRead =
  | { state: "not_configured"; reason: string }
  | { state: "unavailable"; reason: string }
  | { state: "configured"; credentials: SearchConsoleCredentials };

export type SearchConsoleDimension = "query" | "page" | "date";

export type SearchAnalyticsRequest = {
  startDate: string;
  endDate: string;
  dimensions?: SearchConsoleDimension[];
  dataState: "all" | "final";
  aggregationType?: "auto" | "byPage" | "byProperty";
};

export type SearchAnalyticsResult = {
  rows: SearchConsoleRow[];
  firstIncompleteDate: string | null;
};

export class SearchConsoleProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchConsoleProviderError";
  }
}

export type SearchConsoleSetup =
  | { state: "not_configured"; reason: string }
  | { state: "unavailable"; reason: string }
  | { state: "configured"; provider: GoogleSearchConsoleProvider };

function readCredentials(environment: SearchConsoleEnvironment): CredentialRead {
  if (environment.VERCEL === "1" && environment.VERCEL_ENV !== "production") {
    return { state: "not_configured", reason: "Search Console is only available on the production Admin deployment." };
  }

  const clientId = environment.SEARCH_CONSOLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.SEARCH_CONSOLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = environment.SEARCH_CONSOLE_OAUTH_REFRESH_TOKEN?.trim();

  if (!clientId && !clientSecret && !refreshToken) {
    return { state: "not_configured", reason: "Add the server-only Google OAuth configuration to connect Search Console." };
  }

  if (!clientId || !clientSecret || !refreshToken || /\s/.test(clientId)) {
    return { state: "unavailable", reason: "Search Console OAuth configuration is incomplete. Review the production environment variables." };
  }

  return { state: "configured", credentials: { clientId, clientSecret, refreshToken } };
}

type ApiRow = {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRows(value: unknown, dimensions: SearchConsoleDimension[] = []): SearchConsoleRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new SearchConsoleProviderError("Google returned an invalid Search Console row set.");
  return value.map((entry) => {
    if (!isRecord(entry)) throw new SearchConsoleProviderError("Google returned an invalid Search Console row.");
    const row = entry as ApiRow;
    if (!Array.isArray(row.keys) || !row.keys.every((key) => typeof key === "string") || row.keys.length !== dimensions.length) {
      throw new SearchConsoleProviderError("Google returned Search Console rows with unexpected dimensions.");
    }
    const clicks = finiteNumber(row.clicks);
    const impressions = finiteNumber(row.impressions);
    const ctr = finiteNumber(row.ctr);
    const position = finiteNumber(row.position);
    if (clicks === null || impressions === null || ctr === null || position === null) {
      throw new SearchConsoleProviderError("Google returned Search Console rows with invalid metrics.");
    }
    const keys = row.keys as string[];
    const key = dimensions.length > 1 ? JSON.stringify(keys) : keys.join("");
    return { key, clicks, impressions, ctr, position };
  });
}

function normalizeMetrics(rows: SearchConsoleRow[]): SearchConsoleMetrics | null {
  const row = rows[0];
  return row ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } : null;
}

function safeProviderMessage(status: number, endpoint: "oauth" | "property" | "query"): string {
  if (endpoint === "oauth") return "Google could not refresh Search Console access. Review the production OAuth configuration.";
  if (status === 401) return "Google rejected Search Console authorization. Review the production OAuth configuration.";
  if (status === 403) return "Google denied this Search Console read. Check the account's property access and confirm the Search Console API is enabled.";
  if (status === 404) return "The Wanterest Search Console domain property was not found.";
  if (status === 429) return "Search Console rate-limited this request. Try again later.";
  return "Search Console is temporarily unavailable. Try again later.";
}

async function readJson(response: Response, endpoint: "oauth" | "property" | "query"): Promise<unknown> {
  if (!response.ok) throw new SearchConsoleProviderError(safeProviderMessage(response.status, endpoint));
  try {
    return await response.json();
  } catch {
    throw new SearchConsoleProviderError("Google returned an unreadable Search Console response.");
  }
}

export class GoogleSearchConsoleProvider {
  private readonly credentials: SearchConsoleCredentials;
  private readonly fetcher: typeof fetch;
  private accessToken: string | null = null;

  constructor(credentials: SearchConsoleCredentials, fetcher: typeof fetch = fetch) {
    this.credentials = credentials;
    this.fetcher = fetcher;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    let response: Response;
    try {
      response = await this.fetcher(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          refresh_token: this.credentials.refreshToken,
          grant_type: "refresh_token",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SearchConsoleProviderError("Google OAuth could not be reached. Try again later.");
    }

    const value = await readJson(response, "oauth");
    const token = isRecord(value) ? value.access_token : null;
    if (typeof token !== "string" || token.length === 0) {
      throw new SearchConsoleProviderError("Google did not return a usable Search Console access token.");
    }
    this.accessToken = token;
    return token;
  }

  async verifyProperty(): Promise<SearchConsolePermission> {
    const accessToken = await this.getAccessToken();
    const endpoint = API_ROOT + "/sites/" + encodeURIComponent(SEARCH_CONSOLE_PROPERTY);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        headers: { authorization: "Bearer " + accessToken },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SearchConsoleProviderError("Google Search Console could not be reached. Try again later.");
    }
    const value = await readJson(response, "property");
    const permission = isRecord(value) ? value.permissionLevel : null;
    if (permission !== "siteRestrictedUser" && permission !== "siteFullUser" && permission !== "siteOwner") {
      throw new SearchConsoleProviderError("The connected Google account needs verified read access to the Wanterest Search Console property.");
    }
    return permission;
  }

  async query(request: SearchAnalyticsRequest): Promise<SearchAnalyticsResult> {
    const accessToken = await this.getAccessToken();
    const endpoint = API_ROOT + "/sites/" + encodeURIComponent(SEARCH_CONSOLE_PROPERTY) + "/searchAnalytics/query";
    const body: Record<string, unknown> = {
      startDate: request.startDate,
      endDate: request.endDate,
      type: "web",
      dataState: request.dataState,
      rowLimit: SEARCH_CONSOLE_ROW_LIMIT,
      startRow: 0,
    };
    if (request.dimensions?.length) body.dimensions = request.dimensions;
    if (request.aggregationType) body.aggregationType = request.aggregationType;

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer " + accessToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SearchConsoleProviderError("Google Search Console could not be reached. Try again later.");
    }

    const value = await readJson(response, "query");
    const record = isRecord(value) ? value : {};
    const metadata = isRecord(record.metadata) ? record.metadata : {};
    const firstIncompleteDate = metadata.firstIncompleteDate ?? metadata.first_incomplete_date;
    return {
      rows: normalizeRows(record.rows, request.dimensions),
      firstIncompleteDate: typeof firstIncompleteDate === "string" ? firstIncompleteDate : null,
    };
  }
}

export function createSearchConsoleSetup(options: {
  environment?: SearchConsoleEnvironment;
  fetcher?: typeof fetch;
} = {}): SearchConsoleSetup {
  const environment = options.environment ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const result = readCredentials(environment);
  if (result.state !== "configured") return result;
  return {
    state: "configured",
    provider: new GoogleSearchConsoleProvider(result.credentials, fetcher),
  };
}

export function metricsFromRows(rows: SearchConsoleRow[]): SearchConsoleMetrics | null {
  return normalizeMetrics(rows);
}
