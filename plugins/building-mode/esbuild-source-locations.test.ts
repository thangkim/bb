import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPluginApp,
  isPluginAppSourceLocationsStale,
  resolvePluginBuildToolchain,
} from "@bb/plugin-build";
import {
  componentDefinitions,
  sourceLocationBase,
  sourceLocationRuntimeSource,
} from "./esbuild-source-locations.js";

const FLAG = "VITE_BB_SOURCE_LOCATIONS";
const tempDirs: string[] = [];
let previousFlag: string | undefined;

beforeEach(() => {
  previousFlag = process.env[FLAG];
});

afterEach(async () => {
  if (previousFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = previousFlag;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureCheckout() {
  const checkout = await mkdtemp(join(tmpdir(), "bb-building-mode-"));
  tempDirs.push(checkout);
  const hookDir = join(checkout, "plugins", "building-mode");
  const dir = join(checkout, "plugins", "fixture");
  await mkdir(hookDir, { recursive: true });
  await mkdir(join(checkout, "packages", "ui", "src"), { recursive: true });
  await mkdir(dir, { recursive: true });
  await copyFile(
    join(import.meta.dirname, "esbuild-source-locations.ts"),
    join(hookDir, "esbuild-source-locations.ts"),
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-sources-fixture",
      version: "0.0.0",
      bb: {
        name: "Sources fixture",
        description: "Verifies source-location stamping.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        app: "./app.tsx",
      },
    }),
  );
  await writeFile(
    join(dir, "server.ts"),
    "export default function plugin() {}\n",
  );
  await writeFile(
    join(checkout, "packages", "ui", "src", "card.tsx"),
    'export function SharedCard() {\n  return <section data-bb-src="kept">card</section>;\n}\n',
  );
  await writeFile(
    join(dir, "app.tsx"),
    [
      'import { SharedCard } from "../../packages/ui/src/card";',
      "export { SharedCard };",
      "export function SectionHeader() {",
      '  return <div className="row">',
      '    <button type="button">collapse</button>',
      "    <SharedCard />",
      "  </div>;",
      "}",
      "export function SpreadKey(props: object) {",
      '  return <em {...props} key="k" />;',
      "}",
      "",
    ].join("\n"),
  );
  return { checkout, dir };
}

describe("plugin UI source locations", () => {
  it("stamps plugin UI elements and component definitions only when the flag is on", async () => {
    const { dir } = await fixtureCheckout();
    const toolchain = await resolvePluginBuildToolchain(
      join(tmpdir(), "bb-toolchain-unused"),
    );

    process.env[FLAG] = "1";
    const stamped = await buildPluginApp(dir, "0.9.0-test", toolchain);
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(false);
    const created: Array<{ type: unknown; props: Record<string, unknown> }> =
      [];
    const element = (type: unknown, props: Record<string, unknown>) => {
      created.push({ type, props });
      return { type, props };
    };
    Reflect.set(globalThis, "__bbPluginRuntime", {
      jsxRuntime: { jsx: element, jsxs: element, Fragment: Symbol("Fragment") },
      react: {
        createElement: (type: unknown, props: Record<string, unknown>) =>
          element(type, props),
      },
    });
    try {
      const module: Record<string, unknown> = await import(
        pathToFileURL(stamped.jsPath).href
      );
      const { SectionHeader, SharedCard, SpreadKey } = module;
      if (
        typeof SectionHeader !== "function" ||
        typeof SharedCard !== "function" ||
        typeof SpreadKey !== "function"
      ) {
        throw new Error("Expected component exports");
      }
      expect(SectionHeader.name).toBe("SectionHeader");
      expect(Reflect.get(SectionHeader, "__bbSource")).toBe(
        "plugins/fixture/app.tsx:3:8",
      );
      expect(Reflect.get(SharedCard, "__bbSource")).toBe(
        "packages/ui/src/card.tsx:1:8",
      );
      SectionHeader();
      SharedCard();
      SpreadKey({ title: "t" });
    } finally {
      Reflect.deleteProperty(globalThis, "__bbPluginRuntime");
    }
    const sourceOf = (type: unknown) =>
      created.find((entry) => entry.type === type)?.props["data-bb-src"];
    expect(sourceOf("div")).toBe("plugins/fixture/app.tsx:4:10");
    expect(sourceOf("button")).toBe("plugins/fixture/app.tsx:5:5");
    expect(sourceOf("section")).toBe("kept");
    expect(created.find((entry) => entry.type === "em")?.props).toMatchObject({
      title: "t",
    });
    const component = created.find((entry) => typeof entry.type === "function");
    expect(component?.props).not.toHaveProperty("data-bb-src");
    expect(JSON.parse(await readFile(stamped.metaPath, "utf8"))).toHaveProperty(
      "sourceLocations",
      true,
    );

    delete process.env[FLAG];
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(true);
    const plain = await buildPluginApp(dir, "0.9.0-test", toolchain);
    expect(await readFile(plain.jsPath, "utf8")).not.toContain(
      "plugins/fixture",
    );
    expect(
      JSON.parse(await readFile(plain.metaPath, "utf8")),
    ).not.toHaveProperty("sourceLocations");
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(false);
    process.env[FLAG] = "1";
    expect(await isPluginAppSourceLocationsStale(dir)).toBe(true);
  });

  it("finds top-level component declarations with their line and column", () => {
    const code = [
      'import * as React from "react";',
      "export function Picker<T>(props: T) {",
      "  function Nested() {}",
      "}",
      "export const Button = React.forwardRef<HTMLButtonElement, object>((props, ref) => null);",
      "const Row = memo(() => null);",
      "export const Arrow: React.FC = () => null;",
      "export default function Page() {}",
      "const Single = props => null;",
      "const Theme = createContext(null);",
      "const LIMIT = 4;",
      "function formatLabel() {}",
    ].join("\n");

    expect(componentDefinitions(code)).toEqual([
      { name: "Picker", line: 2, column: 8 },
      { name: "Button", line: 5, column: 14 },
      { name: "Row", line: 6, column: 7 },
      { name: "Arrow", line: 7, column: 14 },
      { name: "Page", line: 8, column: 16 },
      { name: "Single", line: 9, column: 7 },
    ]);
  });

  it("maps shared workspace sources relative to the checkout and skips files outside it", async () => {
    const { checkout } = await fixtureCheckout();
    const runtime = sourceLocationRuntimeSource(["plugins", "fixture"]);
    const created: Array<Record<string, unknown>> = [];
    const runtimePath = join(checkout, "runtime.mjs");
    await writeFile(
      runtimePath,
      runtime.replace(
        'import { Fragment, jsx, jsxs } from "react/jsx-runtime";',
        "const Fragment = Symbol(); const jsx = (type, props) => (globalThis.__bbCreated.push(props), props); const jsxs = jsx;",
      ),
    );
    Reflect.set(globalThis, "__bbCreated", created);
    try {
      const { jsxDEV } = await import(pathToFileURL(runtimePath).href);
      const at = (fileName: string) =>
        jsxDEV("span", {}, undefined, false, {
          fileName,
          lineNumber: 2,
          columnNumber: 3,
        });
      expect(at("../../packages/ui/src/card.tsx")).toHaveProperty(
        "data-bb-src",
        "packages/ui/src/card.tsx:2:3",
      );
      expect(at("../../../elsewhere/x.tsx")).not.toHaveProperty("data-bb-src");
      expect(at("node_modules/lib/x.jsx")).not.toHaveProperty("data-bb-src");
      expect(at("./app/list/Row.tsx")).toHaveProperty(
        "data-bb-src",
        "plugins/fixture/app/list/Row.tsx:2:3",
      );
    } finally {
      Reflect.deleteProperty(globalThis, "__bbCreated");
    }
    expect(
      sourceLocationBase(join(checkout, "plugins", "fixture"), checkout),
    ).toEqual(["plugins", "fixture"]);
    expect(sourceLocationBase(tmpdir(), checkout)).toBeNull();
  });
});
