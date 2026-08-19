import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportManager } from "../src/transport";
import type { HttpRequest } from "../src/types";

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TransportManager.fetch cascade", () => {
  it("prefers direct on success and never cascades on HTTP statuses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(403, "{}"));
    vi.stubGlobal("fetch", fetchMock);

    const transport = new TransportManager({ proxyUrl: "https://proxy.example" });
    const result = await transport.fetch({ url: "https://x.example/a", method: "GET" });

    expect(result.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transport.lastMode).toBe("direct");
  });

  it("cascades direct -> companion -> worker on network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")));
    const transport = new TransportManager({ proxyUrl: "https://proxy.example", clientToken: "t" });

    const fallback = vi.spyOn(transport.companion, "detect").mockResolvedValue(false);
    const relay = vi.spyOn(transport.worker!, "relay").mockResolvedValue({
      status: 200,
      headers: {},
      body: "ok",
    });

    const result = await transport.fetch({ url: "https://x.example/a", method: "GET" });

    expect(result.status).toBe(200);
    expect(relay).toHaveBeenCalledOnce();
    expect(transport.lastMode).toBe("worker");
    fallback.mockRestore();
  });

  it("cascades direct -> companion when companion is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")));
    const transport = new TransportManager({ proxyUrl: "https://proxy.example" });

    vi.spyOn(transport.companion, "detect").mockResolvedValue(true);
    const request = vi.spyOn(transport.companion, "request").mockResolvedValue({
      status: 200,
      headers: {},
      body: "companion",
    });

    const result = await transport.fetch({ url: "https://x.example/a", method: "GET" });

    expect(result.body).toBe("companion");
    expect(request).toHaveBeenCalledOnce();
  });

  it("marks companion unavailable after a failure and falls to worker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const transport = new TransportManager({ proxyUrl: "https://proxy.example" });

    vi.spyOn(transport.companion, "detect").mockResolvedValue(true);
    vi.spyOn(transport.companion, "request").mockRejectedValue(new Error("companion request timed out"));
    const relay = vi.spyOn(transport.worker!, "relay").mockResolvedValue({
      status: 200,
      headers: {},
      body: "worker",
    });

    const result = await transport.fetch({ url: "https://x.example/a", method: "GET" });

    expect(result.body).toBe("worker");
    expect(relay).toHaveBeenCalledOnce();
    expect(transport.companion.isAvailable).toBe(false);
  });

  it("throws when every transport fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const transport = new TransportManager({ proxyUrl: "https://proxy.example" });

    vi.spyOn(transport.companion, "detect").mockResolvedValue(false);
    vi.spyOn(transport.worker!, "relay").mockRejectedValue(new TypeError("proxy unreachable"));

    await expect(
      transport.fetch({ url: "https://x.example/a", method: "GET" }),
    ).rejects.toThrow(/all transports failed/);
  });

  it("honors pin mode and does not fall back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")),
    );
    const transport = new TransportManager({
      proxyUrl: "https://proxy.example",
      direct: true,
      companion: true,
      worker: true,
      pin: "direct",
    });

    await expect(
      transport.fetch({ url: "https://x.example/a", method: "GET" }),
    ).rejects.toThrow(/Failed to fetch/);
  });

  it("pin=companion runs the availability handshake before the first request", async () => {
    const transport = new TransportManager({ pin: "companion" });
    const detect = vi.spyOn(transport.companion, "detect").mockResolvedValue(true);
    const request = vi.spyOn(transport.companion, "request").mockResolvedValue({
      status: 200,
      headers: {},
      body: "companion",
    });

    const mode = await transport.detect();
    expect(mode).toBe("companion");
    expect(detect).toHaveBeenCalledOnce();

    const result = await transport.fetch({ url: "https://x.example/a", method: "GET" });
    expect(result.body).toBe("companion");
    expect(transport.lastMode).toBe("companion");
    expect(detect).toHaveBeenCalledOnce();
  });

  it("pin=companion without the extension rejects after the handshake", async () => {
    const transport = new TransportManager({ pin: "companion" });
    const detect = vi.spyOn(transport.companion, "detect").mockResolvedValue(false);

    await expect(transport.detect()).resolves.toBeNull();
    await expect(
      transport.fetch({ url: "https://x.example/a", method: "GET" }),
    ).rejects.toThrow(/companion extension not connected/);
    expect(detect).toHaveBeenCalledOnce();
  });

  it("pin=worker does not run the companion handshake", async () => {
    const transport = new TransportManager({ pin: "worker", proxyUrl: "https://proxy.example" });
    const detect = vi.spyOn(transport.companion, "detect");

    expect(await transport.detect()).toBe("worker");
    expect(detect).not.toHaveBeenCalled();
  });

  it("cascades on real HTTP-level 4xx? - no: returns the status directly", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(429, "rate limited"));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new TransportManager();

    const result = await transport.fetch({ url: "https://x.example/a", method: "GET" });
    expect(result.status).toBe(429);
  });

  it("passes plugin headers and body to direct fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new TransportManager();

    const request: HttpRequest = {
      url: "https://x.example/a",
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://x.example" },
      body: "{\"q\":1}",
    };
    await transport.fetch(request);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(request.url);
    expect((init.headers as Record<string, string>)["referer"]).toBe("https://x.example");
    expect(init.body).toBe(request.body);
  });
});

describe("TransportManager.fetchImage", () => {
  it("uses companion when available (arraybuffer path)", async () => {
    const transport = new TransportManager({ proxyUrl: "https://proxy.example" });
    vi.spyOn(transport.companion, "detect").mockResolvedValue(true);
    vi.spyOn(transport.companion, "request").mockResolvedValue({
      status: 200,
      headers: { "content-type": "image/png" },
      bodyBase64: "aGVsbG8=",
    });

    const blob = await transport.fetchImage("https://cdn.example/i.png");
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("hello");
  });

  it("uses worker when companion unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["img"]), { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new TransportManager({ proxyUrl: "https://proxy.example", origin: "https://app.example.com" });
    vi.spyOn(transport.companion, "detect").mockResolvedValue(false);

    const blob = await transport.fetchImage("https://cdn.example/i.jpg", { referer: "https://src.example" });

    expect(blob.type).toBe("image/jpeg");
    expect(await blob.text()).toBe("img");
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("proxy.example");
    expect(calledUrl).toContain(encodeURIComponent("https://cdn.example/i.jpg"));
    expect(calledUrl).toContain(encodeURIComponent("https://src.example"));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["origin"]).toBe("https://app.example.com");
  });

  it("falls back to direct fetch when no transport is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["direct"]), { headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new TransportManager({ direct: true, companion: false, worker: false });

    const blob = await transport.fetchImage("https://cdn.example/i.png");
    expect(await blob.text()).toBe("direct");
  });

  it("throws a direct TransportError when the image response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 404 })));
    const transport = new TransportManager({ direct: true, companion: false, worker: false });

    await expect(transport.fetchImage("https://cdn.example/gone.png")).rejects.toThrow(
      /direct image fetch failed: HTTP 404/,
    );
  });
});