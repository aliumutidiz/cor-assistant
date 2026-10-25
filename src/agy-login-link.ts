export function agyLoginLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    if (
      ![
        'accounts.google.com',
        'antigravity.google.com',
        'antigravity.google',
        'www.antigravity.google',
      ].includes(url.hostname)
    )
      return;
    return url.toString();
  } catch {
    return;
  }
}
