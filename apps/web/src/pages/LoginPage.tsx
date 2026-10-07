import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { Button, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

const DEMO_ACCOUNTS = [
  { email: 'admin@acme.test', role: 'Admin — prompts, routing, budgets' },
  { email: 'rep@acme.test', role: 'Sales rep — contacts and approvals' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@acme.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/contacts';
  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">AgentOps</h1>
            <p className="text-sm text-muted">AI agents for the Acme sales CRM</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-surface p-6">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy} className="w-full">
            Sign in
          </Button>
        </form>
        <div className="mt-5 text-xs text-muted">
          <p className="mb-2">
            Demo accounts (password <span className="font-mono text-ink">password123</span>):
          </p>
          <ul className="space-y-1">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="font-mono text-accent hover:underline"
                  onClick={() => setEmail(a.email)}
                >
                  {a.email}
                </button>{' '}
                — {a.role}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
