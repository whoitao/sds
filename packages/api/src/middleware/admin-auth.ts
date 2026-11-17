import type { MiddlewareHandler } from 'hono';
import { verifyAdminToken, type AdminTokenPayload } from '../lib/jwt.js';

export type AdminEnv = {
  Variables: {
    admin: AdminTokenPayload;
  };
};

function readBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/** 校验管理员登录凭证；失败统一 401 */
export const requireAdmin: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const token = readBearer(c.req.header('authorization'));
  if (!token) {
    return c.json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' }, 401);
  }

  const payload = await verifyAdminToken(token);
  if (!payload) {
    return c.json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' }, 401);
  }

  c.set('admin', payload);
  await next();
};
