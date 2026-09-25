import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPluginApp } from "./build-plugin-app.js";
import {
  isPluginAppSourceLocationsStale,
  SOURCE_LOCATIONS_FLAG,
} from "./source-locations-hook.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const RECORDER = "__bbSourceLocationsHookCalls";
const tempDirs: string[] = [];
let previousFlag: string | undefined;

beforeEach(() => {
  previousFlag = process.env[SOURCE_LOCATIONS_FLAG];
  Reflect.set(globalThis, RECORDER, []);
});

afterEach(async () => {
  if (previousFlag === undefined) delete process.env[SOURCE_LOCATIONS_FLAG];
  else process.env[SOURCE_LOCATIONS_FLAG] = previousFlag;
  Reflect.deleteProperty(globalThis, RECORDER);
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function checkoutWithHook(hookSource: string) {
  const checkout = await mkdtemp(join(tmpdir(), "bb-source-hook-"));
  tempDirs.push(checkout);
  await mkdir(join(checkout, "plugins", "building-mode"), { recursive: true });
  await writeFile(
    join(checkout, "plugins", "building-mode", "esbuild-source-locations.ts"),
    hookSource,
  );
  const plugin = async (name: string) => {
    const dir = join(checkout, "plugins", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-hook-fixture",
        version: "0.0.0",
        bb: {
          name: "Hook fixture",
          description: "Verifies the source-location hook.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          app: "./app.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "app.ts"),
      "export function FixturePanel() { return 1; }\n",
    );
    return dir;
  };
  return { checkout, plugin };
}

const RECORDING_HOOK = `export function pluginAppSourceLocations(sourceRoot, checkoutRoot) {
  globalThis.${RECORDER}.push({ sourceRoot, checkoutRoot });
  return {
    namespace: "bb-test-stamp",
    buildOptions: { keepNames: true },
    plugin: { name: "bb-test-stamp", setup() {} },
  };
}
`;

const toolchain = () =>
  resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));

describe("plugin app source-location hook", () => {
  it("leaves builds untouched while the flag is off, even when the hook would fail", async () => {
    const { plugin } = await checkoutWithHook(
      'throw new Error("hook must not load");\n',
    );
    const dir = await plugin("fixture");
    delete process.env[SOURCE_LOCATIONS_FLAG];

    const result = await buildPluginApp(dir, "0.9.0-test", await toolchain());

    expect(
      JSON.parse(await readFile(result.metaPath, "utf8")),
    ).not.toHaveProperty("sourceLocations");
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(false);
  });

  it("applies the checkout's hook for the plugin source root and marks the bundle", async () => {
    const { checkout, plugin } = await checkoutWithHook(RECORDING_HOOK);
    const source = await plugin("fixture");
    const stage = await plugin(".bundled-stage-abc");
    process.env[SOURCE_LOCATIONS_FLAG] = "1";

    const result = await buildPluginApp(
      stage,
      "0.9.0-test",
      await toolchain(),
      {
        minify: true,
        sourceRoot: source,
      },
    );

    expect(Reflect.get(globalThis, RECORDER)).toEqual([
      { sourceRoot: source, checkoutRoot: checkout },
    ]);
    expect(await readFile(result.jsPath, "utf8")).toContain('"FixturePanel"');
    expect(JSON.parse(await readFile(result.metaPath, "utf8"))).toHaveProperty(
      "sourceLocations",
      true,
    );
  });

  it("reports a bundle whose stamping no longer matches the flag as stale", async () => {
    const { plugin } = await checkoutWithHook(RECORDING_HOOK);
    const dir = await plugin("fixture");
    delete process.env[SOURCE_LOCATIONS_FLAG];
    await buildPluginApp(dir, "0.9.0-test", await toolchain());

    process.env[SOURCE_LOCATIONS_FLAG] = "1";
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(true);
    await buildPluginApp(dir, "0.9.0-test", await toolchain());
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(false);
    delete process.env[SOURCE_LOCATIONS_FLAG];
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(true);
  });

  it("surfaces hook load errors instead of building unstamped", async () => {
    const { plugin } = await checkoutWithHook(
      'throw new Error("broken source-location hook");\n',
    );
    const dir = await plugin("fixture");
    process.env[SOURCE_LOCATIONS_FLAG] = "1";

    await expect(
      buildPluginApp(dir, "0.9.0-test", await toolchain()),
    ).rejects.toThrow("broken source-location hook");
  });
});
