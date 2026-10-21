const BARE_HOST_TLDS = [
  "ai",
  "app",
  "cloud",
  "co",
  "com",
  "de",
  "dev",
  "edu",
  "fr",
  "gov",
  "io",
  "jp",
  "me",
  "net",
  "org",
  "so",
  "tech",
  "uk",
  "vn",
  "xyz",
];

const PORT_AND_PATH = "(?::\\d{1,5})?(?:[/?#]\\S*)?";
const SCHEME_PATTERN = /^https?:\/\/\S+$/i;
const LOCAL_PATTERN = new RegExp(
  `^(?:localhost|\\d{1,3}(?:\\.\\d{1,3}){3})${PORT_AND_PATH}$`,
  "i",
);
const WWW_PATTERN = new RegExp(
  `^www\\.(?:[a-z0-9-]+\\.)*[a-z0-9-]+${PORT_AND_PATH}$`,
  "i",
);
const BARE_PATTERN = new RegExp(
  `^(?:[a-z0-9-]+\\.)+(?:${BARE_HOST_TLDS.join("|")})${PORT_AND_PATH}$`,
  "i",
);

function toHttpUrl(text: string): string | null {
  try {
    const url = new URL(text);
    return url.hostname.length > 0 ? url.href : null;
  } catch {
    return null;
  }
}

export function parseTypedUrl(input: string): string | null {
  const text = input.trim();
  if (SCHEME_PATTERN.test(text)) return toHttpUrl(text);
  if (LOCAL_PATTERN.test(text)) return toHttpUrl(`http://${text}`);
  if (WWW_PATTERN.test(text) || BARE_PATTERN.test(text)) {
    return toHttpUrl(`https://${text}`);
  }
  return null;
}
