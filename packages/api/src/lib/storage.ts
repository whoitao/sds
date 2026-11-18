/**
 * Supabase Storage 上传（REST 直传，二进制不落库）。
 * 凭据只从环境变量读：SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。
 */
export interface StorageConfig {
  url: string;
  serviceKey: string;
  bucket: string;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('图片存储未配置（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）');
    this.name = 'StorageNotConfiguredError';
  }
}

/**
 * 从 Supabase 连接串推导项目地址，避免重复配置：
 * - 连接池：postgresql://postgres.<ref>:pwd@aws-0-<region>.pooler.supabase.com:6543/postgres
 * - 直连：postgresql://postgres:pwd@db.<ref>.supabase.co:5432/postgres
 * 都推导为 https://<ref>.supabase.co；非 Supabase 连接串（自建 Postgres 等）返回 undefined。
 */
export function deriveSupabaseUrl(databaseUrl?: string): string | undefined {
  if (!databaseUrl) return undefined;
  const source = databaseUrl.trim();
  const matched =
    /^postgres(?:ql)?:\/\/postgres\.([a-z0-9]{20})(?::[^@]*)?@/i.exec(source) ??
    /@db\.([a-z0-9]{20})\.supabase\.co/i.exec(source);
  return matched ? `https://${matched[1]}.supabase.co` : undefined;
}

export function readStorageConfig(): StorageConfig | null {
  // 地址允许从已有的 DATABASE_URL 推导，密钥无法推导，必须单独提供
  const url = process.env.SUPABASE_URL?.trim() || deriveSupabaseUrl(process.env.DATABASE_URL);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;

  return {
    url: url.replace(/\/+$/, ''),
    serviceKey,
    // 桶名以已有的 DATABASE_BUCKET 为准，SUPABASE_STORAGE_BUCKET 仅在未设置时兜底
    bucket: process.env.DATABASE_BUCKET?.trim() || process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'sdsbucket'
  };
}

/** 返回可公网访问的地址；调用前需保证 bucket 为 public */
export function publicObjectUrl(config: StorageConfig, path: string): string {
  return `${config.url}/storage/v1/object/public/${config.bucket}/${path}`;
}

export async function uploadObject(
  config: StorageConfig,
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<void> {
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.serviceKey}`,
      'content-type': contentType,
      'x-upsert': 'false',
      'cache-control': 'max-age=31536000'
    },
    body: data,
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`storage responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}

/** 删除单个对象；对象已不存在（404）按成功处理，方便重复清理 */
export async function deleteObject(config: StorageConfig, path: string): Promise<void> {
  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${path}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${config.serviceKey}`
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '');
    throw new Error(`storage responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
}
