import { humanize } from '../lib/format';
import { cx } from './ui';

type Tone = 'ok' | 'pending' | 'bad' | 'info' | 'neutral' | 'accent';

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  pending: 'bg-pending-soft text-pending',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-sunken text-muted',
};

/** Maps every status string the gateway emits to one tone. Amber always means "a human is needed". */
const STATUS_TONE: Record<string, Tone> = {
  completed: 'ok',
  executed: 'ok',
  approved: 'ok',
  ok: 'ok',
  won: 'ok',
  awaiting_approval: 'pending',
  pending_approval: 'pending',
  pending: 'pending',
  waiting: 'pending',
  soft: 'pending',
  running: 'info',
  qualified: 'info',
  proposal: 'accent',
  failed: 'bad',
  error: 'bad',
  rejected: 'bad',
  invalid_args: 'bad',
  hard: 'bad',
  lost: 'neutral',
  lead: 'neutral',
  skipped: 'neutral',
  cancelled: 'neutral',
};

const LABELS: Record<string, string> = {
  awaiting_approval: 'Needs approval',
  pending_approval: 'Needs approval',
  ok: 'OK',
  soft: 'Soft limit',
  hard: 'Over budget',
};

export function StatusBadge({ status, tone, label }: { status: string; tone?: Tone; label?: string }) {
  const t = tone ?? STATUS_TONE[status] ?? 'neutral';
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium',
        TONES[t],
      )}
    >
      <span
        aria-hidden
        className={cx('size-1.5 rounded-full bg-current', status === 'running' && 'animate-pulse')}
      />
      {label ?? LABELS[status] ?? humanize(status)}
    </span>
  );
}
