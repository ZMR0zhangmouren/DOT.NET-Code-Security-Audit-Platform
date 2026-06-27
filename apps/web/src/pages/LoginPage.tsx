import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
    role: 'admin' | 'auditor' | 'developer' | 'viewer';
  };
}

/**
 * §9 路由 /login —— MVP 可用版
 *
 * 默认账号:`admin` / `admin123`(`pnpm --filter @platform/api seed` 写入)
 * §6.2 要求首次登录后改密码,留 Phase 2 接。
 */
export default function LoginPage(): React.ReactElement {
  const [usernameOrEmail, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail, password }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as LoginResponse;
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-12">
      <header className="text-center">
        <h1 className="text-3xl font-bold">登录</h1>
        <p className="mt-2 text-sm text-muted-foreground">本平台仅限授权代码审计使用</p>
      </header>

      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">用户名 / 邮箱</span>
          <input
            type="text"
            value={usernameOrEmail}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            autoComplete="username"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            autoComplete="current-password"
            required
          />
        </label>

        {err && (
          <p className="text-sm text-destructive" role="alert">
            登录失败:{err}
          </p>
        )}

        <Button type="submit" disabled={loading} data-testid="login-submit">
          {loading ? '登录中...' : '登录'}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        默认账号 <code className="font-mono">admin / admin123</code>(首次登录后需改密码,§6.2)
      </p>

      <Link to="/" className="text-sm text-muted-foreground underline">
        返回首页
      </Link>
    </main>
  );
}
