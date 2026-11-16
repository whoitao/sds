import { sign, verify } from 'hono/jwt';

export interface AdminTokenPayload {
  sub: string;
  username: string;
  role: string;
  exp: number;
}

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function getSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error('ADMIN_JWT_SECRET 未配置：请提供用于管理员登录凭证签名的密钥');
  }
  return secret;
}

export async function signAdminToken(payload: Omit<AdminTokenPayload, 'exp'>): Promise<string> {
  return sign({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, getSecret(), 'HS256');
}

/** 校验失败返回 null，不抛异常，便于路由统一处理 */
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  try {
    const payload = (await verify(token, getSecret(), 'HS256')) as Record<string, unknown>;
    if (typeof payload.sub !== 'string' || typeof payload.username !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return payload as unknown as AdminTokenPayload;
  } catch {
    return null;
  }
}
