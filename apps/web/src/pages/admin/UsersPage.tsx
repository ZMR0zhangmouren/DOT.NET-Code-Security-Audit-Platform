import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface User {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'auditor' | 'developer' | 'viewer';
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

type Mode = { kind: 'create' } | { kind: 'edit'; user: User };

/**
 * §5.7 /admin/users —— 用户管理(仅 admin)
 *
 * MVP 行为:列用户 + 新建/编辑 + 行内启停/改 role + 重置密码
 */
export default function UsersPage(): React.ReactElement {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  // 新建/编辑 共用表单字段
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<User['role']>('developer');
  const [saving, setSaving] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<User[]>('/users');
      setUsers(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function openCreate(): void {
    setMode({ kind: 'create' });
    setUsername('');
    setEmail('');
    setPassword('');
    setDisplayName('');
    setRole('developer');
  }

  function openEdit(u: User): void {
    setMode({ kind: 'edit', user: u });
    setUsername(u.username);
    setEmail(u.email);
    setPassword(''); // 不回显
    setDisplayName(u.displayName ?? '');
    setRole(u.role);
  }

  function close(): void {
    setMode(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!mode) return;
    setSaving(true);
    setErr(null);
    try {
      if (mode.kind === 'create') {
        await api.post('/users', {
          username,
          email,
          password,
          displayName: displayName.trim() || undefined,
          role,
        });
      } else {
        // 编辑:email / displayName / role / password(选填)
        const patch: Record<string, unknown> = {
          email,
          displayName: displayName.trim() || null,
          role,
        };
        await api.patch(`/users/${mode.user.id}`, patch);
        if (password) {
          await api.patch(`/users/${mode.user.id}/password`, { password });
        }
      }
      close();
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: User): Promise<void> {
    try {
      await api.patch(`/users/${u.id}`, { isActive: !u.isActive });
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function changeRole(u: User, newRole: User['role']): Promise<void> {
    if (u.role === newRole) return;
    try {
      await api.patch(`/users/${u.id}`, { role: newRole });
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <main className="container py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Section 5.7 - user management (admin only)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refresh()} data-testid="users-refresh">
            Refresh
          </Button>
          <Button onClick={() => openCreate()} data-testid="users-new">
            + New User
          </Button>
        </div>
      </header>

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {mode && (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          className="mb-4 rounded-lg border bg-card p-4"
        >
          <h2 className="mb-3 text-lg font-semibold">
            {mode.kind === 'create' ? 'New User' : `Edit: ${mode.user.username}`}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Username *</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={64}
                disabled={mode.kind === 'edit'}
                className="rounded-md border border-input bg-background px-3 py-2 disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                Password {mode.kind === 'edit' && '(leave blank to keep current)'}
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...(mode.kind === 'create' ? { required: true, minLength: 8 } : { minLength: 8 })}
                placeholder={mode.kind === 'edit' ? 'Reset to new value' : ''}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Role *</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as User['role'])}
                className="rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="admin">admin</option>
                <option value="auditor">auditor</option>
                <option value="developer">developer</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              data-testid={mode.kind === 'create' ? 'users-create' : 'users-save'}
            >
              {saving ? 'Saving...' : mode.kind === 'create' ? 'Create' : 'Save'}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : users.length === 0 ? (
        <p
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="users-empty"
        >
          No users yet.
        </p>
      ) : (
        <table className="w-full rounded-lg border bg-card text-sm" data-testid="users-table">
          <thead>
            <tr className="border-b bg-muted text-left">
              <th className="p-2">Username</th>
              <th className="p-2">Email</th>
              <th className="p-2">Role</th>
              <th className="p-2">Active</th>
              <th className="p-2">Created</th>
              <th className="p-2">Last login</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b" data-testid="user-row">
                <td className="p-2 font-mono">{u.username}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">
                  <select
                    value={u.role}
                    onChange={(e) => {
                      void changeRole(u, e.target.value as User['role']);
                    }}
                    className="rounded border border-input bg-background px-2 py-1 text-xs"
                  >
                    <option value="admin">admin</option>
                    <option value="auditor">auditor</option>
                    <option value="developer">developer</option>
                    <option value="viewer">viewer</option>
                  </select>
                </td>
                <td className="p-2">
                  <span
                    className={
                      u.isActive
                        ? 'rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground'
                        : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                    }
                  >
                    {u.isActive ? 'yes' : 'no'}
                  </span>
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '-'}
                </td>
                <td className="p-2 space-x-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      openEdit(u);
                    }}
                    data-testid="user-edit"
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant={u.isActive ? 'outline' : 'default'}
                    onClick={() => {
                      void toggleActive(u);
                    }}
                    data-testid="user-toggle"
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
