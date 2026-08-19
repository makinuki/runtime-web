import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionClient, type CompanionResponse } from "../src/companion";

type MessageHandler = (event: { source: unknown; data: unknown }) => void;

interface FakeWindow {
  addEventListener: (type: string, handler: MessageHandler) => void;
  postMessage: (data: unknown, target: string) => void;
  deliver: (data: unknown) => void;
  readonly posted: unknown[];
}

function makeWindow(): FakeWindow {
  let handler: MessageHandler | null = null;
  const posted: unknown[] = [];
  return {
    addEventListener: (_type: string, h: MessageHandler) => {
      handler = h;
    },
    postMessage: (data: unknown) => {
      posted.push(data);
    },
    deliver: (data: unknown) => {
      handler?.({ source: window, data });
    },
    get posted() {
      return posted;
    },
  } as FakeWindow & { posted: unknown[] };
}

const EXT_SOURCE = "makinuki-extension";
const PAGE_SOURCE = "makinuki-page";

function pongMessage() {
  return { source: EXT_SOURCE, type: "makinuki:pong" };
}

function responseMessage(patch: Partial<CompanionResponse & { id: string; error?: string }> = {}) {
  return {
    source: EXT_SOURCE,
    type: "makinuki:response",
    id: "resp-1",
    status: 200,
    headers: { "content-type": "application/json" },
    body: "ok",
    ...patch,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CompanionClient.detect", () => {
  it("returns false outside the browser", async () => {
    const client = new CompanionClient();
    expect(await client.detect()).toBe(false);
  });

  it("resolves true when the extension pongs", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();

    const detection = client.detect();
    expect(win.posted[0]).toEqual({ source: PAGE_SOURCE, type: "makinuki:ping" });
    win.deliver(pongMessage());

    expect(await detection).toBe(true);
    expect(client.isAvailable).toBe(true);
  });

  it("resolves false on timeout without a pong", async () => {
    vi.useFakeTimers();
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();

    const detection = client.detect();
    const pending = vi.advanceTimersByTimeAsync(501);

    expect(await detection).toBe(false);
    await pending;
    expect(client.isAvailable).toBe(false);
  });

  it("resolves true immediately once already available", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();

    const first = client.detect();
    win.deliver(pongMessage());
    await first;
    expect(await client.detect()).toBe(true);
  });
});

describe("CompanionClient.request", () => {
  it("throws when the extension is not connected", async () => {
    const client = new CompanionClient();
    await expect(client.request("GET", "https://x.example/")).rejects.toThrow(/not connected/);
  });

  it("throws on non-http urls even when connected", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();
    const detection = client.detect();
    win.deliver(pongMessage());
    await detection;

    await expect(client.request("GET", "file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
  });

  it("posts a well-formed request message and resolves on response", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();
    const detection = client.detect();
    win.deliver(pongMessage());
    await detection;

    const pending = client.request(
      "POST",
      "https://api.mangadex.org/auth/login",
      { "content-type": "application/json" },
      '{"x":1}',
      "text",
    );

    const message = win.posted[1] as Record<string, unknown>;
    expect(message).toMatchObject({
      source: PAGE_SOURCE,
      type: "makinuki:request",
      method: "POST",
      url: "https://api.mangadex.org/auth/login",
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
      responseType: "text",
    });
    expect(typeof message.id).toBe("string");

    win.deliver(responseMessage({ id: message.id as string }));
    expect(await pending).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: "ok",
    });
  });

  it("rejects when the response carries status 0", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();
    const detection = client.detect();
    win.deliver(pongMessage());
    await detection;

    const pending = client.request("GET", "https://x.example/");
    const message = win.posted[1] as { id: string };
    win.deliver(responseMessage({ id: message.id, status: 0, error: "fetch failed" }));

    await expect(pending).rejects.toThrow(/fetch failed/);
  });

  it("ignores messages from other sources and unknown ids", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();
    const detection = client.detect();
    win.deliver(pongMessage());
    await detection;

    const pending = client.request("GET", "https://x.example/");
    win.deliver({ source: "someone-else", type: "makinuki:response", status: 500 });
    win.deliver(responseMessage({ id: "wrong-id" }));
    win.deliver({ source: EXT_SOURCE, type: "makinuki:unrelated" });
    expect(win.posted).toHaveLength(2);

    const message = win.posted[1] as { id: string };
    win.deliver(responseMessage({ id: message.id, status: 204 }));
    expect(await pending).toMatchObject({ status: 204 });
  });

  it("rejects on request timeout", async () => {
    vi.useFakeTimers();
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();
    const detection = client.detect();
    win.deliver(pongMessage());
    await detection;

    const pending = client.request("GET", "https://x.example/");
    const rejection = pending.catch((err: Error) => err.message);
    vi.advanceTimersByTime(60_001);

    expect(await rejection).toBe("companion request timed out");
  });
});

describe("CompanionClient.fetch", () => {
  it("maps a companion response to HttpResponse with empty body fallback", async () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const client = new CompanionClient();
    const detection = client.detect();
    win.deliver(pongMessage());
    await detection;

    const pending = client.fetch({ url: "https://x.example/", method: "GET" });
    const message = win.posted[1] as { id: string };
    win.deliver(responseMessage({ id: message.id, status: 302, headers: { location: "https://x.example/b" }, body: undefined }));

    expect(await pending).toEqual({
      status: 302,
      headers: { location: "https://x.example/b" },
      body: "",
    });
  });
});