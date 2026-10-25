import type { Operation } from './contracts.js';

export function operationMessage(op: Operation, timeZone = 'Europe/Istanbul', language = 'tr') {
  if (language !== 'tr') return englishOperationMessage(op, timeZone);
  const a = op.action;
  const event = 'scope' in a ? a.event : undefined;
  const title = (event?.summary ?? ('routine' in a ? a.routine?.name : undefined))?.replace(
    /([\\`*_[\]<>])/g,
    '\\$1',
  );
  const memory = 'record' in a ? a.record : undefined;
  let details = title
    ? `“${title}”`
    : memory
      ? `“${memory.title.replace(/([\\`*_[\]<>])/g, '\\$1')}”\n${memory.body.replace(/([\\`*_[\]<>])/g, '\\$1')}`
      : op.preview
        ? `“${op.preview.title.replace(/([\\`*_[\]<>])/g, '\\$1')}”`
        : 'İşlem';
  if ('reminder' in a) {
    const result = op.result as { remindAt?: string | null } | undefined;
    const at = result?.remindAt ?? a.reminder.remindAt;
    details = `“${a.reminder.title.replace(/([\\`*_[\]<>])/g, '\\$1')}”`;
    if (at)
      details +=
        '\n' +
        new Intl.DateTimeFormat('tr-TR', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(
          new Date(at),
        );
    else if (a.reminder.event) details += `\nEtkinlikten ${a.reminder.event.minutesBefore} dakika önce`;
    if (!a.reminder.enabled) details += '\nDuraklatıldı; etkinleştirene kadar gönderilmeyecek.';
  }
  if (event?.start.dateTime && event.end.dateTime) {
    const start = new Date(event.start.dateTime),
      end = new Date(event.end.dateTime);
    const date = new Intl.DateTimeFormat('tr-TR', { timeZone, dateStyle: 'full' });
    const time = new Intl.DateTimeFormat('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });
    details += `\n${date.format(start)} · ${time.format(start)} – ${date.format(end) === date.format(start) ? '' : date.format(end) + ' · '}${time.format(end)}`;
  } else if (event?.start.date) details += `\n${event.start.date} · tüm gün`;
  if (memory?.kind === 'task')
    details += memory.remindAt
      ? '\nHatırlatma: ' +
        new Intl.DateTimeFormat('tr-TR', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(
          new Date(memory.remindAt),
        )
      : '\nHatırlatma saati belirlenmedi; görev listende tutuyorum.';
  if (op.status === 'awaiting_approval')
    return `${details}\nOnayın gerekiyor; henüz uygulanmadı. İşlem geçmişinden onaylayabilir veya iptal edebilirsin.`;
  if (op.status === 'failed')
    return `${details}\nİşlem uygulanamadı: ${op.error ?? 'Bağlantıyı kontrol edip yeniden dene.'}`;
  if (op.status === 'unknown')
    return `${details}\nİşlemin sonucu doğrulanamadı. Tekrar göndermeden önce Google Takvim’i ve işlem geçmişini kontrol et.`;
  if (op.status === 'canceled') return `${details}\nİşlem iptal edildi.`;
  if (op.status !== 'succeeded')
    return `${details}\nİşlem ${op.status === 'running' ? 'uygulanıyor' : 'sırada'}; henüz tamamlandığı doğrulanmadı. Sonucu işlem geçmişinden takip edebilirsin.`;
  const outcomes: Record<string, string> = {
    'event.create': 'Takvimine ekledim.',
    'reminder.create': 'Hatırlatmayı kurdum. Zamanı geldiğinde Telegram’dan haber vereceğim.',
    'reminder.update': 'Hatırlatmayı güncelledim.',
    'reminder.cancel': 'Hatırlatmayı iptal ettim; gönderilmeyecek.',
    'event.update': 'Takviminde güncelledim.',
    'event.delete': 'Takviminden sildim.',
    'event.move': 'Hedef takvime taşıdım.',
    'event.respond': 'Katılım yanıtını kaydettim.',
    'routine.create': 'Rutini oluşturdum.',
    'routine.update': 'Rutini güncelledim.',
    'routine.delete': 'Rutini sildim.',
    'routine.run': 'Rutini çalıştırmak için sıraya aldım; henüz tamamlanmadı.',
    'preferences.update': 'Tercihlerini kaydettim.',
    'memory.create':
      memory?.kind === 'task'
        ? 'Görev listene kaydettim.'
        : 'Kişisel hafızana kaydettim. Kayıtlarım ekranından ayrıntıları görebilirsin.',
    'memory.update': 'Hafıza kaydını güncelledim; önceki sürüm geçmişte korunuyor.',
    'memory.complete': 'Görevi tamamlandı olarak işaretledim. Açık görevlerden kaldırdım; geçmişi korunuyor.',
    'memory.archive': 'Kaydı arşivledim; aktif hafıza aramalarında kullanmayacağım.',
    'memory.restore': 'Kaydı arşivden geri getirdim.',
  };
  const next = op.result as { nextRun?: string; enabled?: boolean; timeZone?: string } | undefined;
  const schedule =
    a.kind.startsWith('routine.') && next?.nextRun && next.enabled
      ? '\nSonraki çalışma: ' +
        new Intl.DateTimeFormat('tr-TR', {
          timeZone: next.timeZone ?? timeZone,
          dateStyle: 'full',
          timeStyle: 'short',
        }).format(new Date(next.nextRun))
      : '';
  const alert =
    'scope' in a && typeof a.telegramReminderMinutes === 'number'
      ? '\nTelegram hatırlatması: ' +
        (a.telegramReminderMinutes === 0 ? 'başlangıçta' : `${a.telegramReminderMinutes} dakika önce`) +
        '.'
      : '';
  return `${details}\n${outcomes[a.kind] ?? 'İşlemi tamamladım.'}${schedule}${alert}`;
}

function englishOperationMessage(op: Operation, timeZone: string) {
  const action = op.action;
  const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
  const event = 'event' in action ? action.event : undefined;
  const record = 'record' in action ? action.record : undefined;
  const reminder = 'reminder' in action ? action.reminder : undefined;
  const title =
    event?.summary ??
    record?.title ??
    reminder?.title ??
    ('routine' in action ? action.routine?.name : undefined) ??
    op.preview?.title ??
    'Action';
  let details = '“' + escape(title) + '”';
  const at = event?.start.dateTime ?? reminder?.remindAt ?? record?.remindAt;
  if (at)
    details +=
      '\n' +
      new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(
        new Date(at),
      );
  if (event?.start.dateTime && event.end.dateTime) {
    const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
    details +=
      '\n' + time.format(new Date(event.start.dateTime)) + ' – ' + time.format(new Date(event.end.dateTime));
  }
  if (event?.start.date) details += '\n' + event.start.date + ' · all day';
  if (op.status === 'awaiting_approval')
    return (
      details + '\nYour approval is needed. Nothing has been applied yet; review the action in Activity.'
    );
  if (op.status === 'failed')
    return details + '\nThe action failed: ' + (op.error ?? 'Check the connection and retry.');
  if (op.status === 'unknown')
    return (
      details + '\nThe result could not be verified. Check your calendar and Activity before resubmitting.'
    );
  if (op.status === 'canceled') return details + '\nAction canceled.';
  if (op.status !== 'succeeded')
    return (
      details +
      '\nThe action is ' +
      (op.status === 'running' ? 'running' : 'queued') +
      '. Completion has not been confirmed.'
    );
  const outcomes: Record<string, string> = {
    'event.create': 'Added to your calendar.',
    'event.update': 'Updated in your calendar.',
    'event.delete': 'Deleted from your calendar.',
    'event.move': 'Moved to the destination calendar.',
    'event.respond': 'Saved your invitation response.',
    'routine.create': 'Created your routine.',
    'routine.update': 'Updated your routine.',
    'routine.delete': 'Deleted your routine.',
    'routine.run': 'Queued the routine. It has not finished yet.',
    'reminder.create': 'Set your reminder. Delivery uses Telegram when connected.',
    'reminder.update': 'Updated your reminder.',
    'reminder.cancel': 'Canceled your reminder.',
    'preferences.update': 'Saved your preferences.',
    'memory.create': 'Saved to your personal memory.',
    'memory.update': 'Updated your memory record; the previous version is preserved.',
    'memory.complete': 'Marked the task complete; history is preserved.',
    'memory.archive': 'Archived the record.',
    'memory.restore': 'Restored the record.',
  };
  const alert =
    'telegramReminderMinutes' in action && typeof action.telegramReminderMinutes === 'number'
      ? '\nTelegram reminder: ' + action.telegramReminderMinutes + ' minutes before.'
      : '';
  const next = op.result as { nextRun?: string; enabled?: boolean; timeZone?: string } | undefined;
  const schedule =
    action.kind.startsWith('routine.') && next?.nextRun && next.enabled
      ? '\nNext run: ' +
        new Intl.DateTimeFormat('en-GB', {
          timeZone: next.timeZone ?? timeZone,
          dateStyle: 'full',
          timeStyle: 'short',
        }).format(new Date(next.nextRun))
      : '';
  return details + '\n' + (outcomes[action.kind] ?? 'Completed the action.') + schedule + alert;
}
