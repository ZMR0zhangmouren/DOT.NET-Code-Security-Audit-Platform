import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { decryptSecret, encryptSecret, getMasterKey } from '../common/crypto.util.js';
import { DATABASE, type Db } from '../db/database.module.js';
import { gitCredentials, projects } from '../db/schema.js';

export interface GitCredentialPublic {
  id: string;
  scope: 'system' | 'project';
  projectId: string | null;
  label: string;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username: string | null;
  fingerprint: string; // 末 4 位 / SHA 短摘要
  isActive: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface GitCredentialRow {
  id: string;
  scope: 'system' | 'project';
  projectId: string | null;
  label: string;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username: string | null;
  secretEnc: string;
  fingerprint: string;
  isActive: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * §5.7 Git Credentials —— system/project 双 scope 的 SSH Key + HTTPS Token
 *
 * 加密模式:沿用 aiKeys,secret_enc 用 AES-256-GCM 落盘,前端永不接触明文。
 * fingerprint:展示用(末 4 位 / SHA-256 短摘要),不重复存两次加密。
 */
@Injectable()
export class GitCredentialsService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  list(scope?: 'system' | 'project', projectId?: string): GitCredentialPublic[] {
    let rows: GitCredentialRow[];
    if (scope === 'system') {
      rows = this.db
        .select()
        .from(gitCredentials)
        .where(and(eq(gitCredentials.scope, 'system'), isNull(gitCredentials.projectId)))
        .all() as unknown as GitCredentialRow[];
    } else if (scope === 'project' && projectId) {
      rows = this.db
        .select()
        .from(gitCredentials)
        .where(and(eq(gitCredentials.scope, 'project'), eq(gitCredentials.projectId, projectId)))
        .all() as unknown as GitCredentialRow[];
    } else {
      rows = this.db.select().from(gitCredentials).all() as unknown as GitCredentialRow[];
    }
    return rows.map((r) => this.toPublic(r));
  }

  get(id: string): GitCredentialPublic {
    const row = this.db.select().from(gitCredentials).where(eq(gitCredentials.id, id)).get() as
      | GitCredentialRow
      | undefined;
    if (!row) throw new NotFoundException(`Git credential ${id} not found`);
    return this.toPublic(row);
  }

  /** 解密明文(内部用,如未来 git clone 注入;不要返回给前端) */
  getPlaintext(id: string): string {
    const row = this.db.select().from(gitCredentials).where(eq(gitCredentials.id, id)).get() as
      | GitCredentialRow
      | undefined;
    if (!row) throw new NotFoundException(`Git credential ${id} not found`);
    return decryptSecret(row.secretEnc, getMasterKey());
  }

  create(input: {
    scope: 'system' | 'project';
    projectId?: string | null;
    label: string;
    kind: 'ssh_key' | 'https_token';
    hostPattern: string;
    username?: string | null;
    secret: string;
    isActive?: boolean;
    createdBy: string;
  }): GitCredentialPublic {
    if (input.scope === 'project' && !input.projectId) {
      throw new BadRequestException('projectId is required when scope=project');
    }
    if (input.scope === 'project' && input.projectId) {
      const proj = this.db.select().from(projects).where(eq(projects.id, input.projectId)).get();
      if (!proj) throw new NotFoundException(`Project ${input.projectId} not found`);
    }
    if (input.scope === 'system' && input.projectId) {
      throw new BadRequestException('projectId must be null when scope=system');
    }
    if (!input.label.trim()) throw new BadRequestException('label is required');
    if (!input.hostPattern.trim()) throw new BadRequestException('hostPattern is required');
    if (!input.secret) throw new BadRequestException('secret is required');
    if (input.kind === 'https_token' && !input.username?.trim()) {
      throw new BadRequestException('username is required when kind=https_token');
    }

    const id = `gc-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const enc = encryptSecret(input.secret, getMasterKey());
    const fingerprint = computeFingerprint(input.secret, input.kind);
    const now = Date.now();
    this.db
      .insert(gitCredentials)
      .values({
        id,
        scope: input.scope,
        projectId: input.scope === 'project' ? (input.projectId ?? null) : null,
        label: input.label.trim(),
        kind: input.kind,
        hostPattern: input.hostPattern.trim(),
        username: input.username?.trim() ?? null,
        secretEnc: enc,
        fingerprint,
        isActive: input.isActive ?? true,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.get(id);
  }

  update(
    id: string,
    patch: Partial<{
      label: string;
      hostPattern: string;
      username: string | null;
      secret: string;
      isActive: boolean;
    }>,
  ): GitCredentialPublic {
    const existing = this.db
      .select()
      .from(gitCredentials)
      .where(eq(gitCredentials.id, id))
      .get() as GitCredentialRow | undefined;
    if (!existing) throw new NotFoundException(`Git credential ${id} not found`);

    const update: Partial<GitCredentialRow> & { updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (patch.label !== undefined) {
      if (!patch.label.trim()) throw new BadRequestException('label cannot be empty');
      update.label = patch.label.trim();
    }
    if (patch.hostPattern !== undefined) {
      if (!patch.hostPattern.trim()) throw new BadRequestException('hostPattern cannot be empty');
      update.hostPattern = patch.hostPattern.trim();
    }
    if (patch.username !== undefined) update.username = patch.username?.trim() ?? null;
    if (patch.secret !== undefined && patch.secret !== '') {
      update.secretEnc = encryptSecret(patch.secret, getMasterKey());
      update.fingerprint = computeFingerprint(patch.secret, existing.kind);
    }
    if (patch.isActive !== undefined) update.isActive = patch.isActive;

    this.db.update(gitCredentials).set(update).where(eq(gitCredentials.id, id)).run();
    return this.get(id);
  }

  /** 软删语义改成 hard-delete —— secret 已被 rotate/fingerprint 覆盖前不该保留 */
  revoke(id: string): void {
    const result = this.db.delete(gitCredentials).where(eq(gitCredentials.id, id)).run();
    if (result.changes === 0) throw new NotFoundException(`Git credential ${id} not found`);
  }

  private toPublic(r: GitCredentialRow): GitCredentialPublic {
    return {
      id: r.id,
      scope: r.scope,
      projectId: r.projectId,
      label: r.label,
      kind: r.kind,
      hostPattern: r.hostPattern,
      username: r.username,
      fingerprint: r.fingerprint,
      isActive: r.isActive,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

/**
 * 计算展示用 fingerprint(末 4 位 + SHA-256 短摘要 8 字符):
 * - https_token:前缀 + 末 4 位(`ghp_***abcd`)
 * - ssh_key:SHA-256 前 16 hex(无末位信息,SSH 私钥末尾常填充随机)
 */
function computeFingerprint(secret: string, kind: 'ssh_key' | 'https_token'): string {
  if (kind === 'https_token') {
    const tail = secret.slice(-4);
    return tail.length > 0 ? `***${tail}` : '***';
  }
  // ssh_key:取稳定摘要(去首尾空白)
  const hash = createHash('sha256').update(secret.trim()).digest('hex');
  return `sha256:${hash.slice(0, 16)}`;
}
