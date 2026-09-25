import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildOptions, Plugin } from "esbuild";

export const SOURCE_LOCATIONS_FLAG = "VITE_BB_SOURCE_LOCATIONS";
const SOURCE_LOCATIONS_MODULE = join(
  "plugins",
  "building-mode",
  "esbuild-source-locations.ts",
);

export interface PluginAppSourceLocations {
  namespace: string;
  buildOptions: Pick<BuildOptions, "jsxDev" | "jsxImportSource" | "keepNames">;
  plugin: Plugin;
}

interface SourceLocationsModule {
  pluginAppSourceLocations(
    sourceRoot: string,
    checkoutRoot: string,
  ): PluginAppSourceLocations | null;
}

function findSourceLocationsCheckout(sourceRoot: string): string | null {
  if (process.env[SOURCE_LOCATIONS_FLAG] !== "1") return null;
  for (let dir = resolve(sourceRoot); ; dir = dirname(dir)) {
    if (existsSync(join(dir, SOURCE_LOCATIONS_MODULE))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export async function loadPluginAppSourceLocations(
  sourceRoot: string,
): Promise<PluginAppSourceLocations | null> {
  const checkoutRoot = findSourceLocationsCheckout(sourceRoot);
  if (checkoutRoot === null) return null;
  const module: SourceLocationsModule = await import(
    pathToFileURL(join(checkoutRoot, SOURCE_LOCATIONS_MODULE)).href
  );
  return module.pluginAppSourceLocations(resolve(sourceRoot), checkoutRoot);
}

export async function isPluginAppSourceLocationsStale(
  rootDir: string,
): Promise<boolean> {
  let stamped = false;
  try {
    const meta: unknown = JSON.parse(
      await readFile(join(rootDir, "dist", "app.meta.json"), "utf8"),
    );
    stamped =
      typeof meta === "object" &&
      meta !== null &&
      Reflect.get(meta, "sourceLocations") === true;
  } catch {
    return false;
  }
  return stamped !== ((await loadPluginAppSourceLocations(rootDir)) !== null);
}
