import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/** scrypt 参数，保持与已存哈希解耦（解析时从字符串读取） */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/**
 * 生成密码哈希，格式：scrypt$N$r$p$saltBase64$hashBase64
 * 使用 Node 内置 crypto.scrypt，不引入原生依赖，避免部署时的编译问题。
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64')
  ].join('$');
}

/** 校验密码；格式非法或算法不符一律返回 false */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltBase64, hashBase64] = parts;
  const salt = Buffer.from(saltBase64, 'base64');
  const expected = Buffer.from(hashBase64, 'base64');

  const derived = await scrypt(plain, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
