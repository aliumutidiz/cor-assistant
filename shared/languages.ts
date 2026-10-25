import { z } from 'zod';
/** BCP 47 preferences are independent of UI translations and model providers. */
export const replyLanguage = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,5}$/)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, 'Use a valid language tag, such as en, de or pt-BR.');
export function canonicalLanguage(value: string) {
  return Intl.getCanonicalLocales(value)[0];
}
export function baseLanguage(value: string) {
  try {
    return new Intl.Locale(value).language;
  } catch {
    return 'en';
  }
}
export const commonReplyLanguages = [
  ['en', 'English'],
  ['tr', 'Türkçe'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['pt-BR', 'Português (Brasil)'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['uk', 'Українська'],
  ['ru', 'Русский'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
  ['zh-Hans', '简体中文'],
  ['zh-Hant', '繁體中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['id', 'Bahasa Indonesia'],
  ['sv', 'Svenska'],
  ['el', 'Ελληνικά'],
  ['he', 'עברית'],
  ['fa', 'فارسی'],
  ['vi', 'Tiếng Việt'],
] as const;
