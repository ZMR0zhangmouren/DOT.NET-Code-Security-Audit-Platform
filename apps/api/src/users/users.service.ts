import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { desc, eq } from 'drizzle-orm';

import { DATABASE, type Db } from '../db/database.module.js';
import { users } from '../db/schema.js';

export type UserRole = 'admin' | 'auditor' | 'developer' | 'viewer';

export interface UserPublic {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  list(): UserPublic[] {
    const rows = this.db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .all() as unknown as UserRow[];
    return rows.map((r) => this.toPublic(r));
  }

  get(id: string): UserPublic {
    const row = this.db.select().from(users).where(eq(users.id, id)).get() as UserRow | undefined;
    if (!row) throw new NotFoundException(`user ${id} not found`);
    return this.toPublic(row);
  }

  /** 内部:auth.service.ts 用,登录流程查密码 hash */
  getWithHash(id: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get() as UserRow | undefined;
  }

  /** 内部:auth.service.ts 用,按用户名查密码 hash */
  getByUsernameWithHash(username: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.username, username)).get() as
      | UserRow
      | undefined;
  }

  async create(input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
    role: UserRole;
  }): Promise<UserPublic> {
    const existing = this.getByUsernameWithHash(input.username);
    if (existing) throw new NotFoundException(`username ${input.username} already exists`);

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const id = `usr-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const now = Date.now();
    this.db
      .insert(users)
      .values({
        id,
        username: input.username,
        email: input.email,
        displayName: input.displayName ?? null,
        passwordHash,
        role: input.role,
        isActive: true,
        createdAt: now,
      })
      .run();
    return this.get(id);
  }

  update(
    id: string,
    patch: Partial<{
      email: string;
      displayName: string;
      role: UserRole;
      isActive: boolean;
    }>,
  ): UserPublic {
    const existing = this.get(id);
    const update: Partial<UserRow> = {};
    if (patch.email !== undefined) update.email = patch.email;
    if (patch.displayName !== undefined) update.displayName = patch.displayName;
    if (patch.role !== undefined) update.role = patch.role;
    if (patch.isActive !== undefined) update.isActive = patch.isActive;
    this.db.update(users).set(update).where(eq(users.id, id)).run();
    return this.get(existing.id);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const result = this.db.update(users).set({ passwordHash }).where(eq(users.id, id)).run();
    if (result.changes === 0) throw new NotFoundException(`user ${id} not found`);
  }

  private toPublic(r: UserRow): UserPublic {
    return {
      id: r.id,
      username: r.username,
      email: r.email,
      displayName: r.displayName,
      role: r.role,
      isActive: r.isActive,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLoginAt,
    };
  }
}

import { randomBytes } from 'node:crypto';
