export function containsCredential(text: string) {
  return /(?:GOCSPX-|-----BEGIN [\w ]*PRIVATE KEY-----|AIza[\w-]{25,}|AQ\.[\w-]{30,}|\b\d{7,12}:[\w-]{30,})/.test(
    text,
  );
}
