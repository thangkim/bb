import { describe, expect, it } from "vitest";
import { failedTitle, finishedTitle } from "./titles.js";

describe("finished titles", () => {
  it.each([
    ["Summarize the Cube CLI blog post", "Summarized the Cube CLI blog post"],
    ["Fix the flaky test", "Fixed the flaky test"],
    ["Build a notifications plugin", "Built a notifications plugin"],
    ["Plan the Q4 roadmap", "Planned the Q4 roadmap"],
    ["Debug the login crash", "Debugged the login crash"],
    ["Verify the release", "Verified the release"],
    ["Add dark mode", "Added dark mode"],
    ["Review PR #42", "Reviewed PR #42"],
    ["Open the settings page", "Opened the settings page"],
    ["Sync the fork", "Synced the fork"],
    ["write docs", "Wrote docs"],
    ["Test", "Tested"],
  ])("%s → %s", (title, expected) => {
    expect(finishedTitle(title)).toBe(expected);
  });

  it("quotes titles that do not start with a known verb", () => {
    expect(finishedTitle("Notifications plugin")).toBe(
      "Finished “Notifications plugin”",
    );
    expect(finishedTitle("FIX the build")).toBe("Finished “FIX the build”");
  });
});

describe("failed titles", () => {
  it("turns a leading verb into “Failed to …”", () => {
    expect(failedTitle("Summarize the Cube CLI blog post")).toBe(
      "Failed to summarize the Cube CLI blog post",
    );
  });

  it("prefixes other titles", () => {
    expect(failedTitle("Notifications plugin")).toBe(
      "Failed: Notifications plugin",
    );
  });
});
