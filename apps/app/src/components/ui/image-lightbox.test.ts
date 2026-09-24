import { describe, expect, it } from "vitest";
import {
  getImageLightboxKeyAction,
  getWrappedImageIndex,
} from "@/components/ui/image-lightbox";

interface TestKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

function createKeyboardEvent(
  key: string,
  overrides: Partial<TestKeyboardEvent> = {},
): TestKeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("ImageLightbox", () => {
  it("wraps image navigation in both directions", () => {
    expect(
      getWrappedImageIndex({
        currentIndex: 0,
        direction: "previous",
        itemCount: 3,
      }),
    ).toBe(2);

    expect(
      getWrappedImageIndex({
        currentIndex: 2,
        direction: "next",
        itemCount: 3,
      }),
    ).toBe(0);
  });

  it("leaves the index unchanged when there are no images to navigate", () => {
    expect(
      getWrappedImageIndex({
        currentIndex: 1,
        direction: "next",
        itemCount: 0,
      }),
    ).toBe(1);
  });

  it("keeps Escape available when only a single image is open", () => {
    expect(
      getImageLightboxKeyAction({
        event: createKeyboardEvent("Escape"),
        hasNavigation: false,
      }),
    ).toBe("close");
  });

  it("maps Cmd+C and Ctrl+C to copy, but not other modified C presses", () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(
        getImageLightboxKeyAction({
          event: createKeyboardEvent("c", modifier),
          hasNavigation: false,
        }),
      ).toBe("copy");
    }
    for (const event of [
      createKeyboardEvent("c"),
      createKeyboardEvent("c", { metaKey: true, shiftKey: true }),
      createKeyboardEvent("c", { metaKey: true, altKey: true }),
      createKeyboardEvent("c", { metaKey: true, defaultPrevented: true }),
    ]) {
      expect(
        getImageLightboxKeyAction({ event, hasNavigation: false }),
      ).toBeNull();
    }
  });
});
