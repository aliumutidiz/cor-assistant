import { useEffect } from 'react';
import { CheckCircle, Clock, WarningCircle, X } from '@phosphor-icons/react';
import type { Operation } from '../shared/contracts';
const labels: Record<string, string> = {
  queued: 'Change queued',
  running: 'Applying change…',
  succeeded: 'Changes saved',
  awaiting_approval: 'Review required',
  failed: 'Change failed',
  unknown: 'Result not confirmed',
  canceled: 'Change canceled',
};
export function OperationFeedback({
  operation,
  onDismiss,
  onActivity,
}: {
  operation: Operation;
  onDismiss: () => void;
  onActivity: () => void;
}) {
  useEffect(() => {
    if (operation.status !== 'succeeded' && operation.status !== 'canceled') return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [operation.id, operation.status, onDismiss]);
  const bad = operation.status === 'failed' || operation.status === 'unknown';
  const Icon = bad ? WarningCircle : operation.status === 'succeeded' ? CheckCircle : Clock;
  const detail = bad
    ? (operation.error ?? 'Check Activity before trying the change again.')
    : operation.status === 'awaiting_approval'
      ? 'Review the preview in Activity before applying it.'
      : ['queued', 'running'].includes(operation.status)
        ? 'You can keep working. Activity will show the confirmed result.'
        : operation.preview?.title;
  return (
    <section
      className={'operation-feedback' + (bad ? ' is-error' : '')}
      role={bad ? 'alert' : 'status'}
      aria-live={bad ? 'assertive' : 'polite'}
    >
      <Icon size={22} aria-hidden />
      <div>
        <strong>{labels[operation.status] ?? operation.status}</strong>
        {detail && <p>{detail}</p>}
        <button className="text-button" onClick={onActivity}>
          View activity
        </button>
      </div>
      <button className="icon-button" aria-label="Dismiss action status" onClick={onDismiss}>
        <X size={18} />
      </button>
    </section>
  );
}
