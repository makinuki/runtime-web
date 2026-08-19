import { describe, expect, it, vi } from "vitest";
import { unscramblePageBlob } from "../src/unscramble";
import { TransportManager } from "../src/transport";
import type { MakiNukiPlugin } from "../src/plugin";
import type { PageItem } from "../src/types";

function page(overrides: Partial<PageItem> = {}): PageItem {
  return {
    index: 0,
    url: "https://cdn.example/scr.png",
    headers: { referer: "https://src.example/" },
    isScrambled: true,
    ...overrides,
  };
}

function pluginWith(bytes: Uint8Array, empty = false): MakiNukiPlugin {
  return {
    unscramble: vi.fn().mockResolvedValue(empty ? new Uint8Array(0) : bytes),
  } as unknown as MakiNukiPlugin;
}

describe("unscramblePageBlob", () => {
  it("returns a blob with the unscrambled bytes and image type", async () => {
    const scrambled = new Uint8Array([1, 2, 3]);
    const clean = new Uint8Array([10, 20, 30]);
    const transport = new TransportManager({ direct: true, companion: false, worker: false });
    vi.spyOn(transport, "fetchImage").mockResolvedValue(
      new Blob([scrambled], { type: "image/png" }),
    );
    const plugin = pluginWith(clean);

    const blob = await unscramblePageBlob(plugin, transport, page());

    expect(plugin.unscramble).toHaveBeenCalledWith(scrambled);
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(clean);
  });

  it("throws UNSCRAMBLE_FAILED when the plugin returns an empty buffer", async () => {
    const transport = new TransportManager({ direct: true, companion: false, worker: false });
    vi.spyOn(transport, "fetchImage").mockResolvedValue(
      new Blob([new Uint8Array([1])], { type: "image/png" }),
    );
    const plugin = pluginWith(new Uint8Array(0), true);

    await expect(unscramblePageBlob(plugin, transport, page())).rejects.toMatchObject({
      code: "UNSCRAMBLE_FAILED",
    });
  });

  it("falls back to image/png for non-image content types", async () => {
    const transport = new TransportManager({ direct: true, companion: false, worker: false });
    vi.spyOn(transport, "fetchImage").mockResolvedValue(
      new Blob([new Uint8Array([1, 2])], { type: "application/octet-stream" }),
    );
    const plugin = pluginWith(new Uint8Array([9]));

    const blob = await unscramblePageBlob(plugin, transport, page());

    expect(blob.type).toBe("image/png");
  });

  it("throws when the image fetch fails", async () => {
    const transport = new TransportManager({ direct: true, companion: false, worker: false });
    vi.spyOn(transport, "fetchImage").mockRejectedValue(new Error("network down"));
    const plugin = pluginWith(new Uint8Array([1]));

    await expect(unscramblePageBlob(plugin, transport, page())).rejects.toThrow(/network down/);
  });
});