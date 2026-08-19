import { CompanionClient } from "./companion";
import { WorkerClient } from "./worker-client";
import type { HttpRequest, HttpResponse } from "./types";

export type TransportMode = "direct" | "companion" | "worker";

export interface TransportOptions {
  proxyUrl?: string;
  clientToken?: string;
  origin?: string;
  direct?: boolean;
  companion?: boolean;
  worker?: boolean;
  pin?: TransportMode;
}

export interface FetchImageOptions {
  referer?: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export class TransportError extends Error {
  constructor(
    readonly mode: TransportMode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

function headersObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class TransportManager {
  readonly companion: CompanionClient;
  readonly worker: WorkerClient | null;
  private readonly allowDirect: boolean;
  private readonly allowCompanion: boolean;
  private readonly allowWorker: boolean;
  private readonly pin?: TransportMode;
  private companionReady: boolean | null = null;
  private usedMode: TransportMode | null = null;

  constructor(options: TransportOptions = {}) {
    this.companion = new CompanionClient();
    this.worker = options.proxyUrl
      ? new WorkerClient(options.proxyUrl, options.clientToken, options.origin)
      : null;
    this.allowDirect = options.direct ?? true;
    this.allowCompanion = options.companion ?? true;
    this.allowWorker = options.worker ?? true;
    this.pin = options.pin;
  }

  async detect(): Promise<TransportMode | null> {
    if (this.pin === "companion") {
      if (this.companionReady === null) {
        this.companionReady = await this.companion.detect();
      }
      return this.companionReady ? "companion" : null;
    }
    if (this.pin) return this.pin;
    if (this.companionReady === null) {
      this.companionReady = await this.companion.detect();
    }
    if (this.allowCompanion && this.companionReady) return "companion";
    if (this.allowWorker && this.worker) return "worker";
    if (this.allowDirect) return "direct";
    return null;
  }

  get lastMode(): TransportMode | null {
    return this.usedMode;
  }

  private async directFetch(request: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers ?? {},
      body: request.body ?? null,
    });
    return { status: res.status, headers: headersObject(res.headers), body: await res.text() };
  }

  async fetch(request: HttpRequest): Promise<HttpResponse> {
    if (this.pin) {
      if (this.pin === "companion") await this.detect();
      const result = await this.runMode(this.pin, request);
      this.usedMode = this.pin;
      return result;
    }
    const errors: string[] = [];
    const candidates: TransportMode[] = [];
    if (this.allowDirect) candidates.push("direct");
    if (this.allowCompanion) candidates.push("companion");
    if (this.allowWorker && this.worker) candidates.push("worker");
    for (const mode of candidates) {
      try {
        const result = await this.runMode(mode, request);
        this.usedMode = mode;
        return result;
      } catch (err) {
        errors.push(`${mode}: ${(err as Error).message}`);
        if (mode === "companion") this.companionReady = false;
      }
    }
    throw new TransportError(
      "direct",
      `all transports failed (${errors.join("; ") || "no transports enabled"})`,
    );
  }

  private async runMode(mode: TransportMode, request: HttpRequest): Promise<HttpResponse> {
    if (mode === "direct") return this.directFetch(request);
    if (mode === "companion") return this.companion.fetch(request);
    if (mode === "worker" && this.worker) return this.worker.relay(request);
    throw new TransportError(mode, `transport ${mode} is not configured`);
  }

  private async fetchImageCompanion(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Blob> {
    const res = await this.companion.request("GET", url, headers, null, "arraybuffer");
    if (!res.bodyBase64) throw new Error("companion image response has no body");
    const type = res.headers["content-type"] ?? "application/octet-stream";
    return new Blob([base64ToBytes(res.bodyBase64).slice()], { type });
  }

  private async fetchImageWorker(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Blob> {
    if (!this.worker) throw new TransportError("worker", "worker proxy not configured");
    const referer = headers?.referer ?? headers?.Referer;
    const imageUrl = this.worker.imageUrl(url, referer);
    const res = await fetch(
      imageUrl,
      this.worker.origin ? { headers: { origin: this.worker.origin } } : undefined,
    );
    if (!res.ok) throw new TransportError("worker", `worker image fetch failed: HTTP ${res.status}`);
    return res.blob();
  }

  private async fetchImageDirect(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Blob> {
    const res = await fetch(url, { headers: { ...(headers ?? {}), "user-agent": DEFAULT_UA } });
    if (!res.ok) throw new TransportError("direct", `direct image fetch failed: HTTP ${res.status}`);
    return res.blob();
  }

  async fetchImage(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Blob> {
    if (this.pin) {
      const mode = this.pin;
      if (mode === "companion") return this.fetchImageCompanion(url, headers);
      if (mode === "worker") return this.fetchImageWorker(url, headers);
      return this.fetchImageDirect(url, headers);
    }
    if (this.allowCompanion) {
      await this.detect();
      if (this.companionReady) {
        try {
          return await this.fetchImageCompanion(url, headers);
        } catch (err) {
          this.companionReady = false;
        }
      }
    }
    if (this.allowWorker && this.worker) {
      try {
        return await this.fetchImageWorker(url, headers);
      } catch {
        // fall through to direct
      }
    }
    if (this.allowDirect) return this.fetchImageDirect(url, headers);
    throw new TransportError("direct", "no image transport available");
  }
}