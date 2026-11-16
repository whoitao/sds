import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildRegionIndex, type RegionIndex, type RegionNode } from '@sds/shared';
import { API_BASE_URL } from './api';

/**
 * 移动端区划数据缓存。
 *
 * 区划是低频变更的全量字典（约 3300 条，JSON 约 280KB），
 * 策略：本地 AsyncStorage 缓存 + ETag 条件请求。
 * 首屏先读缓存立即渲染，后台再校验版本；304 时不重复写盘。
 */
const CACHE_KEY = 'sds.regions.v2';

interface RegionCache {
  etag: string;
  nodes: RegionNode[];
}

async function readCache(): Promise<RegionCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegionCache;
    return Array.isArray(parsed.nodes) && parsed.nodes.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(value: RegionCache) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // 缓存写失败不影响本次使用
  }
}

/** 带 ETag 拉取；命中 304 返回 null 表示沿用缓存 */
async function fetchRegionCache(etag?: string): Promise<RegionCache | null> {
  const response = await fetch(`${API_BASE_URL}/api/regions`, {
    headers: etag ? { 'if-none-match': etag } : undefined
  });
  if (response.status === 304) return null;
  if (!response.ok) throw new Error(`区划数据加载失败（${response.status}）`);
  const payload = (await response.json()) as { items: RegionNode[] };
  return { etag: response.headers.get('etag') ?? '', nodes: payload.items };
}

export interface RegionData {
  nodes: RegionNode[];
  index: RegionIndex | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

/** 页面级复用：缓存优先，后台刷新，返回可用的区划索引 */
export function useRegions(): RegionData {
  const [nodes, setNodes] = useState<RegionNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const cached = await readCache();
    if (cached) setNodes(cached.nodes);

    try {
      const fresh = await fetchRegionCache(cached?.etag);
      if (fresh) {
        setNodes(fresh.nodes);
        await writeCache(fresh);
      }
      setError('');
    } catch (err) {
      if (!cached) setError(err instanceof Error ? err.message : '区划数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const index = useMemo(() => (nodes.length > 0 ? buildRegionIndex(nodes) : null), [nodes]);

  return { nodes, index, loading, error, reload: () => void load() };
}
