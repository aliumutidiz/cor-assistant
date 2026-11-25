export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public uncertain = false,
    public code?: string,
  ) {
    super(message);
  }
}

/** Contract diagnostics for model repair; never include rejected values or provider output. */
export class ModelValidationError extends AppError {
  readonly feedback: { path: string; code: string; rule?: string }[];
  constructor(issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[]) {
    super(502, 'AGY yanıt biçimi doğrulanamadı. Herhangi bir değişiklik uygulanmadı.', false, 'AGY_OUTPUT');
    this.feedback = issues.slice(0, 8).map((issue) => ({
      path: issue.path
        .map((part) =>
          typeof part === 'number'
            ? String(part)
            : /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(String(part))
              ? String(part)
              : 'field',
        )
        .join('.'),
      code: issue.code,
      ...(issue.message === 'Duplicate entry IDs.'
        ? {
            rule: 'Each program entry needs a distinct ID; preserve existing IDs and use separate newProgramEntryIds for new entries.',
          }
        : {}),
    }));
  }
}
