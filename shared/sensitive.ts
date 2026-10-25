export function containsCredential(text: string) {
  return /(?:GOCSPX-|-----BEGIN [\w ]*PRIVATE KEY-----|AIza[\w-]{25,}|AQ\.[\w-]{30,}|\b\d{7,12}:[\w-]{30,})/.test(
    text,
  );
}

export function redactCredentials(text: string) {
  return text.replace(
    /(?:GOCSPX-[A-Za-z0-9_-]+|-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?(?:-----END [\w ]*PRIVATE KEY-----|$)|AIza[\w-]{25,}|AQ\.[\w-]{30,}|\b\d{7,12}:[\w-]{30,})/g,
    '[Sensitive content omitted]',
  );
}
