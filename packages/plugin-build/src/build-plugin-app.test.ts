import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import {
  buildPluginApp,
  sharedUiRuntimeModuleFor,
  runtimeShimPlugin,
  RUNTIME_SLOT_BY_SPECIFIER,
} from "./build-plugin-app.js";
import { RUNTIME_EXPORT_MANIFEST } from "./generated/runtime-export-manifest.generated.js";
import {
  componentDefinitions,
  sourceLocationBase,
  sourceLocationRuntimeSource,
} from "./source-locations.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

describe("plugin app runtime shim", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("re-derives @get-bb/plugin-sdk/app exports for every rebuild", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-shim-"));
    tempDirs.push(dir);
    const facadePath = join(dir, "app-facade.mjs");
    const facadeUrl = pathToFileURL(facadePath).href;

    async function bundle(importName: string): Promise<string> {
      const result = await build({
        stdin: {
          contents: `import { ${importName} } from "@get-bb/plugin-sdk/app"; export { ${importName} };`,
          loader: "js",
          resolveDir: dir,
        },
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        logLevel: "silent",
        plugins: [runtimeShimPlugin(facadeUrl)],
      });
      return result.outputFiles[0]?.text ?? "";
    }

    await writeFile(facadePath, "export const first = 1;\n");
    await expect(bundle("first")).resolves.toContain("first");

    await writeFile(
      facadePath,
      "export const first = 1; export const addedLater = 2;\n",
    );
    await expect(bundle("addedLater")).resolves.toContain("addedLater");
  });

  it("has an export-manifest entry for every non-SDK slot", () => {
    for (const specifier of Object.keys(RUNTIME_SLOT_BY_SPECIFIER)) {
      if (specifier.endsWith("/plugin-sdk/app")) continue;
      expect(RUNTIME_EXPORT_MANIFEST[specifier], specifier).toBeDefined();
    }
  });

  it("routes host-resident libraries to runtime slots and forwards real default exports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-libs-"));
    tempDirs.push(dir);
    const result = await build({
      stdin: {
        contents: [
          `import clsx from "clsx";`,
          `import { twMerge } from "tailwind-merge";`,
          `import { cva } from "class-variance-authority";`,
          `import { Icon } from "@bb/shared-ui/icon";`,
          `import { useQuestionFormHost } from "@bb/shared-ui/question-form-host";`,
          `export { clsx, twMerge, cva, Icon, useQuestionFormHost };`,
        ].join("\n"),
        loader: "js",
        resolveDir: dir,
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin()],
    });
    const js = result.outputFiles[0]?.text ?? "";
    for (const slot of [
      "clsx",
      "tailwindMerge",
      "classVarianceAuthority",
      "sharedUiIcon",
      "questionFormHost",
    ]) {
      expect(js).toMatch(new RegExp(`runtime\\d*\\.${slot}\\b`));
    }

    const clsxFn = () => "clsx";
    const twMergeFn = () => "merged";
    const cvaFn = () => "cva";
    const IconComponent = () => null;
    const useQuestionFormHost = () => null;
    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
      clsx: { default: clsxFn, clsx: clsxFn },
      tailwindMerge: { twMerge: twMergeFn },
      classVarianceAuthority: { cva: cvaFn },
      sharedUiIcon: { Icon: IconComponent, ICON_NAMES: [] },
      questionFormHost: { useQuestionFormHost },
    };
    try {
      const bundlePath = join(dir, "bundle.mjs");
      await writeFile(bundlePath, js);
      const loaded = (await import(pathToFileURL(bundlePath).href)) as Record<
        string,
        unknown
      >;
      expect(loaded.clsx).toBe(clsxFn);
      expect(loaded.twMerge).toBe(twMergeFn);
      expect(loaded.cva).toBe(cvaFn);
      expect(loaded.Icon).toBe(IconComponent);
      expect(loaded.useQuestionFormHost).toBe(useQuestionFormHost);
    } finally {
      delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
    }
  });

  it("shims shared-ui's relative ./icon import but bundles a plugin's own icon module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-icon-rel-"));
    tempDirs.push(dir);
    const sharedUiDir = join(dir, "node_modules", "@bb", "shared-ui");
    const files: Record<string, string> = {
      [join(sharedUiDir, "package.json")]: JSON.stringify({
        name: "@bb/shared-ui",
        type: "module",
        exports: {
          "./empty-state": "./src/components/ui/empty-state.tsx",
          "./icon": "./src/components/ui/icon.tsx",
        },
      }),
      [join(sharedUiDir, "src", "components", "ui", "icon.tsx")]:
        `export function Icon() { return "shared-ui-hugeicons-map"; }\n`,
      [join(sharedUiDir, "src", "components", "ui", "empty-state.tsx")]:
        `import { Icon } from "./icon";\nexport function EmptyState() { return Icon; }\n`,
      [join(dir, "components", "ui", "icon.tsx")]:
        `export function Icon() { return "plugin-owned-icon-map"; }\n`,
      [join(dir, "components", "ui", "button.tsx")]:
        `import { Icon } from "./icon";\nexport function Button() { return Icon; }\n`,
      [join(dir, "app.tsx")]:
        `import { EmptyState } from "@bb/shared-ui/empty-state";\nimport { Button } from "./components/ui/button";\nexport { EmptyState, Button };\n`,
    };
    for (const [filePath, contents] of Object.entries(files)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }
    const result = await build({
      entryPoints: [join(dir, "app.tsx")],
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin()],
    });
    const js = result.outputFiles[0]?.text ?? "";
    expect(js).not.toContain("shared-ui-hugeicons-map");
    expect(js).toMatch(/runtime\d*\.sharedUiIcon\b/);
    expect(js).toContain("plugin-owned-icon-map");
  });

  it("shims shared-ui's relative ./question-form-host import to the host's context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-question-host-rel-"));
    tempDirs.push(dir);
    const sharedUiDir = join(dir, "node_modules", "@bb", "shared-ui");
    const files: Record<string, string> = {
      [join(sharedUiDir, "package.json")]: JSON.stringify({
        name: "@bb/shared-ui",
        type: "module",
        exports: {
          "./question-form": "./src/components/ui/question-form.tsx",
        },
      }),
      [join(sharedUiDir, "src", "components", "ui", "question-form-host.tsx")]:
        `export function useQuestionFormHost() { return "bundled-default-context"; }\n`,
      [join(sharedUiDir, "src", "components", "ui", "question-form.tsx")]:
        `import { useQuestionFormHost } from "./question-form-host";\nexport function QuestionForm() { return useQuestionFormHost(); }\n`,
      [join(dir, "app.tsx")]:
        `import { QuestionForm } from "@bb/shared-ui/question-form";\nexport { QuestionForm };\n`,
    };
    for (const [filePath, contents] of Object.entries(files)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }
    const result = await build({
      entryPoints: [join(dir, "app.tsx")],
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin()],
    });
    const js = result.outputFiles[0]?.text ?? "";
    expect(js).not.toContain("bundled-default-context");
    expect(js).toMatch(/runtime\d*\.questionFormHost\b/);
  });

  it("recognizes only shared-ui's own host-backed modules as relative imports", () => {
    const sharedUiComponent =
      "/repo/packages/shared-ui/src/components/ui/empty-state.tsx";
    expect(sharedUiRuntimeModuleFor("./icon", sharedUiComponent)).toBe(
      "@bb/shared-ui/icon",
    );
    expect(sharedUiRuntimeModuleFor("./icon.js", sharedUiComponent)).toBe(
      "@bb/shared-ui/icon",
    );
    expect(
      sharedUiRuntimeModuleFor(
        "../components/ui/icon",
        "/repo/packages/shared-ui/src/hooks/use-thing.ts",
      ),
    ).toBe("@bb/shared-ui/icon");
    expect(
      sharedUiRuntimeModuleFor(
        "./question-form-host",
        "/repo/packages/shared-ui/src/components/ui/question-form.tsx",
      ),
    ).toBe("@bb/shared-ui/question-form-host");
    expect(sharedUiRuntimeModuleFor("./button", sharedUiComponent)).toBe(null);
    expect(
      sharedUiRuntimeModuleFor(
        "./icon",
        "/plugins/acme/components/ui/button.tsx",
      ),
    ).toBe(null);
    expect(
      sharedUiRuntimeModuleFor(
        "./question-form-host",
        "/plugins/acme/components/ui/question-form.tsx",
      ),
    ).toBe(null);
  });

  it("scopes Tailwind utilities while preserving imported CSS unscoped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-css-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-css-fixture",
        version: "0.0.0",
        bb: {
          name: "CSS fixture",
          description: "Verifies plugin CSS emission.",
          branding: { icon: "Paintbrush" },
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
      'import "./app.css";\n' +
        'export const utilityClass = "flex-col";\n' +
        'export const siblingClass = "[&~*]:hidden";\n',
    );
    await writeFile(
      join(dir, "app.css"),
      ".bb71-authored-decoration { text-decoration: underline; }\n",
    );

    const result = await buildPluginApp(
      dir,
      "0.9.0-test",
      await testToolchain(),
    );
    const css = await readFile(result.cssPath, "utf8");

    const scope =
      ":where([data-bb-plugin=css-fixture],[data-bb-plugin-root]:not([data-bb-plugin]))";
    expect(css).toContain(`${scope} .flex-col`);
    expect(css).toContain(`${scope}.flex-col`);
    const sibling = String.raw`.\[\&\~\*\]\:hidden`;
    expect(css).toContain(`${scope} ${sibling}`);
    expect(css).not.toContain(`${scope}${sibling}`);
    expect(css).not.toContain("@scope");
    expect(css).not.toContain(`${scope} .bb71-authored-decoration`);
    expect(css).toContain(".bb71-authored-decoration");
  });

  it("minifies app.js and app.css unless the caller asks for readable output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-minify-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-minify-fixture",
        version: "0.0.0",
        bb: {
          name: "Minify fixture",
          description: "Verifies artifact minification.",
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
      [
        "/*! fixture-legal-comment */",
        'import "./app.css";',
        "function computeFixtureLabel(fixtureInputValue: string) {",
        '  const fixtureLocalResult = [fixtureInputValue, "flex-col"].join(" ");',
        "  return fixtureLocalResult;",
        "}",
        'export default computeFixtureLabel("bb-minify");',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(dir, "app.css"),
      ".bb71-authored {\n  color: hotpink;\n  margin: 0px;\n}\n",
    );
    const toolchain = await testToolchain();

    const minified = await buildPluginApp(dir, "0.9.0-test", toolchain);
    const minifiedJs = await readFile(minified.jsPath, "utf8");
    const minifiedCss = await readFile(minified.cssPath, "utf8");
    expect(minifiedJs).not.toContain("fixtureLocalResult");
    expect(minifiedJs).not.toContain("fixture-legal-comment");
    expect(minifiedJs).toContain("bb-minify");
    expect(minifiedCss).toContain(".flex-col{flex-direction:column}");
    expect(minifiedCss).toContain(".bb71-authored{color:#ff69b4;margin:0}");
    expect(minifiedCss).not.toContain("\n  ");

    const readable = await buildPluginApp(dir, "0.9.0-test", toolchain, {
      minify: false,
      sourceLocationBase: null,
    });
    const readableJs = await readFile(readable.jsPath, "utf8");
    const readableCss = await readFile(readable.cssPath, "utf8");
    expect(readableJs).toContain("fixtureLocalResult");
    expect(readableCss).toMatch(/\.flex-col \{\n\s+flex-direction: column;/);
    expect(readableCss).toContain(".bb71-authored {");
    expect(readableJs.length).toBeGreaterThan(minifiedJs.length);
    expect(readableCss.length).toBeGreaterThan(minifiedCss.length);
  });

  it("stamps host elements with repository-relative source locations and keeps component names", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "bb-plugin-sources-"));
    tempDirs.push(checkout);
    const dir = join(checkout, "plugins", "fixture");
    await mkdir(join(checkout, "packages", "ui", "src"), { recursive: true });
    await mkdir(dir, { recursive: true });
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
    const toolchain = await testToolchain();

    const stamped = await buildPluginApp(dir, "0.9.0-test", toolchain, {
      minify: true,
      sourceLocationBase: sourceLocationBase(dir, checkout),
    });
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

    const plain = await buildPluginApp(dir, "0.9.0-test", toolchain);
    expect(await readFile(plain.jsPath, "utf8")).not.toContain(
      "plugins/fixture",
    );
    expect(
      JSON.parse(await readFile(plain.metaPath, "utf8")),
    ).not.toHaveProperty("sourceLocations");
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
      "const text = `",
      "export function NotReal() {}`;",
    ].join("\n");

    expect(componentDefinitions(code)).toEqual([
      { name: "Picker", line: 2, column: 8 },
      { name: "Button", line: 5, column: 14 },
      { name: "Row", line: 6, column: 7 },
      { name: "Arrow", line: 7, column: 14 },
      { name: "Page", line: 8, column: 16 },
      { name: "Single", line: 9, column: 7 },
      { name: "NotReal", line: 14, column: 8 },
    ]);
  });

  it("stamps shared workspace sources relative to the checkout and skips files outside it", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "bb-plugin-sources-"));
    tempDirs.push(checkout);
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
    await mkdir(join(checkout, "plugins", "a"), { recursive: true });
    expect(
      sourceLocationBase(join(checkout, "plugins", "a"), checkout),
    ).toEqual(["plugins", "a"]);
    expect(sourceLocationBase(tmpdir(), checkout)).toBeNull();
  });

  it("scans bundled Tailwind content from a symlinked workspace dependency by filesystem identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-scan-"));
    tempDirs.push(dir);
    const uiPackageDir = join(dir, "packages", "fixture-ui");
    await mkdir(join(uiPackageDir, "src", "excluded"), { recursive: true });
    await mkdir(join(uiPackageDir, "actual-src"), { recursive: true });
    await writeFile(
      join(uiPackageDir, "package.json"),
      JSON.stringify({
        name: "fixture-ui",
        version: "0.0.0",
        type: "module",
        bb: { pluginTailwindContent: ["src/**/*", "!src/excluded/**/*"] },
      }),
    );
    await writeFile(
      join(uiPackageDir, "actual-src", "used.ts"),
      'export const usedClass = "tracking-widest";\n',
    );
    await symlink(
      "../actual-src/used.ts",
      join(uiPackageDir, "src", "used.ts"),
    );
    await writeFile(
      join(uiPackageDir, "src", "unused.ts"),
      'export const unusedClass = "tracking-tighter";\n',
    );
    await writeFile(
      join(uiPackageDir, "src", "excluded", "bundled-but-excluded.ts"),
      'export const excludedClass = "tracking-normal";\n',
    );
    const pluginDir = join(dir, "plugin");
    await mkdir(join(pluginDir, "node_modules"), { recursive: true });
    await symlink(uiPackageDir, join(pluginDir, "node_modules", "fixture-ui"));
    await writeFile(
      join(pluginDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-scan-fixture",
        version: "0.0.0",
        type: "module",
        bb: {
          name: "Scan fixture",
          description: "Verifies dependency content scanning.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          app: "./app.ts",
        },
        dependencies: { "fixture-ui": "0.0.0" },
      }),
    );
    await writeFile(
      join(pluginDir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(pluginDir, "app.ts"),
      [
        'import { usedClass } from "fixture-ui/src/used.ts";',
        'import { excludedClass } from "fixture-ui/src/excluded/bundled-but-excluded.ts";',
        'export default [usedClass, excludedClass, "leading-loose"];',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(pluginDir, "notes.ts"),
      'export const ownUnimported = "leading-tight";\n',
    );

    const aliasContainer = await mkdtemp(
      join(tmpdir(), "bb-plugin-scan-alias-"),
    );
    tempDirs.push(aliasContainer);
    const aliasedRoot = join(aliasContainer, "fixture");
    await symlink(dir, aliasedRoot);

    const result = await buildPluginApp(
      join(aliasedRoot, "plugin"),
      "0.9.0-test",
      await testToolchain(),
    );
    const css = await readFile(result.cssPath, "utf8");

    expect(css).toContain(".tracking-widest{");
    expect(css).toContain(".leading-loose{");
    expect(css).toContain(".leading-tight{");
    expect(css).not.toContain(".tracking-tighter{");
    expect(css).not.toContain(".tracking-normal{");
    expect(css).toMatch(/:root,:host\{[^}]*--tracking-widest:/);
    expect(css).not.toContain("--color-background:");
  });

  it.each([
    ["non-SVG XML", "<html/>", /<svg> root element/],
    ["malformed XML", "<svg><path></svg>", /not valid SVG XML/],
    [
      "entity declarations",
      '<!DOCTYPE svg [<!ENTITY mark "x">]><svg>&mark;</svg>',
      /must not contain a doctype declaration/,
    ],
  ])(
    "rejects %s in a path-shaped branding.icon before building",
    async (_case, icon, expectedError) => {
      const dir = await mkdtemp(join(tmpdir(), "bb-plugin-icon-"));
      tempDirs.push(dir);
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "bb-plugin-icon-fixture",
          version: "0.0.0",
          bb: {
            name: "Icon fixture",
            description: "Verifies compact icon validation.",
            branding: { icon: "./icon.svg" },
            server: "./server.ts",
            app: "./app.ts",
          },
        }),
      );
      await writeFile(
        join(dir, "server.ts"),
        "export default function plugin() {}\n",
      );
      await writeFile(join(dir, "app.ts"), "export default {};\n");
      await writeFile(join(dir, "icon.svg"), icon);

      await expect(
        buildPluginApp(dir, "0.9.0-test", await testToolchain()),
      ).rejects.toThrow(expectedError);
    },
  );
});
