import { Hono } from 'hono';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import {
  deleteObject,
  imagePathFromValue,
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

/** 只允许删除本系统上传的图片：桶内 目录/YYYYMM/UUID.扩展名 的固定结构 */
const UPLOADED_PATH_PATTERN =
  /^[a-z0-9-]{1,32}\/\d{6}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/;

/**
 * 删除参数兼容两种历史形态：
 * - 新数据：桶内相对路径（catalog-products/202611/xxx.png）
 * - 旧数据：完整公开 URL（只接受本桶前缀，外部地址一律拒绝）
 */
function uploadedPathFromValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const path = imagePathFromValue(value);
  return path && UPLOADED_PATH_PATTERN.test(path) ? path : null;
}

/** 上传入口的权限口径：shops.write 或 catalog.write 任一即可，删除保持一致 */
async function denyUploadAccess(c: Parameters<typeof guardPermission>[0]) {
  const denied = await guardPermission(c, 'shops.write');
  if (!denied) return null;
  const catalogDenied = await guardPermission(c, 'catalog.write');
  return catalogDenied ? denied : null;
}

uploadRoutes.post('/', async (c) => {
  const denied = await denyUploadAccess(c);
  if (denied) return denied;

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

  return c.json({ path, size: file.size }, 201);
});

/** 删除本系统上传的单张图片；仅接受本桶内符合上传路径规则的地址 */
uploadRoutes.delete('/', async (c) => {
  const denied = await denyUploadAccess(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
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

  const path = uploadedPathFromValue(body?.path ?? body?.url);
  if (!path) {
    return c.json(
      { code: 'INVALID_PATH', message: '只能删除由本系统上传的图片' },
      400
    );
  }

  try {
    await deleteObject(config, path);
  } catch (error) {
    console.error('[sds-api] 图片删除失败:', path, error);
    return c.json({ code: 'DELETE_FAILED', message: '图片删除失败，请稍后再试' }, 502);
  }

  return c.json({ deleted: true, path });
});
