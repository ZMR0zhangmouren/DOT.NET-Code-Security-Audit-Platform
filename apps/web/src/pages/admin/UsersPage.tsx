import { useEffect, useState, type FormEvent } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
      <PageHeader
        title="Users"
        description="Section 5.7 - user management (admin only)"
        actions={[
          { label: 'Refresh', variant: 'outline', onClick: () => void refresh() },
          { label: '+ New User', onClick: () => openCreate() },
        ]}
      />

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="user-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode?.kind === 'create'
                ? 'New User'
                : `Edit: ${mode?.kind === 'edit' ? mode.user.username : ''}`}
            </DialogTitle>
            <DialogDescription>
              {mode?.kind === 'create'
                ? 'Fill in the details to create a new user.'
                : 'Update user details. Leave password blank to keep current.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              void onSubmit(e);
            }}
            data-testid="user-form"
          >
            <div className="grid gap-4 md:grid-cols-2 py-4">
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Username *</span>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={64}
                  disabled={mode?.kind === 'edit'}
                  data-testid="user-username"
                />
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Email *</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="user-email"
                />
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  Password {mode?.kind === 'edit' && '(leave blank to keep current)'}
                </span>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  {...(mode?.kind === 'create'
                    ? { required: true, minLength: 8 }
                    : { minLength: 8 })}
                  placeholder={mode?.kind === 'edit' ? 'Reset to new value' : ''}
                  data-testid="user-password"
                />
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Role *</span>
                <Select value={role} onValueChange={(v) => setRole(v as User['role'])}>
                  <SelectTrigger data-testid="user-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="auditor">auditor</SelectItem>
                    <SelectItem value="developer">developer</SelectItem>
                    <SelectItem value="viewer">viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Display name</span>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  data-testid="user-displayname"
                />
              </div>
            </div>
            {err && (
              <p className="mb-3 text-sm text-destructive" role="alert">
                {err}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={saving}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={saving}
                data-testid={mode?.kind === 'create' ? 'users-create' : 'users-save'}
              >
                {saving ? 'Saving...' : mode?.kind === 'create' ? 'Create' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : users.length === 0 ? (
        <Card className="p-6" data-testid="users-empty">
          <p className="text-sm text-muted-foreground">No users yet.</p>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm" data-testid="users-table">
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
                      <div className="flex items-center gap-2">
                        <StatusBadge label={u.role} variant="info" />
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
                      </div>
                    </td>
                    <td className="p-2">
                      <StatusBadge
                        label={u.isActive ? 'Active' : 'Inactive'}
                        variant={u.isActive ? 'success' : 'default'}
                      />
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
          </CardContent>
        </Card>
      )}
    </main>
  );
}
