import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "../src/worker-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("WorkerClient.relay", () => {
  it("appends /proxy when the proxy url has no path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, '{"status":200,"headers":{},"body":""}'));
    vi.stubGlobal("fetch", fetchMock);

    const client = new WorkerClient("https://proxy.example");

    await client.relay({ url: "https://api.mangadex.org/manga?limit=1", method: "GET" });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proxy.example/proxy");
  });

  it("posts the request as a JSON payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, '{"status":404,"headers":{},"body":"nope"}'));
    vi.stubGlobal("fetch", fetchMock);

    const client = new WorkerClient("https://proxy.example/proxy");
    await client.relay({
      url: "https://api.mangadex.org/manga?limit=1",
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://mangadex.org" },
      body: '{"q":1}',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proxy.example/proxy");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({
      url: "https://api.mangadex.org/manga?limit=1",
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://mangadex.org" },
      body: '{"q":1}',
    });
  });

  it("defaults method to GET and body to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, '{"status":200,"headers":{},"body":""}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WorkerClient("https://proxy.example/proxy", "secret-token");

    await client.relay({ url: "https://x.example/", method: "GET" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const payload = JSON.parse(init.body as string);
    expect(payload.method).toBe("GET");
    expect(payload.body).toBeNull();
    expect((init.headers as Record<string, string>)["x-makinuki-client"]).toBe("secret-token");
  });

  it("omits the client token when none is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, '{"status":200,"headers":{},"body":""}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WorkerClient("https://proxy.example/proxy");

    await client.relay({ url: "https://x.example/", method: "GET" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-makinuki-client"]).toBeUndefined();
  });

  it("sends an origin header when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, '{"status":200,"headers":{},"body":""}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WorkerClient("https://proxy.example/proxy", "t", "https://app.example.com");

    await client.relay({ url: "https://x.example/", method: "GET" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["origin"]).toBe("https://app.example.com");
  });

  it("relays upstream status, headers and body", async () => {
    const upstream = { status: 403, headers: { "x-ratelimit": "60" }, body: "blocked" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify(upstream))));
    const client = new WorkerClient("https://proxy.example/proxy");

    const result = await client.relay({ url: "https://x.example/", method: "GET" });

    expect(result).toEqual(upstream);
  });

  it("throws when the worker rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, "{}")));
    const client = new WorkerClient("https://proxy.example/proxy");

    await expect(client.relay({ url: "https://evil.example/", method: "GET" })).rejects.toThrow(/HTTP 403/);
  });

  it("throws when the worker response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("html", { status: 200 })));
    const client = new WorkerClient("https://proxy.example/proxy");

    await expect(client.relay({ url: "https://x.example/", method: "GET" })).rejects.toThrow(SyntaxError);
  });
});

describe("WorkerClient.imageUrl", () => {
  it("encodes url and referer query params", () => {
    const client = new WorkerClient("https://proxy.example/proxy");
    const url = client.imageUrl(
      "https://cmdxd98sb0x3yprd.mangadex.network/data/1.jpg",
      "https://mangadex.org/chapter/1",
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://proxy.example/proxy");
    expect(parsed.searchParams.get("url")).toBe("https://cmdxd98sb0x3yprd.mangadex.network/data/1.jpg");
    expect(parsed.searchParams.get("ref")).toBe("https://mangadex.org/chapter/1");
  });

  it("omits ref when absent and keeps existing params", () => {
    const client = new WorkerClient("https://proxy.example/proxy?token=abc");
    const url = client.imageUrl("https://cdn.example/i.png");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("url")).toBe("https://cdn.example/i.png");
    expect(parsed.searchParams.get("ref")).toBeNull();
    expect(parsed.searchParams.get("token")).toBe("abc");
  });
});