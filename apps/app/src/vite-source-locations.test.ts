import { describe, expect, it } from "vitest";
import {
  repositoryRelativePath,
  stampSourceLocations,
} from "../vite-source-locations.js";

const path = "apps/app/src/components/Example.tsx";

describe("stampSourceLocations", () => {
  it("stamps host elements with their repository-relative line and column", () => {
    const code = [
      'const label = "é😀";',
      "export function Example({ items }: { items: string[] }) {",
      "  return (",
      '    <section className="list">',
      "      {items.map((item) => <span key={item}>{item}</span>)}",
      "    </section>",
      "  );",
      "}",
    ].join("\n");

    const result = stampSourceLocations(code, path);

    expect(result?.code).toContain(
      `<section data-bb-src="${path}:4:5" className="list">`,
    );
    expect(result?.code).toContain(
      `<span data-bb-src="${path}:5:28" key={item}>`,
    );
    expect(result?.map.sources).toEqual([path]);
  });

  it("leaves components, member expressions, and pre-stamped elements alone", () => {
    const code = [
      "export const a = (",
      "  <>",
      "    <Button />",
      "    <motion.div />",
      '    <div data-bb-src="kept" />',
      "  </>",
      ");",
    ].join("\n");

    expect(stampSourceLocations(code, path)).toBeNull();
  });

  it("records where each top-level component is defined", () => {
    const code = [
      'import * as React from "react";',
      "export function Picker() {",
      "  return <div />;",
      "}",
      "const Button = React.forwardRef<HTMLButtonElement, object>((props, ref) => (",
      "  <Comp ref={ref} {...props} />",
      "));",
      "export const Row = memo(() => <span />);",
      "export const Arrow = (): React.ReactNode => null;",
      "const Theme = createContext(null);",
      "const helper = () => 1;",
      "function formatLabel() {",
      '  return "";',
      "}",
      "export default function Page() {",
      "  return <Picker />;",
      "}",
    ].join("\n");

    const output = stampSourceLocations(code, path)?.code ?? "";

    expect(output).toContain(`\nPicker.__bbSource = "${path}:2:8";`);
    expect(output).toContain(`\nButton.__bbSource = "${path}:5:7";`);
    expect(output).toContain(`\nRow.__bbSource = "${path}:8:14";`);
    expect(output).toContain(`\nArrow.__bbSource = "${path}:9:14";`);
    expect(output).toContain(`\nPage.__bbSource = "${path}:15:16";`);
    expect(output).not.toContain("Theme.__bbSource");
    expect(output).not.toContain("helper.__bbSource");
    expect(output).not.toContain("formatLabel.__bbSource");
  });

  it("skips files without JSX", () => {
    expect(stampSourceLocations("export const a = 1;", path)).toBeNull();
  });
});

describe("repositoryRelativePath", () => {
  it("maps workspace files and strips Vite query suffixes", () => {
    expect(
      repositoryRelativePath(
        "/repo/packages/shared-ui/src/Button.tsx?t=123",
        "/repo",
      ),
    ).toBe("packages/shared-ui/src/Button.tsx");
  });

  it("rejects dependencies, virtual modules, and files outside the repository", () => {
    expect(
      repositoryRelativePath("/repo/node_modules/x/index.jsx", "/repo"),
    ).toBeNull();
    expect(repositoryRelativePath("\0virtual:thing.tsx", "/repo")).toBeNull();
    expect(repositoryRelativePath("/elsewhere/a.tsx", "/repo")).toBeNull();
  });
});
