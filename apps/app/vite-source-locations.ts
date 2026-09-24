import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MagicString from "magic-string";
import { parseAst, type Plugin } from "vite";

export const SOURCE_LOCATION_ATTRIBUTE = "data-bb-src";
export const COMPONENT_SOURCE_PROPERTY = "__bbSource";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "type") === "string" &&
    typeof Reflect.get(value, "start") === "number"
  );
}

function childNodes(node: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) children.push(item);
      }
    } else if (isAstNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function isHostElementName(name: unknown): name is AstNode {
  return (
    isAstNode(name) &&
    name.type === "JSXIdentifier" &&
    typeof name.name === "string" &&
    /^[a-z]/u.test(name.name)
  );
}

function hasSourceAttribute(attributes: unknown): boolean {
  return (
    Array.isArray(attributes) &&
    attributes.some(
      (attribute) =>
        isAstNode(attribute) &&
        attribute.type === "JSXAttribute" &&
        isAstNode(attribute.name) &&
        attribute.name.name === SOURCE_LOCATION_ATTRIBUTE,
    )
  );
}

function lineStarts(code: string): number[] {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function locate(starts: number[], offset: number): string {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return `${low + 1}:${offset - (starts[low] ?? 0) + 1}`;
}

export function repositoryRelativePath(
  id: string,
  root: string = REPO_ROOT,
): string | null {
  const file = id.replace(/\?.*$/u, "");
  if (!isAbsolute(file)) return null;
  const path = relative(root, file).replaceAll("\\", "/");
  if (
    path.startsWith("../") ||
    isAbsolute(path) ||
    path.split("/").includes("node_modules")
  ) {
    return null;
  }
  return path;
}

function identifierName(node: unknown): string | null {
  return isAstNode(node) &&
    node.type === "Identifier" &&
    typeof node.name === "string"
    ? node.name
    : null;
}

function isComponentName(name: string | null): name is string {
  return name !== null && /^[A-Z]/u.test(name);
}

function isComponentWrapperCall(node: AstNode): boolean {
  if (node.type !== "CallExpression" || !isAstNode(node.callee)) return false;
  const callee = node.callee;
  const name =
    callee.type === "MemberExpression"
      ? identifierName(callee.property)
      : identifierName(callee);
  return name === "memo" || name === "forwardRef";
}

function isComponentInit(init: unknown): boolean {
  return (
    isAstNode(init) &&
    (init.type === "ArrowFunctionExpression" ||
      init.type === "FunctionExpression" ||
      isComponentWrapperCall(init))
  );
}

function componentDeclarations(
  statement: AstNode,
): Array<{ name: string; start: number }> {
  const declaration =
    (statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration") &&
    isAstNode(statement.declaration)
      ? statement.declaration
      : statement;
  if (declaration.type === "FunctionDeclaration") {
    const name = identifierName(declaration.id);
    return isComponentName(name) && declaration.declare !== true
      ? [{ name, start: declaration.start }]
      : [];
  }
  if (
    declaration.type !== "VariableDeclaration" ||
    declaration.declare === true ||
    !Array.isArray(declaration.declarations)
  ) {
    return [];
  }
  return declaration.declarations.flatMap((declarator) => {
    if (!isAstNode(declarator)) return [];
    const name = identifierName(declarator.id);
    return isComponentName(name) && isComponentInit(declarator.init)
      ? [{ name, start: declarator.start }]
      : [];
  });
}

export function stampSourceLocations(
  code: string,
  path: string,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
  if (!code.includes("<")) return null;
  const lang = path.endsWith(".jsx") ? "jsx" : "tsx";
  const program = parseAst(code, { lang });
  const starts = lineStarts(code);
  const output = new MagicString(code);
  const pending: AstNode[] = isAstNode(program) ? [program] : [];
  let stamped = false;
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (
      node.type === "JSXOpeningElement" &&
      isHostElementName(node.name) &&
      !hasSourceAttribute(node.attributes)
    ) {
      const location = `${path}:${locate(starts, node.start)}`;
      output.appendLeft(
        node.name.end,
        ` ${SOURCE_LOCATION_ATTRIBUTE}=${JSON.stringify(location)}`,
      );
      stamped = true;
    }
    pending.push(...childNodes(node));
  }
  const body =
    isAstNode(program) && Array.isArray(program.body) ? program.body : [];
  for (const statement of body) {
    if (!isAstNode(statement)) continue;
    for (const component of componentDeclarations(statement)) {
      const location = `${path}:${locate(starts, component.start)}`;
      output.append(
        `\n${component.name}.${COMPONENT_SOURCE_PROPERTY} = ${JSON.stringify(location)};`,
      );
      stamped = true;
    }
  }
  if (!stamped) return null;
  return {
    code: output.toString(),
    map: output.generateMap({ hires: "boundary", source: path }),
  };
}

export function sourceLocations(
  apply: "serve" | "build",
  root: string = REPO_ROOT,
): Plugin {
  return {
    name: "bb:source-locations",
    enforce: "pre",
    apply,
    transform: {
      filter: {
        id: {
          include: /\.[jt]sx(?:$|\?)/u,
          exclude: /[/\\]node_modules[/\\]/u,
        },
      },
      handler(code, id) {
        const path = repositoryRelativePath(id, root);
        return path === null ? null : stampSourceLocations(code, path);
      },
    },
  };
}
