import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * §6.2 存储加密:AES-256-GCM
 *
 * 密钥派生:从 APP_MASTER_KEY(环境变量)经 scrypt 派生 32 字节 key
 * 密文格式:base64( iv(12) || authTag(16) || ciphertext )
 *
 * Phase 1 简化为单向派生;Phase 4 可换 KMS。
 */
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(masterKey: string): Buffer {
  // 用固定 salt(平台唯一) + scrypt 把任意长度 master key 派生为 32 字节
  // 注:固定 salt 在多实例部署时需要换为随机,Phase 4 一并处理
  const salt = Buffer.from('audit-platform-mvp-salt-v1', 'utf8');
  return scryptSync(masterKey, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function encryptSecret(plain: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(b64: string, masterKey: string): string {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const key = deriveKey(masterKey);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * 取主密钥(env > 默认 dev fallback)
 */
export function getMasterKey(): string {
  return process.env['APP_MASTER_KEY'] ?? 'dev-master-key-change-me-in-production';
}
