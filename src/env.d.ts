interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown> | null>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface RecommendationKv {
  get(key: string, type: "json"): Promise<{ count: number; reset: number } | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  /** Secret. Fine-grained contents + pull requests on omnifinn/plebflix-tv. Never a request field. */
  GITHUB_TOKEN?: string;
  /** Plain text. The worker only accepts omnifinn/plebflix-tv; any other value refuses to open a pull request. */
  GITHUB_REPO?: string;
  RATE_LIMIT?: RecommendationKv;
  /** Optional secret: salts the stored address hashes on votes and submissions. */
  IP_SALT?: string;
}
