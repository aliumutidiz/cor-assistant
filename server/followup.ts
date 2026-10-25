import type { SkillGroup } from '../shared/contracts.js';

export type PendingClarification = {
  group: SkillGroup;
  request: string;
  question: string;
  createdAt: string;
};

// This resolves conversational references only. It is never operation approval.
export function isClarificationReply(message: string) {
  return /^(?:evet|hayır|hayir|olur|tamam|aynen|doğru|dogru|yes|no|sure|correct|exactly|oui|non|si|sí|ja|nein|sim|não|nao|sì|tak|nie|да|нет|так|ні|نعم|لا|はい|いいえ|네|아니요|是|不是|是的|好|ok|okay|one hour|bir saat|1 saat|1 hour)[.!\s]*$/iu.test(
    message.trim(),
  );
}
export function activeClarification(value: PendingClarification | null | undefined, now = Date.now()) {
  if (!value) return;
  const age = now - Date.parse(value.createdAt);
  return age >= 0 && age < 12 * 3600000 ? value : undefined;
}

export function prohibitsMemoryCapture(message: string) {
  return /(?:kaydetme|saklama|hafızana alma|hatırlama)(?!\p{L})|\b(?:do not|don['’]t|never)\s+(?:save|store|remember|record)\b|\bnicht\s+speichern\b|\bno\s+(?:guardes|recuerdes)\b|\bnão\s+(?:guarde|salve)\b/iu.test(
    message,
  );
}
