import createPlugin, { type Plugin } from "@extism/extism";
import { hostNamespaces, type HostFunction } from "./host-functions";
import type { ErrorCode, PluginResult } from "./types";

export class PluginError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function unwrapEnvelope<T>(raw: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PluginError("PARSING_ERROR", "plugin returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new PluginError("PARSING_ERROR", "plugin returned a non-object envelope");
  }
  const envelope = parsed as PluginResult<T>;
  if (envelope.ok === true) return envelope.data;
  const code = (envelope as { error?: { code?: ErrorCode } }).error?.code;
  const message = (envelope as { error?: { message?: string } }).error?.message;
  throw new PluginError(
    code ?? "PARSING_ERROR",
    message ?? "plugin returned an error envelope",
  );
}

export class MakiNukiPlugin {
  private instance: Plugin;

  private constructor(instance: Plugin) {
    this.instance = instance;
  }

  static async load(
    wasmBytes: Uint8Array,
    functions: Record<string, HostFunction>,
  ): Promise<MakiNukiPlugin> {
    const instance = await createPlugin(
      { wasm: [{ data: wasmBytes }] },
      { useWasi: true, functions: hostNamespaces(functions) },
    );
    return new MakiNukiPlugin(instance);
  }

  async call(name: string, input: string): Promise<string> {
    const output = await this.instance.call(name, input ?? "");
    if (output === null) throw new PluginError("PARSING_ERROR", `plugin export ${name} returned no output`);
    return output.text();
  }

  async callStatic<T>(name: string): Promise<T> {
    const raw = await this.call(name, "");
    return JSON.parse(raw) as T;
  }

  async callDynamic<T>(name: string, input: string): Promise<T> {
    const raw = await this.call(name, input);
    return unwrapEnvelope<T>(raw);
  }

  async unscramble(bytes: Uint8Array): Promise<Uint8Array> {
    const output = await this.instance.call("unscramble_image", bytes);
    if (output === null) {
      throw new PluginError("UNSCRAMBLE_FAILED", "unscramble_image returned no output");
    }
    return output.bytes();
  }

  async hasExport(name: string): Promise<boolean> {
    const exports = await this.instance.getExports();
    return exports.some((exported) => exported.name === name);
  }

  async close(): Promise<void> {
    await this.instance.close();
  }
}