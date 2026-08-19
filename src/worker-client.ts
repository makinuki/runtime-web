import type { HttpRequest, HttpResponse } from "./types";

export class WorkerClient {
  readonly proxyUrl: string;

  constructor(
    proxyUrl: string,
    readonly clientToken?: string,
    readonly origin?: string,
  ) {
    const url = new URL(proxyUrl);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/proxy";
    }
    this.proxyUrl = url.toString();
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.clientToken) headers["x-makinuki-client"] = this.clientToken;
    if (this.origin) headers["origin"] = this.origin;
    return headers;
  }

  async relay(request: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(this.proxyUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        url: request.url,
        method: request.method ?? "GET",
        headers: request.headers ?? {},
        body: request.body ?? null,
      }),
    });
    if (!res.ok) {
      throw new Error(`worker proxy rejected request: HTTP ${res.status}`);
    }
    const payload = (await res.json()) as HttpResponse;
    return { status: payload.status, headers: payload.headers, body: payload.body };
  }

  imageUrl(url: string, referer?: string): string {
    const proxy = new URL(this.proxyUrl);
    proxy.searchParams.set("url", url);
    if (referer) proxy.searchParams.set("ref", referer);
    return proxy.toString();
  }
}