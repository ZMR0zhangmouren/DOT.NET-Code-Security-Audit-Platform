import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

type ProjectMemberRole = 'lead' | 'contributor' | 'viewer';

interface ProjectMember {
  userId: string;
  username: string;
  email: string;
  displayName: string | null;
  projectRole: ProjectMemberRole;
  grantedBy: string;
  grantedAt: number;
}

interface ProjectMembersSectionProps {
  projectId: string;
  members: ProjectMember[];
  loading: boolean;
  showAdd: boolean;
  onShowAdd: () => void;
  onCancelAdd: () => void;
  onAdded: () => void;
  onRoleChange: (userId: string, newRole: ProjectMemberRole) => Promise<void> | void;
  onRevoke: (userId: string, username: string) => Promise<void> | void;
  // §4.2.8 — 搜索/过滤(可选,父组件控制 state)
  search?: string;
  onSearchChange?: (v: string) => void;
}

/**
 * §4.2.8 ProjectMember 管理 —— 项目详情页 Members tab 的内容
 *
 * MVP:权限(只有 owner 或 lead 才能 grant/update/revoke)在后端 assertCanManage 校验,
 * 这里所有按钮始终渲染,后端 403 时由父组件 setErr 显示。
 */
export default function ProjectMembersSection({
  projectId,
  members,
  loading,
  showAdd,
  onShowAdd,
  onCancelAdd,
  onAdded,
  onRoleChange,
  onRevoke,
  search,
  onSearchChange,
}: ProjectMembersSectionProps): React.ReactElement {
  // §4.2.8 —— 客户端过滤(username / displayName / email / role 子串匹配,大小写不敏感)
  const q = (search ?? '').trim().toLowerCase();
  const filtered = q
    ? members.filter((m) => {
        const haystack = [m.username, m.displayName ?? '', m.email, m.projectRole]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
    : members;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Members</h2>
        <span className="text-xs text-muted-foreground">
          {q ? `${filtered.length} / ${members.length} members` : `${members.length} members`}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <input
            value={search ?? ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="搜索 username / email / role..."
            className="rounded-md border border-input bg-background px-3 py-1 text-xs"
            data-testid="members-search"
          />
          <Button
            variant="outline"
            onClick={() => {
              void onAdded();
            }}
            data-testid="members-refresh"
            type="button"
          >
            Refresh
          </Button>
          <Button onClick={onShowAdd} data-testid="members-add-toggle" type="button">
            + Add Member
          </Button>
        </div>
      </div>

      {showAdd && (
        <AddMemberForm projectId={projectId} onCancel={onCancelAdd} onCreated={onAdded} />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading members...</p>
      ) : members.length === 0 ? (
        <div
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="members-empty"
        >
          还没有成员 —— 点 &quot;+ Add Member&quot; 把项目成员拉进来(角色:lead / contributor /
          viewer)。
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="members-empty-filtered"
        >
          没有匹配 &quot;{search}&quot; 的成员 —— 清空搜索框看全部。
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border bg-card text-sm"
          data-testid="members-table-wrap"
        >
          <table className="w-full" data-testid="members-table">
            <thead>
              <tr className="border-b bg-muted text-left">
                <th className="p-2">Username</th>
                <th className="p-2">Display Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Role</th>
                <th className="p-2">Granted By</th>
                <th className="p-2">Granted At</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.userId} className="border-b last:border-0" data-testid="members-row">
                  <td className="p-2 font-mono text-xs">{m.username}</td>
                  <td className="p-2">{m.displayName ?? '—'}</td>
                  <td className="p-2 text-xs text-muted-foreground">{m.email}</td>
                  <td className="p-2">
                    <select
                      value={m.projectRole}
                      onChange={(e) => {
                        void onRoleChange(m.userId, e.target.value as ProjectMemberRole);
                      }}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      data-testid="members-role-select"
                    >
                      <option value="lead">lead</option>
                      <option value="contributor">contributor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td className="p-2 font-mono text-xs">{m.grantedBy}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(m.grantedAt).toLocaleString()}
                  </td>
                  <td className="p-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        void onRevoke(m.userId, m.username);
                      }}
                      data-testid="members-revoke"
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AddMemberForm —— 内部子组件
// ────────────────────────────────────────────────────────────────────────────

interface AddMemberFormProps {
  projectId: string;
  onCancel: () => void;
  onCreated: () => void;
}

function AddMemberForm({ projectId, onCancel, onCreated }: AddMemberFormProps): React.ReactElement {
  const [username, setUsername] = useState('');
  const [projectRole, setProjectRole] = useState<ProjectMemberRole>('contributor');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!username.trim()) {
      setErr('username 必填');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/projects/${projectId}/members`, {
        username: username.trim(),
        projectRole,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="rounded-lg border bg-card p-4"
      data-testid="members-add-form"
    >
      <h3 className="mb-3 text-sm font-semibold">Add Member</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="text-muted-foreground">Username *</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="rounded-md border border-input bg-background px-3 py-2"
            data-testid="members-add-username"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Role</span>
          <select
            value={projectRole}
            onChange={(e) => setProjectRole(e.target.value as ProjectMemberRole)}
            className="rounded-md border border-input bg-background px-3 py-2"
            data-testid="members-add-role"
          >
            <option value="lead">lead</option>
            <option value="contributor">contributor</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
      </div>

      {err && (
        <p className="mt-3 text-sm text-destructive" role="alert" data-testid="members-add-error">
          {err}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} data-testid="members-add-submit">
          {submitting ? 'Adding...' : 'Add Member'}
        </Button>
      </div>
    </form>
  );
}
