/** Formatting helpers. Every number on screen goes through one of these. */

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Single LLM calls cost fractions of a cent; show enough digits to tell them apart.
  const digits = abs === 0 || abs >= 0.1 ? 2 : abs < 0.01 ? 4 : 3;
  const text = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? '-' : ''}$${text}`;
}

export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.round((now.getTime() - then) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86_400)} d ago`;
}

/** Strips the provider prefix: "anthropic:claude-haiku-4-5" → "claude-haiku-4-5". */
/** Drop the provider prefix for display, but keep `mock:` so simulated calls are never mistaken for real ones. */
export function shortModel(id: string): string {
  if (id.startsWith('mock:')) return id;
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(i + 1);
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function humanize(value: string): string {
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
