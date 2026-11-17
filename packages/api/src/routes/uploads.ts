import { Hono } from 'hono';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import {
  publicObjectUrl,
  readStorageConfig,
  StorageNotConfiguredError,
  uploadObject
} from '../lib/storage.js';

/** 管理端图片上传：表单 multipart，字段名 file，可选 dir（默认 shops） */
export const uploadRoutes = new Hono<AdminEnv>();

uploadRoutes.use('*', requireAdmin);

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

interface UploadedFile {
  name?: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  const file = value as UploadedFile | undefined;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof file?.arrayBuffer === 'function' &&
    typeof file?.type === 'string' &&
    typeof file?.size === 'number'
  );
}

function resolveDir(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9-]{1,32}$/.test(raw) ? raw : 'shops';
}

uploadRoutes.post('/', async (c) => {
  // 店铺封面 / 总部分类图标共用上传入口：shops.write 或 catalog.write 任一即可
  const denied = await guardPermission(c, 'shops.write');
  if (denied) {
    const catalogDenied = await guardPermission(c, 'catalog.write');
    if (catalogDenied) return denied;
  }

  const body = await c.req.parseBody().catch(() => null);
  const file = body?.file;
  if (!isUploadedFile(file)) {
    return c.json({ code: 'INVALID_BODY', message: '请选择要上传的图片（字段名 file）' }, 400);
  }

  const ext = CONTENT_TYPE_EXT[file.type];
  if (!ext) {
    return c.json(
      { code: 'UNSUPPORTED_MEDIA_TYPE', message: '仅支持 JPG / PNG / WebP / GIF' },
      415
    );
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return c.json({ code: 'FILE_TOO_LARGE', message: '图片大小需在 5MB 以内' }, 413);
  }

  const config = readStorageConfig();
  if (!config) {
    return c.json(
      {
        code: 'STORAGE_NOT_CONFIGURED',
        message: '图片存储未配置，请在 .env 中填写 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY'
      },
      503
    );
  }

  const now = new Date();
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const path = `${resolveDir(body?.dir)}/${month}/${crypto.randomUUID()}.${ext}`;

  try {
    await uploadObject(config, path, await file.arrayBuffer(), file.type);
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return c.json({ code: 'STORAGE_NOT_CONFIGURED', message: error.message }, 503);
    }
    console.error('[sds-api] 图片上传失败:', error);
    return c.json({ code: 'UPLOAD_FAILED', message: '图片上传失败，请稍后再试' }, 502);
  }

  return c.json({ url: publicObjectUrl(config, path), path, size: file.size }, 201);
});
