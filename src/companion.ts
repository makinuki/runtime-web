import type { HttpRequest, HttpResponse } from "./types";

const PAGE_SOURCE = "makinuki-page";
const EXT_SOURCE = "makinuki-extension";
const CHANNEL = "makinuki:request";
const PING = "makinuki:ping";
const PONG = "makinuki:pong";
const REQUEST_TIMEOUT = 60_000;
const PING_TIMEOUT = 500;

export interface CompanionResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
}

interface PendingEntry {
  resolve: (value: CompanionResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export class CompanionClient {
  private available = false;
  private pending = new Map<string, PendingEntry>();
  private listenersAttached = false;
  private pingResolvers: Array<() => void> = [];

  private attachListener(): void {
    if (this.listenersAttached || typeof window === "undefined") return;
    this.listenersAttached = true;
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || typeof data !== "object" || data.source !== EXT_SOURCE) return;
      if (data.type === PONG) {
        this.available = true;
        const resolvers = this.pingResolvers;
        this.pingResolvers = [];
        for (const resolve of resolvers) resolve();
        return;
      }
      const response = data as {
        id?: string;
        error?: string;
        status?: number;
        headers?: Record<string, string>;
        body?: string;
        bodyBase64?: string;
      };
      if (data.type !== "makinuki:response" || !response.id) return;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(response.id);
      if (response.status === 0) {
        entry.reject(
          new Error(response.error ?? "companion request failed (status 0)"),
        );
        return;
      }
      entry.resolve({
        status: response.status ?? 0,
        headers: response.headers ?? {},
        body: response.body,
        bodyBase64: response.bodyBase64,
      });
    });
  }

  async detect(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    this.attachListener();
    if (this.available) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.pingResolvers.indexOf(settle);
        if (index >= 0) this.pingResolvers.splice(index, 1);
        resolve(false);
      }, PING_TIMEOUT);
      const settle = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.pingResolvers.push(settle);
      window.postMessage({ source: PAGE_SOURCE, type: PING }, "*");
    });
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async request(
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: string | null,
    responseType: "text" | "arraybuffer" = "text",
  ): Promise<CompanionResponse> {
    if (!this.available) throw new Error("companion extension not connected");
    if (!isHttpUrl(url)) throw new Error("companion request url must be http(s)");
    return new Promise<CompanionResponse>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("companion request timed out"));
      }, REQUEST_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      window.postMessage(
        { source: PAGE_SOURCE, type: CHANNEL, id, method, url, headers, body, responseType },
        "*",
      );
    });
  }

  async fetch(request: HttpRequest): Promise<HttpResponse> {
    const res = await this.request(
      request.method ?? "GET",
      request.url,
      request.headers,
      request.body ?? null,
      "text",
    );
    return { status: res.status, headers: res.headers, body: res.body ?? "" };
  }
}