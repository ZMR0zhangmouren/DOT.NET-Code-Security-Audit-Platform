import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * §9 路由 /login —— 管理员邀请制登录(Phase 2 接入 AuthModule 后接 POST /auth/login)
 */
export default function LoginPage(): React.ReactElement {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-12">
      <header className="text-center">
        <h1 className="text-3xl font-bold">登录</h1>
        <p className="mt-2 text-sm text-muted-foreground">本平台仅限授权代码审计使用</p>
      </header>
      <form className="flex w-full max-w-sm flex-col gap-3">
        <input
          type="text"
          placeholder="用户名"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled
        />
        <input
          type="password"
          placeholder="密码"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled
        />
        <Button type="button" disabled>
          登录(Phase 2 接入 AuthModule)
        </Button>
      </form>
      <Link to="/" className="text-sm text-muted-foreground underline">
        返回首页
      </Link>
    </main>
  );
}
