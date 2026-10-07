import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useApprovals } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  badge?: ReactNode;
}

export function Layout() {
  const { user, logout } = useAuth();
  const pending = useApprovals('pending', true);
  const pendingCount = pending.data?.length ?? 0;
  const isAdmin = user?.role === 'admin';

  const work: NavItem[] = [
    { to: '/contacts', label: 'Contacts' },
    { to: '/pipeline', label: 'Pipeline' },
    {
      to: '/approvals',
      label: 'Approvals',
      badge: pendingCount > 0 && (
        <span className="ml-auto rounded-full bg-pending px-1.5 font-mono text-[11px] leading-[18px] text-paper">
          {pendingCount}
        </span>
      ),
    },
  ];
  const ai: NavItem[] = [
    { to: '/runs', label: 'Runs' },
    { to: '/ops', label: 'Ops dashboard' },
  ];
  const admin: NavItem[] = [
    { to: '/prompts', label: 'Prompts' },
    { to: '/agents', label: 'Agents & routing' },
  ];

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="flex flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div className="leading-tight">
            <div className="font-display text-[17px] font-bold tracking-[-0.01em]">AgentOps</div>
            <div className="text-[11px] text-muted">Acme sales CRM</div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="ml-auto text-xs font-medium text-accent hover:underline md:hidden"
          >
            Sign out
          </button>
        </div>
        <nav
          aria-label="Main"
          className="flex gap-4 overflow-x-auto px-3 pb-3 md:block md:flex-1 md:space-y-5 md:overflow-y-auto"
        >
          <NavGroup label="Sales" items={work} />
          <NavGroup label="AI" items={ai} />
          {isAdmin && <NavGroup label="Admin" items={admin} />}
        </nav>
        {user && (
          <div className="hidden border-t border-line px-5 py-4 md:block">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted">
              {user.email} · {user.role}
            </div>
            <button
              type="button"
              onClick={logout}
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="shrink-0">
      <div className="hidden px-2 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase md:block">
        {label}
      </div>
      <ul className="flex gap-1 md:block md:space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-sm',
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-sunken hover:text-ink',
                )
              }
            >
              {item.label}
              {item.badge}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
