import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// §6.2 AuthController 单测:
// - login → 调 auth.login
// - me → 调 auth.getMe;user 不存在 → 404
// - changePassword → 调 auth.changePassword

interface FakeAuthService {
  login: ReturnType<typeof vi.fn>;
  getMe: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
}

function makeAuth(): FakeAuthService {
  return {
    login: vi.fn(),
    getMe: vi.fn(),
    changePassword: vi.fn(),
  };
}

describe('AuthController (§6.2)', () => {
  let auth: FakeAuthService;

  beforeEach(() => {
    auth = makeAuth();
  });

  it('login → 委托给 auth.login(usernameOrEmail, password)', async () => {
    auth.login.mockResolvedValue({ accessToken: 'jwt.x', user: { id: 'u1' } });
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    const r = await c.login({ usernameOrEmail: 'alice', password: 'pw' } as never);
    expect(auth.login).toHaveBeenCalledWith('alice', 'pw');
    expect(r).toEqual({ accessToken: 'jwt.x', user: { id: 'u1' } });
  });

  it('me → user=null → UnauthorizedException', async () => {
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    await expect(c.me(null as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.getMe).not.toHaveBeenCalled();
  });

  it('me → auth.getMe 返回 null → NotFoundException', async () => {
    auth.getMe.mockResolvedValue(null);
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    await expect(c.me({ sub: 'u1' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('me → auth.getMe 返回 user → 返回 user', async () => {
    auth.getMe.mockResolvedValue({ id: 'u1', username: 'alice' });
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    const r = await c.me({ sub: 'u1' } as never);
    expect(r).toEqual({ id: 'u1', username: 'alice' });
    expect(auth.getMe).toHaveBeenCalledWith('u1');
  });

  it('changePassword → user=null → UnauthorizedException', async () => {
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    await expect(
      c.changePassword(null as never, { oldPassword: 'a', newPassword: 'b1c2d3e4' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('changePassword → 缺 oldPassword/newPassword → 委托给 service(让其抛 BadRequest)', async () => {
    auth.changePassword.mockResolvedValue({ ok: true });
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    const r = await c.changePassword(
      { sub: 'u1' } as never,
      { oldPassword: '', newPassword: '' } as never,
    );
    expect(auth.changePassword).toHaveBeenCalledWith('u1', '', '');
    expect(r).toEqual({ ok: true });
  });

  it('changePassword → 正常 → 调 service', async () => {
    auth.changePassword.mockResolvedValue({ ok: true });
    const mod = await import('./auth.controller.js');
    const c = new mod.AuthController(auth as never);
    const r = await c.changePassword(
      { sub: 'u1' } as never,
      { oldPassword: 'oldA1', newPassword: 'newB2c3' } as never,
    );
    expect(auth.changePassword).toHaveBeenCalledWith('u1', 'oldA1', 'newB2c3');
    expect(r).toEqual({ ok: true });
  });
});
