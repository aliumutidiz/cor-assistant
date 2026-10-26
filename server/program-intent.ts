import { foldMemoryText } from '../shared/memory.js';
/** Conservative capability hints only; never an action, date parser or approval. */
export function prefersProgramCapability(message: string) {
  const text = foldMemoryText(message);
  const namedProgram =
    /ders\s*program|haftalik\s+program|aylik\s+program|class\s+(?:schedule|timetable)|course\s+(?:schedule|timetable)|weekly\s+(?:schedule|timetable)|monthly\s+(?:schedule|timetable)/u.test(
      text,
    );
  const rejectsCalendar =
    /takvim\p{L}*\s+(?:degil|istemiyorum)|(?:not|instead of)\s+(?:the\s+|my\s+)?calendar/u.test(text);
  if (namedProgram && rejectsCalendar) return true;
  const explicitCalendar =
    /takvim\p{L}*.{0,55}(?:ekle|kaydet|olustur|aktar)|(?:ekle|kaydet|olustur|aktar).{0,55}takvim|(?:add|put|create).{0,80}(?:google\s+)?calendar/u.test(
      text,
    );
  if (explicitCalendar) return false;
  if (/rutin|hatirlat|notification|remind|scheduled report/u.test(text)) return false;
  if (namedProgram) return true;
  const weeklyClass =
    /(?:dersim(?:iz)?\s+var|i have.{0,100}(?:class|lecture)|my.{0,100}(?:class|lecture)\s+is)/u.test(text) &&
    /pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|her\s+(?:ay|hafta)|every\s+(?:month|week)/u.test(
      text,
    );
  const oneOff =
    /\byarin\b|\btomorrow\b|\btek sefer|\bone.off\b|\bthis\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bbu\s+(?:pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)|\d{4}-\d{2}-\d{2}/u.test(
      text,
    );
  return weeklyClass && !oneOff;
}

export function correctsCalendarTarget(message: string) {
  const text = foldMemoryText(message);
  return (
    /program|timetable|schedule/u.test(text) &&
    /takvim\p{L}*\s+(?:degil|istemiyorum)|(?:not|instead of)\s+(?:the\s+|my\s+)?calendar/u.test(text)
  );
}
