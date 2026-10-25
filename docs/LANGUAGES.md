# Assistant languages

The interface is English. Assistant reply preferences are separate from interface translations, model providers, date interpretation and security policy.

## Choosing a language

In **Settings → Your profile**, use **Assistant reply language**. Suggestions include English, Turkish, German, Spanish, French, Italian, Portuguese/Brazilian Portuguese, Dutch, Polish, Ukrainian, Russian, Arabic, Hindi, Simplified/Traditional Chinese, Japanese, Korean, Indonesian, Swedish, Greek, Hebrew, Persian and Vietnamese.

The list is not an allowlist: a valid BCP 47 tag such as `es-MX`, `en-GB` or `pt-BR` can be saved. Tags are validated and canonicalized. Model fluency varies by provider; accepting a language preference is not a guarantee that every model supports it equally well.

The assistant can save a language preference through the same guarded preferences operation as the settings form. A timezone-only change preserves the current language. The owner supplies preferences; external page and calendar text cannot change them. Missing preferences default to English.

## System receipts

Verified operation outcomes are rendered by application code rather than asking the model to translate a success claim. English and Turkish retain detailed action-specific receipts. German, Spanish, French, Italian, Portuguese, Dutch, Polish, Russian, Ukrainian, Arabic, Japanese, Korean and Chinese have concise status receipts, dates and scheduling information. Queued routine execution is never described as completed. Unknown results explicitly advise checking history before retrying.

Other languages fall back to English for deterministic receipts. Low-level adapter errors and some Telegram command/status screens have legacy wording and are not a complete translation catalog. A reply preference does not change the interface or promise that every system message is translated. No translation API or paid fallback is used. An explicit per-message language request guides model-written prose; deterministic receipts use the saved preference (or the newly saved language after a preference change).

Arabic, Hebrew and other right-to-left message bodies use automatic text direction. The control interface remains left-to-right.

## Retrieval and interpretation

English and Turkish have a small, fully anchored, read-only shortcut for basic calendar questions. It formats answers in the saved English/Turkish language without a model call. Other saved languages use normal skill orchestration for these questions. Extra instructions always bypass the shortcut.

Short clarification replies recognize several common languages. This only continues task details; a normal “yes” never approves a sensitive action. Explicit approvals remain tied to an exact operation hash.

Memory remains provider-independent and queryable in any language. Retrieval is lexical and bounded, not a promise of cross-language semantic translation. Search original records when a fact is not present in the small context hints.
