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

/**
 * §5.7 /admin/users —— 用户管理(仅 admin)
 *
 * MVP 行为:列用户 + 新建用户 + 行内启停/改 role
 * Phase 2:加搜索、分页、改密码、角色权限矩阵
 */
export default function UsersPage(): React.ReactElement {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // 新建表单
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<User['role']>('developer');
  const [creating, setCreating] = useState(false);

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

  async function onCreate(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await api.post('/users', {
        username,
        email,
        password,
        displayName: displayName.trim() || undefined,
        role,
      });
      setShowNew(false);
      setUsername('');
      setEmail('');
      setPassword('');
      setDisplayName('');
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setCreating(false);
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
          <Button onClick={() => setShowNew((v) => !v)} data-testid="users-new">
            + New User
          </Button>
        </div>
      </header>

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {showNew && (
        <form
          onSubmit={(e) => {
            void onCreate(e);
          }}
          className="mb-4 rounded-lg border bg-card p-4"
        >
          <h2 className="mb-3 text-lg font-semibold">New User</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Username *</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={64}
                className="rounded-md border border-input bg-background px-3 py-2"
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
              <span className="text-muted-foreground">Password *</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowNew(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating} data-testid="users-create">
              {creating ? 'Creating...' : 'Create'}
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
                <td className="p-2">
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
