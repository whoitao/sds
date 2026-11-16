/**
 * 行政区划的公共类型与联动逻辑（不含数据、不含渲染）。
 *
 * 数据以数据库 regions 表为唯一来源，由 /api/regions 提供给各端；
 * 这里只做索引、取子级、级联选择、格式化和校验，admin / web / mobile 共用。
 */

export type RegionLevel = 1 | 2 | 3;

/** 接口返回的单条区划 */
export interface RegionNode {
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
}

/** 已选的省/市/区县：编码用于落库与聚合，名称用于展示 */
export interface RegionValue {
  provinceCode: string | null;
  provinceName: string | null;
  cityCode: string | null;
  cityName: string | null;
  districtCode: string | null;
  districtName: string | null;
}

export type RegionStep = 'province' | 'city' | 'district' | 'done';

export interface RegionIndex {
  provinces: RegionNode[];
  byCode: Map<string, RegionNode>;
  childrenOf: Map<string | null, RegionNode[]>;
}

/** 直辖市等场景下这些层级名称不适合展示 */
const HIDDEN_NAMES = new Set(['市辖区', '省直辖县级行政区划', '自治区直辖县级行政区划']);

/** 把接口返回的扁平列表建成索引，O(n) 一次完成 */
export function buildRegionIndex(nodes: RegionNode[]): RegionIndex {
  const byCode = new Map<string, RegionNode>();
  const childrenOf = new Map<string | null, RegionNode[]>();
  for (const node of nodes) {
    byCode.set(node.code, node);
    const list = childrenOf.get(node.parentCode) ?? [];
    list.push(node);
    childrenOf.set(node.parentCode, list);
  }
  return { provinces: childrenOf.get(null) ?? [], byCode, childrenOf };
}

export function getProvinces(index: RegionIndex): RegionNode[] {
  return index.provinces;
}

export function getCities(index: RegionIndex, provinceCode: string | null): RegionNode[] {
  return provinceCode ? (index.childrenOf.get(provinceCode) ?? []) : [];
}

export function getDistricts(index: RegionIndex, cityCode: string | null): RegionNode[] {
  return cityCode ? (index.childrenOf.get(cityCode) ?? []) : [];
}

export function emptyRegion(): RegionValue {
  return {
    provinceCode: null,
    provinceName: null,
    cityCode: null,
    cityName: null,
    districtCode: null,
    districtName: null
  };
}

/** 选省后清空市与区县 */
export function selectProvince(node: RegionNode): RegionValue {
  return {
    ...emptyRegion(),
    provinceCode: node.code,
    provinceName: node.name
  };
}

/** 选市后清空区县 */
export function selectCity(current: RegionValue, node: RegionNode): RegionValue {
  return {
    ...current,
    cityCode: node.code,
    cityName: node.name,
    districtCode: null,
    districtName: null
  };
}

/** 选区县 */
export function selectDistrict(current: RegionValue, node: RegionNode): RegionValue {
  return {
    ...current,
    districtCode: node.code,
    districtName: node.name
  };
}

export function isRegionComplete(value: RegionValue): boolean {
  return Boolean(value.provinceCode && value.cityCode && value.districtCode);
}

/** 当前应该让用户选哪一级，用于选择器定位步骤 */
export function nextRegionStep(value: RegionValue): RegionStep {
  if (!value.provinceCode) return 'province';
  if (!value.cityCode) return 'city';
  if (!value.districtCode) return 'district';
  return 'done';
}

/** 展示用文案：「四川省 成都市 武侯区」，自动跳过「市辖区」这类占位层级 */
export function formatRegion(value: RegionValue, separator = ' '): string {
  return [value.provinceName, value.cityName, value.districtName]
    .filter((name): name is string => Boolean(name) && !HIDDEN_NAMES.has(name as string))
    .join(separator);
}

/**
 * 校验编码路径是否真实存在且层级正确，返回对应的三个节点。
 * 用于服务端落库前校验，避免客户端传任意编码。
 */
export function resolveRegionPath(
  index: RegionIndex,
  codes: { provinceCode?: string | null; cityCode?: string | null; districtCode?: string | null }
): { province: RegionNode; city: RegionNode; district: RegionNode } | null {
  const { provinceCode, cityCode, districtCode } = codes;
  if (!provinceCode || !cityCode || !districtCode) return null;
  const province = index.byCode.get(provinceCode);
  const city = index.byCode.get(cityCode);
  const district = index.byCode.get(districtCode);
  if (!province || province.level !== 1) return null;
  if (!city || city.level !== 2 || city.parentCode !== province.code) return null;
  if (!district || district.level !== 3 || district.parentCode !== city.code) return null;
  return { province, city, district };
}

/**
 * 编辑回显：按编码路径校验，非法时从该级起清空，并补上名称。
 * 旧数据只有名称时，也可以先用名称在索引里找编码后再调用。
 */
export function buildRegionSelection(index: RegionIndex, codes: {
  provinceCode?: string | null;
  cityCode?: string | null;
  districtCode?: string | null;
}): RegionValue {
  const path = resolveRegionPath(index, codes);
  if (!path) {
    const province = codes.provinceCode ? index.byCode.get(codes.provinceCode) : undefined;
    if (!province || province.level !== 1) return emptyRegion();
    const city = codes.cityCode ? index.byCode.get(codes.cityCode) : undefined;
    if (!city || city.level !== 2 || city.parentCode !== province.code) {
      return selectProvince(province);
    }
    return selectCity(selectProvince(province), city);
  }
  return selectDistrict(selectCity(selectProvince(path.province), path.city), path.district);
}
