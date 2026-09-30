interface PageBridge {
  postMessage(data: unknown): void;
}

interface AnnotationPageState {
  active: boolean;
  count: number;
}

export interface AnnotationController {
  activate(): AnnotationPageState;
  deactivate(): AnnotationPageState;
  state(): AnnotationPageState;
  setTheme(theme: Record<string, string>): void;
  clear(): AnnotationPageState;
  dispose(): void;
}

interface PinnedAnnotation {
  id: string;
  number: number;
  comment: string;
  element: Element;
  pin: HTMLElement;
  outline: HTMLElement;
}

export const ANNOTATION_CONTROLLER_KEY = "__bbBuildingMode";
export const ANNOTATION_ATTRIBUTE_PREFIX = "data-bb-building-";
const PLUGIN_ROOT_ATTRIBUTE = "data-bb-plugin";

export const THEME_TOKENS = [
  "canvas",
  "ink",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "muted-foreground",
  "border",
  "ring",
  "destructive",
  "state-hover",
  "font-sans",
  "font-mono",
  "radius",
] as const;

const PAINTED_TAGS = new Set([
  "canvas",
  "embed",
  "iframe",
  "img",
  "input",
  "object",
  "picture",
  "select",
  "textarea",
  "video",
]);

function isTransparentColor(value: string): boolean {
  return (
    value === "" ||
    value === "transparent" ||
    /[,/]\s*0(?:\.0*)?%?\s*\)$/u.test(value)
  );
}

function isEmptyHitArea(element: Element): boolean {
  if (
    element instanceof SVGElement ||
    PAINTED_TAGS.has(element.tagName.toLowerCase())
  ) {
    return false;
  }
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return false;
    }
  }
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) return false;
  }
  const style = getComputedStyle(element);
  const borderWidths = [
    style.borderTopWidth,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.borderLeftWidth,
  ];
  return (
    isTransparentColor(style.backgroundColor) &&
    (style.backgroundImage === "" || style.backgroundImage === "none") &&
    (style.boxShadow === "" || style.boxShadow === "none") &&
    borderWidths.every((width) => width === "" || parseFloat(width) === 0)
  );
}

function containsRect(outer: DOMRect, inner: DOMRect): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.bottom <= outer.bottom + 0.5 &&
    inner.width * inner.height < outer.width * outer.height
  );
}

