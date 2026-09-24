import { reactProbeSchema } from "./annotations.js";
import type { AnnotationTarget } from "./annotation-session.js";
import {
  ANNOTATION_CONTROLLER_KEY,
  installAgentAnnotations,
  probeReactComponents,
  type AnnotationController,
} from "./page-script.js";

const messageListeners = new Set<(data: unknown) => void>();
const toggleListeners = new Set<() => void>();

const bridge = {
  postMessage(data: unknown) {
    for (const listener of messageListeners) listener(data);
  },
};

function isController(value: unknown): value is AnnotationController {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "activate") === "function" &&
    typeof Reflect.get(value, "dispose") === "function"
  );
}

function installedController(): AnnotationController | null {
  const value: unknown = Reflect.get(globalThis, ANNOTATION_CONTROLLER_KEY);
  return isController(value) ? value : null;
}

export const appAnnotationTarget: AnnotationTarget = {
  surface: "app",
  async activate(theme) {
    installAgentAnnotations(bridge, theme);
    const controller = installedController();
    if (controller === null) {
      throw new Error("Annotations could not start in this window.");
    }
    return controller.activate();
  },
  async control(method) {
    const controller = installedController();
    return controller === null
      ? { active: false, count: 0 }
      : controller[method]();
  },
  onMessage(listener) {
    messageListeners.add(listener);
    return () => {
      messageListeners.delete(listener);
    };
  },
  async readComponents(annotationId) {
    const parsed = reactProbeSchema.safeParse(
      probeReactComponents(annotationId),
    );
    return parsed.success && parsed.data !== null
      ? parsed.data.components.map((component) => ({
          name: component.name,
          source:
            component.source === null || /^[a-z]+:\/\//u.test(component.source)
              ? null
              : component.source,
        }))
      : [];
  },
  release() {
    installedController()?.dispose();
  },
};

export function requestAppAnnotationToggle(): void {
  for (const listener of toggleListeners) listener();
}

export function onAppAnnotationToggle(listener: () => void): () => void {
  toggleListeners.add(listener);
  return () => {
    toggleListeners.delete(listener);
  };
}
