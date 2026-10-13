import type { PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

type TerminalSession =
  PluginThreadEventPayloads["experimental_terminal.input"]["terminal"];

export interface TerminalSignals {
  bell: boolean;
  notification: string | null;
  title: string | null;
}

type ScanMode = "text" | "escape" | "osc" | "oscEscape";

export interface TerminalScanner {
  scan(text: string): TerminalSignals;
}

const OSC_MAX_LENGTH = 4_096;

function oscSignal(body: string, signals: TerminalSignals): void {
  const separator = body.indexOf(";");
  if (separator === -1) return;
  const code = body.slice(0, separator);
  const rest = body.slice(separator + 1);
  if (code === "0" || code === "2") {
    signals.title = rest;
    return;
  }
  if (code === "9") {
    if (/^4(;|$)/u.test(rest)) return;
    signals.notification = rest.trim() || signals.notification;
    return;
  }
  if (code === "777") {
    const [kind, title = "", message = ""] = rest.split(";");
    if (kind !== "notify") return;
    signals.notification =
      message.trim() || title.trim() || signals.notification;
  }
}

export function createTerminalScanner(): TerminalScanner {
  let mode: ScanMode = "text";
  let osc = "";
  return {
    scan(text) {
      const signals: TerminalSignals = {
        bell: false,
        notification: null,
        title: null,
      };
      for (const char of text) {
        if (mode === "text") {
          if (char === "\u001b") mode = "escape";
          else if (char === "\u0007") signals.bell = true;
        } else if (mode === "escape") {
          if (char === "]") {
            mode = "osc";
            osc = "";
          } else {
            mode = char === "\u001b" ? "escape" : "text";
          }
        } else if (mode === "osc") {
          if (char === "\u0007") {
            oscSignal(osc, signals);
            mode = "text";
          } else if (char === "\u001b") {
            mode = "oscEscape";
          } else if (osc.length < OSC_MAX_LENGTH) {
            osc += char;
          }
        } else if (char === "\\") {
          oscSignal(osc, signals);
          mode = "text";
        } else {
          mode = "escape";
        }
      }
      return signals;
    },
  };
}

export function terminalName(
  oscTitle: string | null,
  sessionTitle: string,
): string {
  const cleaned = oscTitle?.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return cleaned || sessionTitle;
}

export interface TerminalOutput {
  text: string;
  nextSeq: number;
  running: boolean;
}

export interface TerminalFinished {
  terminal: TerminalSession;
  name: string;
  message: string | null;
}

export interface TerminalWatcherArgs {
  readOutput(
    terminalId: string,
    sinceSeq: number | null,
  ): Promise<TerminalOutput>;
  onFinished(finished: TerminalFinished): Promise<void> | void;
  now(): number;
  minBusyMs: number;
  quietMs: number;
  bellGraceMs: number;
  maxWatchMs: number;
}

interface Watch {
  terminal: TerminalSession;
  scanner: TerminalScanner;
  seq: number | null;
  armedAt: number;
  lastInputAt: number;
  lastOutputAt: number | null;
  oscTitle: string | null;
}

export function createTerminalWatcher(args: TerminalWatcherArgs) {
  const watches = new Map<string, Watch>();

  function finish(watch: Watch, message: string | null): Promise<void> | void {
    watches.delete(watch.terminal.id);
    return args.onFinished({
      terminal: watch.terminal,
      name: terminalName(watch.oscTitle, watch.terminal.title),
      message,
    });
  }

  async function poll(watch: Watch): Promise<void> {
    const output = await args.readOutput(watch.terminal.id, watch.seq);
    if (watches.get(watch.terminal.id) !== watch) return;
    const firstRead = watch.seq === null;
    watch.seq = output.nextSeq;
    const now = args.now();
    if (!output.running) {
      watches.delete(watch.terminal.id);
      return;
    }
    if (firstRead) {
      watch.oscTitle = createTerminalScanner().scan(output.text).title;
    } else if (output.text.length > 0) {
      const signals = watch.scanner.scan(output.text);
      if (signals.title !== null) watch.oscTitle = signals.title;
      watch.lastOutputAt = now;
      const notified = signals.bell || signals.notification !== null;
      if (notified && now - watch.lastInputAt >= args.bellGraceMs) {
        await finish(watch, signals.notification);
        return;
      }
    }
    if (now - watch.armedAt >= args.maxWatchMs) {
      watches.delete(watch.terminal.id);
      return;
    }
    const lastActivity = Math.max(watch.lastInputAt, watch.lastOutputAt ?? 0);
    if (now - lastActivity < args.quietMs) return;
    const busyMs =
      watch.lastOutputAt === null ? 0 : watch.lastOutputAt - watch.lastInputAt;
    if (busyMs >= args.minBusyMs) {
      await finish(watch, null);
      return;
    }
    watches.delete(watch.terminal.id);
  }

  return {
    onInput(terminal: TerminalSession): void {
      if (terminal.threadId === null) return;
      const now = args.now();
      const existing = watches.get(terminal.id);
      if (existing) {
        existing.terminal = terminal;
        existing.lastInputAt = now;
        return;
      }
      watches.set(terminal.id, {
        terminal,
        scanner: createTerminalScanner(),
        seq: null,
        armedAt: now,
        lastInputAt: now,
        lastOutputAt: null,
        oscTitle: null,
      });
    },

    forget(terminalId: string): void {
      watches.delete(terminalId);
    },

    watching(): number {
      return watches.size;
    },

    async tick(onError: (error: unknown) => void): Promise<void> {
      await Promise.all(
        [...watches.values()].map((watch) =>
          poll(watch).catch((error: unknown) => {
            watches.delete(watch.terminal.id);
            onError(error);
          }),
        ),
      );
    },
  };
}

export type TerminalWatcher = ReturnType<typeof createTerminalWatcher>;