export function installBuildingMode(
  bb: PageBridge,
  theme: Record<string, string>,
): AnnotationPageState {
  const existing: AnnotationController | undefined = Reflect.get(
    globalThis,
    ANNOTATION_CONTROLLER_KEY,
  );
  if (existing !== undefined) {
    existing.setTheme(theme);
    return existing.state();
  }

  const attributePrefix = ANNOTATION_ATTRIBUTE_PREFIX;
  const sourceAttribute = "data-bb-src";
  const attributeKeys = [
    "id",
    "class",
    "role",
    "aria-label",
    "name",
    "type",
    "href",
    "src",
    "alt",
    "placeholder",
    "title",
    "data-testid",
    sourceAttribute,
  ];
  const css = `
    .hover, .outline, .label, .pin, .editor { position: fixed; box-sizing: border-box; }
    .hover { display: none; pointer-events: none; border: 1.5px solid var(--bb-primary); border-radius: 4px; background: color-mix(in oklab, var(--bb-primary) 10%, transparent); }
    .outline { pointer-events: none; border: 1.5px dashed color-mix(in oklab, var(--bb-primary) 70%, transparent); border-radius: 4px; }
    .label { display: none; pointer-events: none; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 6px; background: var(--bb-primary); color: var(--bb-primary-foreground); font: 500 11px/16px var(--bb-font-mono, ui-monospace, monospace); }
    .pin { pointer-events: auto; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 999px; background: var(--bb-primary); color: var(--bb-primary-foreground); font: 600 11px/20px var(--bb-font-sans, system-ui, sans-serif); text-align: center; box-shadow: 0 0 0 2px var(--bb-canvas), 0 1px 4px rgb(0 0 0 / 0.3); cursor: pointer; padding: 0; border: 0; }
    .pin:focus-visible { outline: 2px solid var(--bb-ring); outline-offset: 2px; }
    .editor { pointer-events: auto; width: 320px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius, 0.5rem) + 4px); background: var(--bb-popover); color: var(--bb-popover-foreground); box-shadow: 0 12px 32px color-mix(in oklab, var(--bb-ink) 22%, transparent); font: 400 13px/1.4 var(--bb-font-sans, system-ui, sans-serif); }
    .editor-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 0; min-width: 0; }
    .editor-title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--bb-muted-foreground); font: 500 11px/18px var(--bb-font-mono, ui-monospace, monospace); }
    .target-tag { flex-shrink: 0; color: var(--bb-popover-foreground); background: var(--bb-state-hover); padding: 0 6px; border-radius: 5px; white-space: nowrap; }
    .target-text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .editor-number { flex-shrink: 0; width: 18px; height: 18px; border-radius: 999px; background: var(--bb-primary); color: var(--bb-primary-foreground); font: 600 10px/18px var(--bb-font-sans, system-ui, sans-serif); text-align: center; }
    textarea { box-sizing: border-box; display: block; width: calc(100% - 20px); min-height: 68px; max-height: 240px; resize: vertical; margin: 8px 10px 0; padding: 7px 9px; border: 1px solid var(--bb-border); border-radius: 7px; background: var(--bb-canvas); color: inherit; font: inherit; outline: none; }
    textarea::placeholder { color: var(--bb-muted-foreground); }
    textarea:focus { border-color: var(--bb-ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--bb-ring) 12%, transparent); }
    .actions { display: flex; align-items: center; gap: 6px; padding: 8px 10px 10px; min-width: 0; }
    button { flex-shrink: 0; white-space: nowrap; height: 28px; padding: 0 11px; border: 1px solid transparent; border-radius: 7px; font: 500 12px/16px var(--bb-font-sans, system-ui, sans-serif); cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--bb-ring); outline-offset: 1px; }
    .cancel { margin-left: auto; border-color: var(--bb-border); background: transparent; color: inherit; }
    .delete { padding: 0 6px; margin-left: -6px; background: transparent; color: var(--bb-muted-foreground); }
    .delete:hover { color: var(--bb-destructive, var(--bb-ink)); background: color-mix(in oklab, var(--bb-destructive, var(--bb-ink)) 8%, transparent); }
    .cancel:hover { background: var(--bb-state-hover); }
    .save { background: var(--bb-primary); color: var(--bb-primary-foreground); }
    .save:hover { filter: brightness(1.08); }
    .save:disabled { opacity: 0.45; cursor: default; filter: none; }

  `;

  const host = document.createElement("bb-building-mode");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "open" });
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
  }
  const hoverBox = part("div", "hover");
  const hoverLabel = part("div", "label");
  root.append(hoverBox, hoverLabel);

  let active = false;
  let hovered: Element | null = null;
  let editor: HTMLElement | null = null;
  let nextNumber = 1;
  let frame = 0;
  const annotations: PinnedAnnotation[] = [];

  function part(tagName: string, className: string): HTMLElement {
    const node = document.createElement(tagName);
    node.className = className;
    return node;
  }

  function setTheme(next: Record<string, string>): void {
    for (const [name, value] of Object.entries(next)) {
      host.style.setProperty(name, value);
    }
  }

  function state(): AnnotationPageState {
    return { active, count: annotations.length };
  }

  function post(message: unknown): void {
    bb.postMessage(message);
  }

  function escapeIdentifier(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function collapse(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function elementName(element: Element): string {
    const id = element.id.length > 0 ? `#${element.id}` : "";
    const classes = Array.from(element.classList)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    const text = collapse(element.textContent ?? "");
    const label =
      element.getAttribute("aria-label") ??
      (text.length > 0 && text.length <= 40 ? text : "");
    const suffix = label.length > 0 ? ` "${label.slice(0, 40)}"` : "";
    return `${element.tagName.toLowerCase()}${id}${classes}${suffix}`.slice(
      0,
      200,
    );
  }

  function locationSegment(element: Element, target: boolean): string {
    const tagName = element.tagName.toLowerCase();
    if (element.id.length > 0) return `#${escapeIdentifier(element.id)}`;
    const testId = element.getAttribute("data-testid");
    if (testId !== null && testId.length > 0) {
      return `[data-testid="${testId.slice(0, 80).replace(/["\\]/g, "\\$&")}"]`;
    }
    const label = element.getAttribute("aria-label");
    if (target && label !== null && label.length > 0) {
      return `${tagName}[aria-label="${label.slice(0, 80).replace(/["\\]/g, "\\$&")}"]`;
    }
    const className = Array.from(element.classList).find(
      (name) => !/[:[\]/()]/.test(name) && !name.startsWith(attributePrefix),
    );
    return className === undefined
      ? tagName
      : `${target ? tagName : ""}.${escapeIdentifier(className)}`;
  }

  function locationFor(element: Element): string {
    const segments: string[] = [];
    let current: Element | null = element;
    while (
      current !== null &&
      current !== document.body &&
      current !== document.documentElement &&
      segments.length < 5
    ) {
      const segment = locationSegment(current, current === element);
      segments.unshift(segment);
      if (segment.startsWith("#") || segment.startsWith("[data-testid")) break;
      current = current.parentElement;
    }
    return segments.join(" > ").slice(0, 1000);
  }

  function visibleTextOf(element: Element): string {
    return collapse(
      element instanceof HTMLElement && typeof element.innerText === "string"
        ? element.innerText
        : (element.textContent ?? ""),
    );
  }

  function contextFor(element: Element, own: string): string {
    let current = element.parentElement;
    for (let depth = 0; current !== null && depth < 4; depth += 1) {
      if (current === document.body) break;
      const text = visibleTextOf(current);
      if (text.length > own.length) {
        const at = own.length > 0 ? Math.max(0, text.indexOf(own)) : 0;
        const start = Math.max(0, at - 120);
        const snippet = text.slice(start, start + 300);
        return `${start > 0 ? "…" : ""}${snippet}${start + 300 < text.length ? "…" : ""}`;
      }
      current = current.parentElement;
    }
    return own.slice(0, 300);
  }

  function sourcesFor(element: Element): string[] {
    const sources: string[] = [];
    const files = new Set<string>();
    let current: Element | null = element;
    while (current !== null && sources.length < 6) {
      const source = current.getAttribute(sourceAttribute);
      if (source !== null && source.length > 0) {
        const file = source.replace(/:\d+:\d+$/, "");
        if (!files.has(file)) {
          files.add(file);
          sources.push(source.slice(0, 1000));
        }
      }
      current = current.parentElement;
    }
    return sources;
  }

  function pluginIdFor(element: Element): string | null {
    const pluginId =
      element
        .closest(`[${PLUGIN_ROOT_ATTRIBUTE}]`)
        ?.getAttribute(PLUGIN_ROOT_ATTRIBUTE) ?? "";
    return pluginId.length > 0 ? pluginId.slice(0, 200) : null;
  }

  function describe(element: Element) {
    const rect = element.getBoundingClientRect();
    const attributes: Record<string, string> = {};
    for (const key of attributeKeys) {
      const value = element.getAttribute(key);
      if (value !== null && value.length > 0) {
        attributes[key] = value.slice(0, 400);
      }
    }
    const text = visibleTextOf(element);
    return {
      tagName: element.tagName.toLowerCase().slice(0, 64),
      name: elementName(element),
      selector: locationFor(element),
      text: text.slice(0, 160),
      context: contextFor(element, text),
      attributes,
      rect: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      sources: sourcesFor(element),
      pluginId: pluginIdFor(element),
    };
  }

  function place(node: HTMLElement, rect: DOMRect): void {
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  function showHover(element: Element | null): void {
    hovered = element;
    if (element === null) {
      hoverBox.style.display = "none";
      hoverLabel.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    place(hoverBox, rect);
    hoverBox.style.display = "block";
    const source = sourcesFor(element)[0]?.split("/").pop();
    hoverLabel.textContent = `${elementName(element)}  ${Math.round(rect.width)}×${Math.round(rect.height)}${source === undefined ? "" : `  ${source}`}`;
    hoverLabel.style.display = "block";
    hoverLabel.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - 324))}px`;
    hoverLabel.style.top = `${rect.top > 26 ? rect.top - 24 : rect.bottom + 4}px`;
  }

  function targetAt(x: number, y: number): Element | null {
    let target: Element | null = null;
    let targetRect: DOMRect | null = null;
    for (const element of document.elementsFromPoint(x, y)) {
      if (
        element === host ||
        element === document.documentElement ||
        element === document.body
      ) {
        continue;
      }
      if (target === null || targetRect === null) {
        target = element;
        targetRect = element.getBoundingClientRect();
        if (!isEmptyHitArea(target)) return target;
        continue;
      }
      if (element.contains(target)) continue;
      const rect = element.getBoundingClientRect();
      if (containsRect(targetRect, rect)) {
        target = element;
        targetRect = rect;
      }
    }
    return target;
  }

  function reposition(): void {
    for (const annotation of annotations) {
      const rect = annotation.element.getBoundingClientRect();
      const visible =
        annotation.element.isConnected && rect.width + rect.height > 0;
      annotation.pin.style.display = visible ? "block" : "none";
      annotation.pin.style.left = `${rect.left}px`;
      annotation.pin.style.top = `${rect.top}px`;
      annotation.outline.style.display = visible && active ? "block" : "none";
      place(annotation.outline, rect);
    }
    if (hovered !== null && editor === null) {
      showHover(hovered);
    }
  }

  function tick(): void {
    frame = 0;
    reposition();
    syncLoop();
  }

  function syncLoop(): void {
    const needed = active || annotations.length > 0;
    if (needed && frame === 0) {
      frame = requestAnimationFrame(tick);
    } else if (!needed && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function closeEditor(): void {
    editor?.remove();
    editor = null;
  }

  function commit(element: Element, comment: string): void {
    const trimmed = comment.trim();
    if (trimmed.length === 0) {
      return;
    }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    element.setAttribute(`${attributePrefix}${id}`, "");
    const number = nextNumber;
    nextNumber += 1;
    const pin = part("button", "pin");
    pin.setAttribute("type", "button");
    pin.setAttribute("aria-label", `Edit annotation ${number}`);
    pin.textContent = String(number);
    pin.title = trimmed;
    const outline = part("div", "outline");
    root.append(outline, pin);
    const annotation = {
      id,
      number,
      comment: trimmed.slice(0, 4000),
      element,
      pin,
      outline,
    };
    annotations.push(annotation);
    pin.addEventListener("click", () => openEditor(element, annotation));
    closeEditor();
    showHover(null);
    reposition();
    syncLoop();
    post({
      type: "annotation",
      annotation: {
        id,
        number,
        comment: trimmed.slice(0, 4000),
        url: location.href.slice(0, 4096),
        title: document.title.slice(0, 1024),
        viewport: { width: innerWidth, height: innerHeight },
        element: describe(element),
      },
    });
    post({ type: "state", ...state() });
  }

  function remove(annotation: PinnedAnnotation): void {
    const index = annotations.indexOf(annotation);
    if (index < 0) return;
    annotation.element.removeAttribute(`${attributePrefix}${annotation.id}`);
    annotation.pin.remove();
    annotation.outline.remove();
    annotations.splice(index, 1);
    closeEditor();
    showHover(null);
    syncLoop();
    post({ type: "annotation-delete", id: annotation.id });
    post({ type: "state", ...state() });
  }

  function update(annotation: PinnedAnnotation, comment: string): void {
    const trimmed = comment.trim().slice(0, 4000);
    if (trimmed.length === 0) {
      return;
    }
    annotation.comment = trimmed;
    annotation.pin.title = trimmed;
    closeEditor();
    showHover(null);
    post({ type: "annotation-update", id: annotation.id, comment: trimmed });
  }

  function openEditor(
    element: Element,
    annotation: PinnedAnnotation | null = null,
  ): void {
    closeEditor();
    showHover(element);
    const rect = element.getBoundingClientRect();
    const panel = part("div", "editor");
    panel.setAttribute("role", "dialog");
    panel.setAttribute(
      "aria-label",
      annotation === null
        ? "New annotation"
        : `Edit annotation ${annotation.number}`,
    );
    const header = part("div", "editor-head");
    if (annotation !== null) {
      const number = part("span", "editor-number");
      number.textContent = String(annotation.number);
      header.append(number);
    }
    const title = part("div", "editor-title");
    title.title = elementName(element);
    const tag = part("span", "target-tag");
    tag.textContent = element.tagName.toLowerCase();
    const targetText = part("span", "target-text");
    targetText.textContent =
      element.getAttribute("aria-label") ??
      collapse(element.textContent ?? "").slice(0, 160);
    title.append(tag, targetText);
    header.append(title);
    const textarea = document.createElement("textarea");
    textarea.placeholder = "What should change?";
    textarea.rows = 3;
    textarea.maxLength = 4000;
    textarea.value = annotation?.comment ?? "";
    textarea.setAttribute("aria-label", "Annotation comment");
    const submit = () =>
      annotation === null
        ? commit(element, textarea.value)
        : update(annotation, textarea.value);
    const actions = part("div", "actions");
    const cancel = part("button", "cancel");
    cancel.textContent = "Cancel";
    cancel.title = "Escape";
    const save = part("button", "save");
    save.textContent = annotation === null ? "Add to prompt" : "Save";
    save.title = /Mac/.test(navigator.platform) ? "⌘+Enter" : "Ctrl+Enter";
    save.toggleAttribute("disabled", textarea.value.trim().length === 0);
    if (annotation !== null) {
      const deleteButton = part("button", "delete");
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => remove(annotation));
      actions.append(deleteButton);
    }
    actions.append(cancel, save);
    panel.append(header, textarea, actions);
    root.append(panel);
    editor = panel;
    const panelRect = panel.getBoundingClientRect();
    const below = rect.bottom + 8;
    const preferredTop =
      below + panelRect.height <= innerHeight - 8
        ? below
        : rect.top - panelRect.height - 8;
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panelRect.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(preferredTop, innerHeight - panelRect.height - 8))}px`;
    textarea.addEventListener("input", () => {
      save.toggleAttribute("disabled", textarea.value.trim().length === 0);
    });
    textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    });
    cancel.addEventListener("click", () => closeEditor());
    save.addEventListener("click", submit);
    panel.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      }
    });
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active || editor !== null || event.target === host) {
      return;
    }
    showHover(targetAt(event.clientX, event.clientY));
  }

  function swallow(event: Event): void {
    if (!active || event.target === host) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event: MouseEvent): void {
    if (!active || event.target === host) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (editor !== null) {
      closeEditor();
      return;
    }
    const target = targetAt(event.clientX, event.clientY);
    if (target !== null) {
      openEditor(target);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!active || event.key !== "Escape" || event.target === host) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (editor !== null) {
      closeEditor();
      return;
    }
    deactivate();
    post({ type: "state", ...state() });
  }

  function keepEditorFocus(event: FocusEvent): void {
    const entering =
      event.type === "focusin"
        ? event.target === host
        : event.relatedTarget === host;
    if (entering) {
      event.stopImmediatePropagation();
    }
  }

  function activate(): AnnotationPageState {
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
    if (!active) {
      active = true;
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerdown", swallow, true);
      window.addEventListener("mousedown", swallow, true);
      window.addEventListener("mouseup", swallow, true);
      window.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKeyDown, true);
      reposition();
      syncLoop();
    }
    return state();
  }

  function deactivate(): AnnotationPageState {
    if (active) {
      active = false;
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", swallow, true);
      window.removeEventListener("mousedown", swallow, true);
      window.removeEventListener("mouseup", swallow, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      closeEditor();
      showHover(null);
      reposition();
      syncLoop();
    }
    return state();
  }

  function clear(): AnnotationPageState {
    closeEditor();
    showHover(null);
    for (const annotation of annotations) {
      annotation.element.removeAttribute(`${attributePrefix}${annotation.id}`);
      annotation.pin.remove();
      annotation.outline.remove();
    }
    annotations.length = 0;
    nextNumber = 1;
    syncLoop();
    return state();
  }

  function dispose(): void {
    deactivate();
    clear();
    window.removeEventListener("focusin", keepEditorFocus, true);
    window.removeEventListener("focusout", keepEditorFocus, true);
    host.remove();
    Reflect.deleteProperty(globalThis, ANNOTATION_CONTROLLER_KEY);
  }

  window.addEventListener("focusin", keepEditorFocus, true);
  window.addEventListener("focusout", keepEditorFocus, true);
  const controller: AnnotationController = {
    activate,
    deactivate,
    state,
    setTheme,
    clear,
    dispose,
  };
  Reflect.set(globalThis, ANNOTATION_CONTROLLER_KEY, controller);
  setTheme(theme);
  return state();
}

