import { MakiNukiPlugin, PluginError } from "./plugin";
import { TransportManager } from "./transport";
import type { PageItem } from "./types";

export async function unscramblePageBlob(
  plugin: MakiNukiPlugin,
  transport: TransportManager,
  page: PageItem,
): Promise<Blob> {
  const scrambled = await transport.fetchImage(page.url, page.headers);
  const bytes = new Uint8Array(await scrambled.arrayBuffer());
  const clean = await plugin.unscramble(bytes);
  if (clean.byteLength === 0) {
    throw new PluginError("UNSCRAMBLE_FAILED", "unscramble_image returned an empty buffer");
  }
  const type = scrambled.type.startsWith("image/") ? scrambled.type : "image/png";
  return new Blob([clean.slice()], { type });
}