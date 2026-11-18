import {
  buildRegionIndex,
  getCities,
  getDistricts,
  getProvinces,
  type RegionNode
} from '@sds/shared';
import { API_BASE_URL } from './api';

/** 省/市/区县三级树，供地址表单的联动下拉使用（只保留展示需要的字段） */
export type RegionTreeNode = {
  code: string;
  name: string;
  children: RegionTreeNode[];
};

/**
 * 服务端读取区划字典并转成三层树。
 * /api/regions 自带 ETag 与 1 小时缓存，这里再用 Next 的 fetch 缓存兜一层。
 * 区划数据是只读字典，取不到时返回空数组，由页面提示用户刷新。
 */
export async function getRegionTree(): Promise<RegionTreeNode[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/regions`, {
      next: { revalidate: 3600, tags: ['regions'] }
    });
    if (!response.ok) return [];

    const data = (await response.json()) as { items?: RegionNode[] };
    if (!data.items?.length) return [];

    const index = buildRegionIndex(data.items);
    return getProvinces(index).map((province) => ({
      code: province.code,
      name: province.name,
      children: getCities(index, province.code).map((city) => ({
        code: city.code,
        name: city.name,
        children: getDistricts(index, city.code).map((district) => ({
          code: district.code,
          name: district.name,
          children: []
        }))
      }))
    }));
  } catch {
    return [];
  }
}