export function probeReactComponents(annotationId: string) {
  if (!/^[a-z0-9]+$/.test(annotationId)) {
    throw new Error(`Invalid annotation id: ${annotationId}`);
  }
  const element = document.querySelector(
    `[${ANNOTATION_ATTRIBUTE_PREFIX}${annotationId}]`,
  );
  if (element === null) {
    return null;
  }
  const fiberKey = Object.keys(element).find(
    (key) =>
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$"),
  );
  if (fiberKey === undefined) {
    return { components: [] };
  }
  const wrapperName =
    /^(?:Primitive\.|Slot(?:Clone)?$|Slottable$|Presence$|Portal$|Popper(?:Anchor)?$|Collection(?:Slot|ItemSlot)?$|DismissableLayer$|FocusScope$|RovingFocusGroup(?:Impl)?$|Anonymous$|ForwardRef$|Memo$|(?:forwardRef|memo|ForwardRef|Memo)\(|(?:Rendered)?Routes?$|Outlet$|Suspense$)|\.Slot(?:Clone)?$|(?:Provider|Context|Consumer)$/;
  const minifiedName = /^(?:_.*|[$\w]{1,2}|[a-z$][$\w]*)$/;
  const components: Array<{ name: string; source: string | null }> = [];
  const start = Reflect.get(element, fiberKey);
  const followOwners =
    start !== null && typeof start === "object" && Boolean(start._debugOwner);
  let fiber = followOwners ? start._debugOwner : start;
  let visited = 0;
  while (fiber && components.length < 12 && visited < 500) {
    visited += 1;
    const type = fiber.type;
    const candidate =
      typeof type === "function"
        ? type
        : type !== null && typeof type === "object"
          ? (type.render ?? type.type ?? type)
          : null;
    const name =
      candidate === null
        ? null
        : (type.displayName ?? candidate.displayName ?? candidate.name);
    if (
      typeof name === "string" &&
      name.length > 0 &&
      !wrapperName.test(name) &&
      !minifiedName.test(name) &&
      components.at(-1)?.name !== name
    ) {
      const definedAt = [type, candidate]
        .map((value) => value?.__bbSource)
        .find((value) => typeof value === "string");
      components.push({
        name: name.slice(0, 200),
        source:
          typeof definedAt === "string"
            ? definedAt.slice(0, 1000)
            : sourceOf(fiber),
      });
    }
    fiber = followOwners ? fiber._debugOwner : fiber.return;
  }
  return { components };

  function sourceOf(node: {
    _debugSource?: { fileName?: unknown; lineNumber?: unknown };
    _debugStack?: { stack?: unknown };
  }): string | null {
    const debugSource = node._debugSource;
    if (debugSource !== undefined && typeof debugSource.fileName === "string") {
      return `${debugSource.fileName}:${String(debugSource.lineNumber)}`.slice(
        0,
        1000,
      );
    }
    const stack = node._debugStack?.stack;
    if (typeof stack !== "string") {
      return null;
    }
    const frameLine = stack
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at "))
      .find(
        (line) =>
          !/react-stack-top-frame|jsx-dev-runtime|jsx-runtime|react-dom|node_modules/.test(
            line,
          ),
      );
    const match = frameLine?.match(/\(?((?:https?|file):\/\/[^\s)]+)\)?$/);
    return (
      match?.[1]?.replace(/\?[^:]*(?=:\d+:\d+$)/, "").slice(0, 1000) ?? null
    );
  }
}
