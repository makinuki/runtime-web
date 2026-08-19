export type ErrorCode =
  | "CLOUDFLARE_BLOCKED"
  | "RATE_LIMITED"
  | "NETWORK_TIMEOUT"
  | "SESSION_REQUIRED"
  | "AUTH_EXPIRED"
  | "NOT_FOUND"
  | "SOURCE_OFFLINE"
  | "PARSING_ERROR"
  | "UNSUPPORTED_MEDIA"
  | "MEMORY_LIMIT_EXCEEDED"
  | "UNSCRAMBLE_FAILED";

export interface SourceMetadata {
  id: string;
  name: string;
  version: string;
  abiVersion: number;
  lang: string;
  baseUrl: string;
  iconUrl: string;
  nsfw: boolean;
  allowedHosts?: string[];
}

export interface SearchQuery {
  query: string;
  page: number;
  filters: Record<string, unknown>;
}

export interface PageResult<T> {
  page: number;
  hasNextPage: boolean;
  items: T[];
}

export interface MangaItem {
  id: string;
  title: string;
  coverUrl: string;
  latestChapter?: string;
  url?: string;
}

export interface ChapterItem {
  id: string;
  number: number | null;
  language?: string;
  title?: string;
  uploadedAt?: number;
  scanlator?: string;
  url?: string;
}

export interface MangaDetails {
  id: string;
  title: string;
  altTitles?: string[];
  description?: string;
  authors?: string[];
  artists?: string[];
  genres?: string[];
  status: "Ongoing" | "Completed" | "Hiatus" | "Cancelled" | "Unknown";
  coverUrl: string;
  chapters: ChapterItem[];
}

export interface ScrambleInfo {
  layout: "slice" | "shift" | "custom";
  rows: number;
  cols: number;
  tileW: number;
  tileH: number;
  order: number[];
}

export interface PageItem {
  index: number;
  url: string;
  headers?: Record<string, string>;
  isScrambled: boolean;
  metadata?: ScrambleInfo;
}

export type FilterSchema =
  | SelectFilter
  | TriStateFilter
  | CheckboxFilter
  | TextFilter;

interface BaseFilter {
  id: string;
  title: string;
}

export interface SelectFilter extends BaseFilter {
  type: "select";
  options: Array<{ label: string; value: string }>;
  default: string;
}

export interface TriStateFilter extends BaseFilter {
  type: "tri_state";
  options: Array<{ label: string; value: string }>;
  default?: Record<string, "+" | "-">;
}

export interface CheckboxFilter extends BaseFilter {
  type: "checkbox";
  default: boolean;
}

export interface TextFilter extends BaseFilter {
  type: "text";
  placeholder?: string;
  default?: string;
}

export type PluginResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  abiVersion: number;
  lang: string;
  baseUrl: string;
  iconUrl: string;
  nsfw: boolean;
  wasmUrl: string;
  sha256: string;
  minRuntimeVersion: string;
  allowedHosts?: string[];
}

export interface RegistryIndex {
  version: number;
  updatedAt: number;
  sources: RegistryEntry[];
}