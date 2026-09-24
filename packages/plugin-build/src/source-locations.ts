import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { Plugin } from "esbuild";

export const SOURCE_LOCATION_ATTRIBUTE = "data-bb-src";
export const COMPONENT_SOURCE_PROPERTY = "__bbSource";
export const SOURCE_LOCATION_JSX_IMPORT_SOURCE = "bb-plugin-source-locations";

const RUNTIME_SPECIFIER = `${SOURCE_LOCATION_JSX_IMPORT_SOURCE}/jsx-dev-runtime`;
export const SOURCE_LOCATION_NAMESPACE = "bb-plugin-source-locations";

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function sourceLocationBase(
  pluginRoot: string,
  sourceRoot: string,
): string[] | null {
  const path = relative(canonicalPath(sourceRoot), canonicalPath(pluginRoot));
  if (isAbsolute(path)) return null;
  const segments = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  return segments[0] === ".." ? null : segments;
}

export function checkoutPath(
  base: readonly string[],
  fileName: string,
): string | null {
  const segments = [...base];
  for (const segment of fileName.replaceAll("\\", "/").split("/")) {
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return segments.length === 0 || segments.includes("node_modules")
    ? null
    : segments.join("/");
}

const COMPONENT_DECLARATION =
  /^(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?(function)\s+([A-Z][\w$]*)\s*[<(]|(?:const|let)\s+([A-Z][\w$]*)\b[^=\n]*=\s*(?:(?:React\.)?(?:memo|forwardRef)\b|(?:async\s*)?\(|(?:async\s+)?function\b|[A-Za-z_$][\w$]*\s*=>))/gmu;

export function componentDefinitions(
  code: string,
): Array<{ name: string; line: number; column: number }> {
  const definitions: Array<{ name: string; line: number; column: number }> = [];
  let line = 1;
  let lineStart = 0;
  let scanned = 0;
  for (const match of code.matchAll(COMPONENT_DECLARATION)) {
    const name = match[2] ?? match[3];
    if (name === undefined) continue;
    const keyword =
      match[1] === undefined ? /\b(?:const|let)\s+/u : /\bfunction\b/u;
    const keywordMatch = keyword.exec(match[0]);
    const offset =
      match.index +
      (keywordMatch === null
        ? 0
        : match[1] === undefined
          ? keywordMatch.index + keywordMatch[0].length
          : keywordMatch.index);
    for (; scanned < offset; scanned += 1) {
      if (code.charCodeAt(scanned) === 10) {
        line += 1;
        lineStart = scanned + 1;
      }
    }
    definitions.push({ name, line, column: offset - lineStart + 1 });
  }
  return definitions;
}

export function componentSourceStatements(code: string, path: string): string {
  return componentDefinitions(code)
    .map(
      ({ name, line, column }) =>
        `\ntry { if (Object(${name}) === ${name}) ${name}.${COMPONENT_SOURCE_PROPERTY} = ${JSON.stringify(`${path}:${line}:${column}`)}; } catch {}`,
    )
    .join("");
}

export function sourceLocationRuntimeSource(base: readonly string[]): string {
  return [
    `import { Fragment, jsx, jsxs } from "react/jsx-runtime";`,
    `export { Fragment };`,
    `const base = ${JSON.stringify(base)};`,
    `const locations = new Map();`,
    `function locate(fileName) {`,
    `  if (locations.has(fileName)) return locations.get(fileName);`,
    `  const segments = [...base];`,
    `  let location = null;`,
    `  let inside = true;`,
    `  for (const segment of fileName.replaceAll("\\\\", "/").split("/")) {`,
    `    if (segment === "..") {`,
    `      if (segments.length === 0) { inside = false; break; }`,
    `      segments.pop();`,
    `    } else if (segment !== "." && segment !== "") {`,
    `      segments.push(segment);`,
    `    }`,
    `  }`,
    `  if (inside && segments.length > 0 && !segments.includes("node_modules")) {`,
    `    location = segments.join("/");`,
    `  }`,
    `  locations.set(fileName, location);`,
    `  return location;`,
    `}`,
    `export function jsxDEV(type, props, key, isStaticChildren, source) {`,
    `  if (`,
    `    typeof type === "string" &&`,
    `    source != null &&`,
    `    typeof source.fileName === "string" &&`,
    `    props[${JSON.stringify(SOURCE_LOCATION_ATTRIBUTE)}] === undefined`,
    `  ) {`,
    `    const path = locate(source.fileName);`,
    `    if (path !== null) {`,
    `      props = { ...props, ${JSON.stringify(SOURCE_LOCATION_ATTRIBUTE)}: path + ":" + source.lineNumber + ":" + source.columnNumber };`,
    `    }`,
    `  }`,
    `  return (isStaticChildren ? jsxs : jsx)(type, props, key);`,
    `}`,
    ``,
  ].join("\n");
}

export function sourceLocationPlugin(base: readonly string[]): Plugin {
  return {
    name: "bb-plugin-source-locations",
    setup(build) {
      build.onResolve(
        { filter: /^bb-plugin-source-locations(?:\/jsx-dev-runtime)?$/ },
        (args) => ({ path: args.path, namespace: SOURCE_LOCATION_NAMESPACE }),
      );
      build.onLoad(
        { filter: /.*/, namespace: SOURCE_LOCATION_NAMESPACE },
        (args) => ({
          contents:
            args.path === RUNTIME_SPECIFIER
              ? sourceLocationRuntimeSource(base)
              : `export { createElement } from "react";\n`,
          loader: "js",
          resolveDir: build.initialOptions.absWorkingDir,
        }),
      );
      const workingDir = canonicalPath(
        build.initialOptions.absWorkingDir ?? process.cwd(),
      );
      build.onLoad({ filter: /\.[jt]sx$/, namespace: "file" }, async (args) => {
        const path = checkoutPath(base, relative(workingDir, args.path));
        if (path === null) return undefined;
        const code = await readFile(args.path, "utf8");
        return {
          contents: code + componentSourceStatements(code, path),
          loader: args.path.endsWith(".jsx") ? "jsx" : "tsx",
        };
      });
    },
  };
}
