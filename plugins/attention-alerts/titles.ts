const IRREGULAR_PAST: Record<string, string> = {
  begin: "began",
  bind: "bound",
  break: "broke",
  bring: "brought",
  build: "built",
  buy: "bought",
  catch: "caught",
  choose: "chose",
  cut: "cut",
  do: "did",
  draw: "drew",
  drive: "drove",
  feed: "fed",
  find: "found",
  fit: "fit",
  forget: "forgot",
  freeze: "froze",
  get: "got",
  give: "gave",
  go: "went",
  grow: "grew",
  hide: "hid",
  hold: "held",
  keep: "kept",
  know: "knew",
  lead: "led",
  let: "let",
  lose: "lost",
  make: "made",
  meet: "met",
  pay: "paid",
  put: "put",
  quit: "quit",
  read: "read",
  rebuild: "rebuilt",
  redo: "redid",
  rerun: "reran",
  reset: "reset",
  rewrite: "rewrote",
  run: "ran",
  say: "said",
  seek: "sought",
  sell: "sold",
  send: "sent",
  set: "set",
  shut: "shut",
  speak: "spoke",
  split: "split",
  spread: "spread",
  take: "took",
  teach: "taught",
  tell: "told",
  think: "thought",
  throw: "threw",
  understand: "understood",
  undo: "undid",
  upset: "upset",
  win: "won",
  write: "wrote",
};

const REGULAR_VERBS = new Set([
  "add", "adjust", "align", "analyze", "answer", "apply", "archive", "ask",
  "audit", "automate", "backfill", "benchmark", "brainstorm", "bump", "change",
  "check", "clarify", "clean", "clear", "collect", "combine", "compare",
  "compile", "configure", "confirm", "connect", "consolidate", "convert",
  "copy", "correct", "create", "debug", "decide", "define", "delete", "deploy",
  "deprecate", "describe", "design", "detect", "diagnose", "disable",
  "document", "download", "draft", "drop", "duplicate", "edit", "enable",
  "ensure", "estimate", "evaluate", "examine", "explain", "explore", "export",
  "expose", "extend", "extract", "file", "fill", "finish", "fix", "flag",
  "format", "generate", "handle", "harden", "help", "highlight", "identify",
  "implement", "import", "improve", "include", "increase", "initialize",
  "inspect", "install", "integrate", "investigate", "label", "launch", "link",
  "list", "load", "localize", "locate", "log", "look", "map", "mark", "measure",
  "merge", "migrate", "mock", "modernize", "move", "name", "normalize",
  "open", "optimize", "organize", "outline", "parse", "patch", "pin", "plan",
  "polish", "port", "prepare", "prevent", "prioritize", "profile", "prototype",
  "prune", "publish", "pull", "push", "record", "recover", "redesign",
  "refactor", "refine", "reformat", "regenerate", "release", "remove",
  "rename", "reorder", "reorganize", "repair", "replace", "report",
  "reproduce", "research", "resolve", "restore", "restructure", "retry",
  "revert", "review", "revise", "rework", "save", "scaffold", "scan",
  "schedule", "search", "separate", "ship", "show", "simplify", "skip", "sort",
  "start", "stop", "store", "streamline", "strip", "style", "submit",
  "summarize", "support", "swap", "sync", "tag", "test", "tidy", "track",
  "train", "transfer", "translate", "trim", "troubleshoot", "try", "tune",
  "turn", "tweak", "unify", "unpin", "update", "upgrade", "upload", "use",
  "validate", "verify", "visualize", "wire", "wrap",
]);

const DOUBLED_FINAL_CONSONANT = new Set([
  "commit", "control", "debug", "occur", "omit", "permit", "prefer", "refer", "submit",
  "transfer", "unpin",
]);

function regularPast(verb: string): string {
  if (verb.endsWith("e")) return `${verb}d`;
  if (/[^aeiou]y$/u.test(verb)) return `${verb.slice(0, -1)}ied`;
  const vowelGroups = verb.match(/[aeiouy]+/gu)?.length ?? 0;
  if (
    DOUBLED_FINAL_CONSONANT.has(verb) ||
    (vowelGroups === 1 && /[^aeiou][aeiou][^aeiouwxy]$/u.test(verb))
  ) {
    return `${verb}${verb.at(-1)}ed`;
  }
  return `${verb}ed`;
}

function splitLeadingVerb(title: string): { verb: string; rest: string } | null {
  const match = /^([A-Za-z]+)(\b.*)$/su.exec(title);
  if (!match) return null;
  const [, word = "", rest = ""] = match;
  const verb = word.toLowerCase();
  if (word !== verb && word.slice(1) !== verb.slice(1)) return null;
  if (!(verb in IRREGULAR_PAST) && !REGULAR_VERBS.has(verb)) return null;
  return { verb, rest };
}

function capitalize(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

export function finishedTitle(threadTitle: string): string {
  const parsed = splitLeadingVerb(threadTitle);
  if (!parsed) return `Finished “${threadTitle}”`;
  const past = IRREGULAR_PAST[parsed.verb] ?? regularPast(parsed.verb);
  return `${capitalize(past)}${parsed.rest}`;
}

export function failedTitle(threadTitle: string): string {
  const parsed = splitLeadingVerb(threadTitle);
  if (!parsed) return `Failed: ${threadTitle}`;
  return `Failed to ${parsed.verb}${parsed.rest}`;
}
