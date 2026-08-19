import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHostFunctions, hostNamespaces, type HostFunction } from "../src/host-functions";
import { MemoryStorage } from "../src/storage";
import { TransportError, type TransportManager } from "../src/transport";
import type { HttpRequest } from "../src/types";

interface HostContext {
  read: (input: bigint) => { text: () => string } | null;
  store: (payload: string) => bigint;
  seed: (input: bigint, text: string) => void;
  stored: (offset: bigint) => string | null;
}

function makeContext(): HostContext {
  const inputs = new Map<bigint, string>();
  const stored = new Map<bigint, string>();
  let next = 1000n;
  return {
    read: (input: bigint) => {
      const text = inputs.get(input);
      return text === undefined ? null : { text: () => text };
    },
    store: (payload: string) => {
      const offset = next++;
      stored.set(offset, payload);
      return offset;
    },
    seed: (input: bigint, text: string) => {
      inputs.set(input, text);
    },
    stored: (offset: bigint) => stored.get(offset) ?? null,
  };
}

function fakeTransport(fetchImpl: ReturnType<typeof vi.fn>): TransportManager {
  return { fetch: fetchImpl } as unknown as TransportManager;
}

type HostFnName =
  | "makinuki_fetch"
  | "makinuki_storage_get"
  | "makinuki_storage_set"
  | "makinuki_log";

function makeFunctions(
  transport: TransportManager,
  storage: MemoryStorage,
  sourceId: string,
): Record<HostFnName, HostFunction> {
  return makeHostFunctions({ transport, storage, sourceId }) as Record<HostFnName, HostFunction>;
}

const HTTP_REQUEST: HttpRequest = { url: "https://x.example/", method: "GET" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeHostFunctions", () => {
  it("makinuki_fetch relays the parsed request through the transport", async () => {
    const fetcher = vi.fn();
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(fetcher), storage, "mangadex");
    const ctx = makeContext();
    ctx.seed(0n, '{"url":"https://api.mangadex.org/manga?limit=1","method":"GET"}');
    const response = { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
    fetcher.mockResolvedValue(response);

    const offset = await functions.makinuki_fetch(ctx as never, 0n);

    expect(fetcher).toHaveBeenCalledWith({
      url: "https://api.mangadex.org/manga?limit=1",
      method: "GET",
    });
    expect(ctx.stored(offset)).toBe(JSON.stringify(response));
  });

  it("makinuki_fetch rethrows transport errors as-is", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      new TransportError("worker", "worker proxy rejected request: HTTP 403"),
    );
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(fetcher), storage, "mangadex");
    const ctx = makeContext();
    ctx.seed(0n, JSON.stringify(HTTP_REQUEST));

    await expect(functions.makinuki_fetch(ctx as never, 0n)).rejects.toThrow(/HTTP 403/);
  });

  it("makinuki_fetch throws on missing input", async () => {
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "mangadex");
    const ctx = makeContext();

    await expect(functions.makinuki_fetch(ctx as never, 0n)).rejects.toThrow(/missing input/);
  });

  it("makinuki_storage_get returns 0n for a missing key", async () => {
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "mangadex");
    const ctx = makeContext();
    ctx.seed(0n, '"token"');

    expect(await functions.makinuki_storage_get(ctx as never, 0n)).toBe(0n);
  });

  it("namespaces storage keys per source", async () => {
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "mangadex");
    const ctx = makeContext();
    ctx.seed(0n, JSON.stringify({ key: "token", value: "" }));

    await functions.makinuki_storage_set(ctx as never, 0n);

    expect(await storage.get("mangadex:token")).toBe("");
    expect(await storage.get("token")).toBeNull();
  });

  it("makinuki_storage_set stores the value and get returns it after set", async () => {
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "src");
    const ctx = makeContext();

    ctx.seed(0n, JSON.stringify({ key: "k", value: "abc" }));
    await functions.makinuki_storage_set(ctx as never, 0n);

    ctx.seed(0n, '"k"');
    const offset = await functions.makinuki_storage_get(ctx as never, 0n);

    expect(offset).not.toBe(0n);
    expect(ctx.stored(offset)).toBe("abc");
  });

  it("makinuki_storage_set enforces the 64 KB value cap", async () => {
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "src");
    const ctx = makeContext();
    ctx.seed(0n, JSON.stringify({ key: "k", value: "x".repeat(64 * 1024 + 1) }));

    await expect(functions.makinuki_storage_set(ctx as never, 0n)).rejects.toThrow(/64 KB/);
  });

  it("makinuki_log returns 0n and routes by level", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "src");
    const ctx = makeContext();
    ctx.seed(0n, JSON.stringify({ level: "info", message: "hello" }));

    expect(await functions.makinuki_log(ctx as never, 0n)).toBe(0n);
    expect(info).toHaveBeenCalledWith("[makinuki:src] hello");
  });
});

describe("hostNamespaces", () => {
  it("registers functions under both namespaces", () => {
    const storage = new MemoryStorage();
    const functions = makeFunctions(fakeTransport(vi.fn()), storage, "src");
    const namespaces = hostNamespaces(functions);
    const extism = namespaces["extism:host/makinuki"]!;
    const plain = namespaces.makinuki!;

    expect(Object.keys(namespaces)).toEqual(["extism:host/makinuki", "makinuki"]);
    expect(extism.makinuki_fetch).toBe(functions.makinuki_fetch);
    expect(plain.makinuki_storage_get).toBe(functions.makinuki_storage_get);
    expect(Object.keys(plain).sort()).toEqual(
      ["makinuki_fetch", "makinuki_log", "makinuki_storage_get", "makinuki_storage_set"],
    );
  });
});