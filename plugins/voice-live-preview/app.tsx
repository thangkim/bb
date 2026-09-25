import { toast } from "sonner";
import {
  definePluginApp,
  type PluginCommandRegistration,
} from "@get-bb/plugin-sdk/app";
import { startLiveVoiceSession } from "./live-session.js";
import {
  resolveDictateComposer,
  toggleNativeDictation,
  trackFocusedComposer,
} from "./native-mic.js";

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
  );
}

export function createDictateCommand(
  isMac: boolean,
): PluginCommandRegistration {
  return {
    id: "dictate",
    title: "Voice: dictate into the composer",
    ...(isMac ? { defaultShortcut: { key: "v", control: true } } : {}),
    isAvailable: () => resolveDictateComposer(document) !== null,
    run: () => {
      toggleNativeDictation(document);
    },
  };
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "voice-live-preview",
    experimental_voiceInput: {
      start: (session) =>
        startLiveVoiceSession(session, {
          warning: (title, options) => toast.warning(title, options),
        }),
    },
  });
  app.commands.register(createDictateCommand(isMacPlatform()));
  app.contentScripts.register({
    id: "composer-focus",
    mount: () => trackFocusedComposer(document),
  });
});
