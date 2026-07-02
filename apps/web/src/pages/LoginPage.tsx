import { Loader2, Shield } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';

/**
 * §9 路由 /login —— 靛蓝渐变背景 + 毛玻璃登录卡片
 *
 * 默认账号:`admin` / `admin123`(pnpm --filter @platform/api seed 写入)
 * §6.2 首次登录后改密码。
 *
 * 安全:使用 useAuth().login() → accessToken 存内存 + refreshToken 走 HttpOnly Cookie
 */
export default function LoginPage(): React.ReactElement {
  const { login: doLogin } = useAuth();
  const [usernameOrEmail, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      await doLogin(usernameOrEmail, password);
      toast.success(`欢迎，${usernameOrEmail}`);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(`登录失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* 装饰性渐变背景 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-1/4 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-primary/8 blur-2xl" />
      </div>

      {/* 登录卡片 */}
      <Card className="relative z-10 w-full max-w-[400px] glass-card shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">CodeSec Audit</CardTitle>
          <CardDescription>AI 驱动的代码安全审计平台</CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={(e) => {
              void onSubmit(e);
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-sm text-muted-foreground">
                用户名 / 邮箱
              </label>
              <Input
                id="username"
                type="text"
                value={usernameOrEmail}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm text-muted-foreground">
                密码
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {err && (
              <p className="text-sm text-destructive" role="alert">
                {err}
              </p>
            )}

            <Button type="submit" disabled={loading} data-testid="login-submit" className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            本平台仅限授权代码审计使用
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            默认账号{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">admin / admin123</code>
          </p>

          <div className="mt-4 text-center">
            <Link
              to="/"
              className="text-xs text-muted-foreground hover:text-primary hover:underline"
            >
              返回首页
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
