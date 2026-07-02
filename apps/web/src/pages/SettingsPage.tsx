import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

interface ChangePasswordResponse {
  ok: true;
}

/**
 * §6.2 /me —— 个人中心(MVP 范围:改自己密码)
 *
 * 客户端校验:
 * - 旧/新/确认均必填
 * - 新密码 >= 8 字符(后端再校字母+数字)
 * - 新密码 === 确认密码
 * - 新密码 != 旧密码
 *
 * 后端校验在 POST /api/auth/change-password:
 * - 200 { ok: true } → 提示 + 跳回 / 或强制登出(Phase 2)
 * - 400 / 404 / 401 → 显示 message
 */
export default function SettingsPage(): React.ReactElement {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function clientValidate(): string | null {
    if (!oldPassword) return '请输入旧密码';
    if (!newPassword) return '请输入新密码';
    if (newPassword.length < 8) return '新密码至少 8 字符';
    if (!/[0-9]/.test(newPassword)) return '新密码必须包含至少 1 个数字';
    if (!/[A-Za-z]/.test(newPassword)) return '新密码必须包含至少 1 个字母';
    if (newPassword !== confirmPassword) return '两次输入的新密码不一致';
    if (newPassword === oldPassword) return '新密码必须与旧密码不同';
    return null;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErr(null);
    setOk(false);
    const v = clientValidate();
    if (v) {
      setErr(v);
      return;
    }
    setSaving(true);
    try {
      await api.post<ChangePasswordResponse>('/auth/change-password', {
        oldPassword,
        newPassword,
      });
      setOk(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('密码已修改，请使用新密码重新登录。');
      // 改密后强制重新登录:清 token + 跳 /login
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      navigate('/login');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container max-w-xl py-8">
      <PageHeader title="个人中心" description="§6.2 改自己密码(登录用户)" />

      <Card className="p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">修改密码</h2>
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          className="flex flex-col gap-3"
          data-testid="change-password-form"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">旧密码 *</span>
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              autoComplete="current-password"
              data-testid="cp-old"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">新密码 * (≥8 字符,含字母+数字)</span>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              data-testid="cp-new"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">确认新密码 *</span>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              data-testid="cp-confirm"
            />
          </label>

          {err && (
            <p className="text-sm text-destructive" role="alert" data-testid="cp-error">
              {err}
            </p>
          )}
          {ok && (
            <p className="text-sm text-green-600" role="status" data-testid="cp-ok">
              密码已修改
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Link to="/">
              <Button type="button" variant="outline" disabled={saving}>
                返回
              </Button>
            </Link>
            <Button type="submit" disabled={saving} data-testid="cp-submit">
              {saving ? '保存中...' : '保存新密码'}
            </Button>
          </div>
        </form>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        默认账号首次登录后必须改密码(§6.2)。忘记密码请联系 admin 重置。
      </p>
    </main>
  );
}
