'use client';

// 门店商品管理（多店方案 P5 后）：
// - 分类：总部共享树，门店只能隐藏/显示（写接口已下线）
// - 商品：共享字段只读，门店只维护售价（可跟随建议价）、上下架、规格、排序
// - 总部强制下架期间，门店不能上架，也不能删除该商品
// - 库存只读：只能通过库存台账（调整/采购入库）变更，商品页不再直改库存
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  TreeSelect
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  EditOutlined,
  SearchOutlined,
  StopOutlined,
  TagsOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TabProgress } from '../../../components/TabProgress';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

interface ShopOption {
  id: string;
  name: string;
}

interface CatalogNode {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  iconUrl: string | null;
  isActive: boolean;
  productCount: number;
  childCount: number;
  hidden: boolean;
}

interface CatalogTreeRow extends CatalogNode {
  children?: CatalogTreeRow[];
  totalCount: number;
}

interface ProductRow {
  id: string;
  shopId: string;
  name: string;
  categoryName: string | null;
  description: string | null;
  imageUrl: string | null;
  price: string | null;
  unit: string;
  stockType: 'tracked' | 'untracked';
  stockQuantity: number;
  skuCount: number;
  lowStockCount: number;
  defaultSkuId: string | null;
  isAvailable: boolean;
  sortOrder: number;
  updatedAt: string;
  catalogProductId: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  isTest: boolean;
  catalogCategoryId: string | null;
  catalogCategoryName: string | null;
  catalogPrice: string | null;
  effectivePrice: string | null;
  priceOverridden: boolean;
}

type QuantityMode = 'integer' | 'decimal_2';

interface ProductSkuRow {
  id: string;
  productId: string;
  catalogSkuId: string | null;
  specName: string;
  barcode: string | null;
  unit: string;
  price: string | null;
  stockType: 'tracked' | 'untracked';
  quantityMode: QuantityMode;
  isAvailable: boolean;
  isDefault: boolean;
  sortOrder: number;
  catalogStatus: 'active' | 'disabled' | null;
  effectivePrice: string | null;
  stockQuantity: string;
  minThreshold: string;
  maxThreshold: string | null;
}

interface SkuDraft {
  specName: string;
  barcode: string;
  unit: string;
  price: string;
  stockType: 'tracked' | 'untracked';
  quantityMode: QuantityMode;
  isAvailable: boolean;
  isDefault: boolean;
  sortOrder: number;
}

function emptySkuDraft(product: ProductRow): SkuDraft {
  return {
    specName: '',
    barcode: '',
    unit: product.unit,
    price: product.price ?? '',
    stockType: product.stockType,
    quantityMode: 'integer',
    isAvailable: true,
    isDefault: false,
    sortOrder: 0
  };
}

function skuDraftFromRow(row: ProductSkuRow): SkuDraft {
  return {
    specName: row.specName,
    barcode: row.barcode ?? '',
    unit: row.unit,
    price: row.price === null ? '' : row.price,
    stockType: row.stockType,
    quantityMode: row.quantityMode,
    isAvailable: row.isAvailable,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder
  };
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function buildCatalogTree(rows: CatalogNode[]): CatalogTreeRow[] {
  const nodes = new Map<string, CatalogTreeRow>();
  for (const row of rows) nodes.set(row.id, { ...row, totalCount: row.productCount });

  const roots: CatalogTreeRow[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      (parent.children ??= []).push(node);
      parent.totalCount += node.productCount;
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** 分类图标：无地址或加载失败时不渲染，避免出现破图与占位空隙 */
function CategoryTreeIcon({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      style={{
        width: 18,
        height: 18,
        flex: 'none',
        display: 'block',
        objectFit: 'cover',
        borderRadius: 4,
        background: colors.subtle,
        border: `1px solid ${colors.border}`
      }}
      onError={() => setFailed(true)}
    />
  );
}

export default function ProductsPage() {
  const { pageSize } = useAdminSettings();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<'products' | 'categories'>('products');
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [catalogRows, setCatalogRows] = useState<CatalogNode[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [availability, setAvailability] = useState<string | undefined>();

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<{ row: ProductRow; categoryPath: string } | null>(null);
  const [productForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const [skuProduct, setSkuProduct] = useState<ProductRow | null>(null);
  const [skuRows, setSkuRows] = useState<ProductSkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<ProductSkuRow | null>(null);
  const [skuDraft, setSkuDraft] = useState<SkuDraft | null>(null);
  const [skuSubmitting, setSkuSubmitting] = useState(false);
  const [skuError, setSkuError] = useState('');

  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadShops() {
      try {
        const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
        const payload = await response.json();
        const items: ShopOption[] = response.ok ? (payload.items ?? []) : [];
        setShops(items);
        setShopId(items[0]?.id);
      } catch {
        setError('接口不可用');
      }
    }
    void loadShops();
  }, []);

  const loadCatalog = useCallback(async () => {
    if (!shopId) return;
    setCatalogLoading(true);
    try {
      const response = await fetch(
        `/api/admin/catalog/categories?shopId=${encodeURIComponent(shopId)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '分类加载失败');
        return;
      }
      setCatalogRows(payload.items ?? []);
    } catch {
      setError('接口不可用');
    } finally {
      setCatalogLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadProducts = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      shopId,
      page: String(page),
      pageSize: String(pageSize)
    });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (categoryFilter) params.set('categoryId', categoryFilter);
    if (availability) params.set('isAvailable', availability);

    try {
      const response = await fetch(`/api/admin/products?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '加载失败');
        return;
      }
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [shopId, page, pageSize, keyword, categoryFilter, availability]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const catalogTree = useMemo(() => buildCatalogTree(catalogRows), [catalogRows]);

  const categoryPathMeta = useMemo(() => {
    const meta = new Map<string, string>();
    for (const item of catalogRows) {
      const parent = item.parentId
        ? catalogRows.find((candidate) => candidate.id === item.parentId)
        : undefined;
      meta.set(item.id, parent ? `${parent.name} / ${item.name}` : item.name);
    }
    return meta;
  }, [catalogRows]);

  const catalogTreeData = useMemo(
    () =>
      catalogTree.map((root) => ({
        value: root.id,
        title: `${root.name}${root.isActive ? '' : '（总部停用）'}`,
        children: (root.children ?? []).map((child) => ({
          value: child.id,
          title: `${child.name}${child.isActive ? '' : '（总部停用）'}`
        }))
      })),
    [catalogTree]
  );

  const categoryTableData = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (!needle) return catalogTree;
    return catalogTree.flatMap((root) => {
      const children = (root.children ?? []).filter((child) =>
        child.name.toLowerCase().includes(needle)
      );
      if (root.name.toLowerCase().includes(needle)) return [root];
      return children.length > 0 ? [{ ...root, children }] : [];
    });
  }, [catalogTree, searchText]);

  async function toggleCategoryVisibility(row: CatalogTreeRow, visible: boolean) {
    if (!shopId) return;
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/admin/shops/${shopId}/catalog/categories/${row.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hidden: !visible })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '操作失败');
        return;
      }
      setNotice(
        visible
          ? `已对「${row.name}」恢复显示（含子分类）`
          : `已对「${row.name}」隐藏${row.level === 1 ? '（含子分类）' : ''}`
      );
      void loadCatalog();
    } catch {
      setError('操作失败');
    }
  }

  function openProductEdit(row: ProductRow) {
    const categoryPath = row.catalogCategoryId
      ? (categoryPathMeta.get(row.catalogCategoryId) ?? row.catalogCategoryName ?? '未分类')
      : (row.categoryName ?? '未分类');
    setEditingProduct({ row, categoryPath });
    productForm.setFieldsValue({
      price: row.price === null ? undefined : Number(row.price),
      stockType: row.stockType,
      sortOrder: row.sortOrder,
      isAvailable: row.isAvailable
    });
    setProductModalOpen(true);
  }

  async function submitProduct() {
    if (!editingProduct) return;
    const values = await productForm.validateFields();
    const shared = Boolean(editingProduct.row.catalogProductId);
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/products/${editingProduct.row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          price: shared ? (values.price ?? null) : values.price,
          stockType: values.stockType,
          sortOrder: values.sortOrder,
          isAvailable: values.isAvailable
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '保存失败');
        return;
      }
      setProductModalOpen(false);
      setNotice('已保存');
      void loadProducts();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleAvailability(row: ProductRow) {
    if (row.isBlocked) {
      setError(`商品已被总部强制下架${row.blockedReason ? `：${row.blockedReason}` : ''}`);
      return;
    }
    const response = await fetch(`/api/admin/products/${row.id}/availability`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isAvailable: !row.isAvailable })
    });
    if (response.ok) {
      setNotice(row.isAvailable ? '已下架' : '已上架');
      void loadProducts();
      return;
    }
    const payload = await response.json().catch(() => null);
    setError(payload?.message ?? '上下架失败');
  }

  async function loadSkus(productId: string) {
    setSkuLoading(true);
    setSkuError('');
    try {
      const response = await fetch(`/api/admin/products/${productId}/skus`, {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) {
        setSkuError(payload?.message ?? '规格加载失败');
        return;
      }
      setSkuRows(payload.items ?? []);
    } catch {
      setSkuError('接口不可用');
    } finally {
      setSkuLoading(false);
    }
  }

  function openSkuModal(row: ProductRow) {
    setSkuProduct(row);
    setSkuModalOpen(true);
    setEditingSku(null);
    setSkuDraft(null);
    setSkuError('');
    void loadSkus(row.id);
  }

  function startCreateSku() {
    if (!skuProduct) return;
    setEditingSku(null);
    setSkuDraft(emptySkuDraft(skuProduct));
    setSkuError('');
  }

  function startEditSku(row: ProductSkuRow) {
    setEditingSku(row);
    setSkuDraft(skuDraftFromRow(row));
    setSkuError('');
  }

  function updateSkuDraft(patch: Partial<SkuDraft>) {
    setSkuDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveSku() {
    if (!skuProduct || !skuDraft) return;
    const shared = Boolean(editingSku?.catalogSkuId);
    const price = skuDraft.price.trim() === '' ? null : Number(skuDraft.price);
    if (!shared && (price === null || !Number.isFinite(price))) {
      setSkuError('本地规格必须填写售价');
      return;
    }
    if (!shared && (!skuDraft.specName.trim() || !skuDraft.unit.trim())) {
      setSkuError('规格名称与单位必填');
      return;
    }

    const body = shared
      ? {
          price,
          isAvailable: skuDraft.isAvailable,
          isDefault: skuDraft.isDefault,
          sortOrder: skuDraft.sortOrder
        }
      : {
          specName: skuDraft.specName.trim(),
          barcode: skuDraft.barcode.trim() || null,
          unit: skuDraft.unit.trim(),
          price,
          stockType: skuDraft.stockType,
          quantityMode: skuDraft.quantityMode,
          isAvailable: skuDraft.isAvailable,
          isDefault: skuDraft.isDefault,
          sortOrder: skuDraft.sortOrder
        };

    setSkuSubmitting(true);
    setSkuError('');
    try {
      const url = editingSku
        ? `/api/admin/product-skus/${editingSku.id}`
        : `/api/admin/products/${skuProduct.id}/skus`;
      const response = await fetch(url, {
        method: editingSku ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        setSkuError(payload?.message ?? '规格保存失败');
        return;
      }
      setEditingSku(null);
      setSkuDraft(null);
      await loadSkus(skuProduct.id);
      void loadProducts();
    } catch {
      setSkuError('规格保存失败');
    } finally {
      setSkuSubmitting(false);
    }
  }

  function deleteSku(row: ProductSkuRow) {
    if (!skuProduct) return;
    Modal.confirm({
      title: `删除规格「${row.specName}」？`,
      content: '仅无库存、无流水、无采购记录的非默认本地规格可以删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const response = await fetch(`/api/admin/product-skus/${row.id}`, {
          method: 'DELETE'
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setSkuError(payload?.message ?? '删除失败');
          return;
        }
        await loadSkus(skuProduct.id);
        void loadProducts();
      }
    });
  }

  const skuColumns: TableColumnsType<ProductSkuRow> = [
    {
      title: '规格',
      dataIndex: 'specName',
      render: (value: string, row) => (
        <Space size={4}>
          <span>{value}</span>
          {row.isDefault ? <Tag color="blue">默认</Tag> : null}
          {row.catalogSkuId ? (
            <Tag color="geekblue">总部</Tag>
          ) : (
            <Tag>本地</Tag>
          )}
          {row.catalogStatus === 'disabled' ? <Tag color="default">总部停用</Tag> : null}
        </Space>
      )
    },
    {
      title: '售价',
      dataIndex: 'effectivePrice',
      width: 140,
      align: 'right',
      render: (value: string | null, row) =>
        value === null ? (
          '—'
        ) : (
          <Space size={4}>
            <span>¥{Number(value).toFixed(2)}</span>
            {row.catalogSkuId && row.price === null ? <Tag>跟随</Tag> : null}
          </Space>
        )
    },
    { title: '单位', dataIndex: 'unit', width: 70 },
    {
      title: '库存',
      dataIndex: 'stockQuantity',
      width: 100,
      align: 'right',
      render: (value: string, row) =>
        row.stockType === 'tracked' ? (
          <span>{Number(value).toFixed(2)}</span>
        ) : (
          <Tag color="default">不追踪</Tag>
        )
    },
    {
      title: '数量模式',
      dataIndex: 'quantityMode',
      width: 100,
      render: (value: QuantityMode) =>
        value === 'integer' ? <Tag>整数</Tag> : <Tag color="cyan">2 位小数</Tag>
    },
    {
      title: '状态',
      dataIndex: 'isAvailable',
      width: 90,
      render: (value: boolean) => (
        <Tag color={value ? 'success' : 'default'}>{value ? '启用' : '停用'}</Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" onClick={() => startEditSku(row)}>
            编辑
          </Button>
          {!row.catalogSkuId && !row.isDefault ? (
            <Button size="small" danger onClick={() => deleteSku(row)}>
              删除
            </Button>
          ) : null}
        </Space>
      )
    }
  ];

  const categoryColumns: TableColumnsType<CatalogTreeRow> = [
    {
      title: '分类名称',
      dataIndex: 'name',
      render: (value: string, row) => (
        <Space size={6}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <CategoryTreeIcon key={row.iconUrl ?? 'none'} url={row.iconUrl} />
            <span>{value}</span>
          </span>
          {row.level === 1 ? <Tag color="blue">一级</Tag> : null}
          {row.isActive ? null : <Tag color="default">总部停用</Tag>}
        </Space>
      )
    },
    {
      title: '商品数',
      dataIndex: 'productCount',
      width: 160,
      render: (_: number, row) =>
        row.totalCount === 0
          ? '—'
          : row.childCount > 0
            ? `直属 ${row.productCount} · 共 ${row.totalCount}`
            : `共 ${row.totalCount}`
    },
    {
      title: '门店可见',
      dataIndex: 'hidden',
      width: 140,
      render: (_: boolean, row) => {
        const parentHidden =
          row.level === 2 &&
          Boolean(catalogRows.find((item) => item.id === row.parentId)?.hidden);
        return (
          <Tooltip title={parentHidden ? '父级分类已隐藏，恢复父级后子分类才会显示' : undefined}>
            <Switch
              size="small"
              checked={!row.hidden}
              checkedChildren="显示"
              unCheckedChildren="隐藏"
              disabled={parentHidden}
              onChange={(checked) => void toggleCategoryVisibility(row, checked)}
            />
          </Tooltip>
        );
      }
    }
  ];

  const columns: TableColumnsType<ProductRow> = [
    {
      title: '商品名称',
      dataIndex: 'name',
      width: 220,
      render: (value: string, row) => (
        <Space size={6}>
          <span>{value}</span>
          {row.isTest ? <Tag color="orange">测试</Tag> : null}
          {row.catalogProductId ? <Tag color="blue">总部</Tag> : <Tag>本地</Tag>}
        </Space>
      )
    },
    {
      title: '分类',
      dataIndex: 'catalogCategoryName',
      width: 140,
      render: (_: string | null, row) => {
        if (row.catalogCategoryId) {
          return categoryPathMeta.get(row.catalogCategoryId) ?? row.catalogCategoryName ?? '未分类';
        }
        return row.categoryName ?? '未分类';
      }
    },
    {
      title: '本店价',
      dataIndex: 'effectivePrice',
      width: 150,
      align: 'right',
      render: (_: string | null, row) => {
        if (row.effectivePrice === null) return '—';
        return (
          <Space size={4}>
            <span>¥{Number(row.effectivePrice).toFixed(2)}</span>
            {row.catalogProductId ? (
              row.priceOverridden ? (
                <Tag color="orange">已改价</Tag>
              ) : (
                <Tag color="blue">跟随建议价</Tag>
              )
            ) : null}
          </Space>
        );
      }
    },
    {
      title: '建议价',
      dataIndex: 'catalogPrice',
      width: 100,
      align: 'right',
      render: (value: string | null) => (value === null ? '—' : `¥${Number(value).toFixed(2)}`)
    },
    { title: '单位', dataIndex: 'unit', width: 80 },
    {
      title: '库存',
      dataIndex: 'stockQuantity',
      width: 150,
      align: 'right',
      render: (value: number, row) =>
        row.stockType === 'tracked' ? (
          <Space size={4}>
            <span>{Number(value).toFixed(2)}</span>
            {row.skuCount > 1 ? <Tag>{row.skuCount} 规格</Tag> : null}
            {row.lowStockCount > 0 ? (
              <Tooltip title="存在低于安全库存的规格">
                <Tag color="warning">{row.lowStockCount} 低</Tag>
              </Tooltip>
            ) : null}
          </Space>
        ) : (
          <Tag color="default">不追踪</Tag>
        )
    },
    {
      title: '状态',
      dataIndex: 'isAvailable',
      width: 96,
      render: (value: boolean, row) =>
        row.isBlocked ? (
          <Tooltip title={row.blockedReason ?? '总部强制下架'}>
            <Tag color="error">总部下架</Tag>
          </Tooltip>
        ) : value ? (
          <Tag color="success">已上架</Tag>
        ) : (
          <Tag color="default">已下架</Tag>
        )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row) => (
        <Space size={2}>
          <Tooltip title="编辑售价/上下架/库存策略">
            <Button
              variant="text"
              color="primary"
              size="small"
              icon={<EditOutlined />}
              aria-label="编辑"
              onClick={() => openProductEdit(row)}
            />
          </Tooltip>
          <Tooltip title="规格与库存">
            <Button
              variant="text"
              color="primary"
              size="small"
              icon={<TagsOutlined />}
              aria-label="规格"
              onClick={() => openSkuModal(row)}
            />
          </Tooltip>
          <Tooltip
            title={
              row.isBlocked ? '总部已强制下架，需总部解除后才能上架' : row.isAvailable ? '下架' : '上架'
            }
          >
            <Button
              variant="text"
              color={row.isAvailable ? 'danger' : 'primary'}
              size="small"
              icon={row.isAvailable ? <StopOutlined /> : <CheckCircleOutlined />}
              aria-label={row.isAvailable ? '下架' : '上架'}
              disabled={row.isBlocked}
              onClick={() => void toggleAvailability(row)}
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  const hasShop = Boolean(shopId);
  const editingShared = Boolean(editingProduct?.row.catalogProductId);
  const editingBlocked = Boolean(editingProduct?.row.isBlocked);

  return (
    <div style={{ background: colors.surface, minHeight: '100vh' }}>
      <div className="admin-page-bar">
        <Space size={12}>
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>商品管理</span>
          <span style={{ fontSize: 12, color: colors.textTertiary }}>
            商品由总部商品库统一发布，门店维护价格与上下架
          </span>
        </Space>
        <Space size={8}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择店铺"
            style={{ width: 200 }}
            value={shopId}
            onChange={(value) => {
              setShopId(value);
              setPage(1);
            }}
            options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
          />
          <TestDataCleanupButton
            onCleaned={() => {
              void loadCatalog();
              void loadProducts();
            }}
          />
        </Space>
      </div>

      <div style={{ position: 'relative' }}>
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'products' | 'categories')}
          tabBarStyle={{ margin: 0, padding: '0 12px' }}
          items={[
            { key: 'products', label: '商品' },
            { key: 'categories', label: '分类可见性' }
          ]}
        />
        <TabProgress activeKey={tab} />
      </div>

      {!hasShop ? (
        <div style={{ padding: 48 }}>
          <Empty description="还没有可用店铺，请先在店铺管理中创建店铺" />
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 12px 8px',
              flexWrap: 'wrap'
            }}
          >
            <Space.Compact style={{ width: ADMIN_FILTER_FIELD_WIDTH }}>
              <Input
                allowClear
                value={searchText}
                placeholder={tab === 'products' ? '按商品名称搜索…' : '按分类名称搜索…'}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearchText(value);
                  if (!value) {
                    setKeyword('');
                    setPage(1);
                  }
                }}
                onPressEnter={() => {
                  setKeyword(searchText.trim());
                  setPage(1);
                }}
              />
              <Button
                icon={<SearchOutlined />}
                style={{ background: colors.subtle, borderColor: colors.border, color: colors.textSecondary }}
                onClick={() => {
                  setKeyword(searchText.trim());
                  setPage(1);
                }}
              />
            </Space.Compact>

            {tab === 'products' ? (
              <>
                <TreeSelect
                  allowClear
                  showSearch
                  treeDefaultExpandAll
                  treeNodeFilterProp="title"
                  placeholder="全部分类"
                  style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
                  value={categoryFilter}
                  onChange={(value?: string) => {
                    setCategoryFilter(value);
                    setPage(1);
                  }}
                  treeData={catalogTreeData}
                />
                <Select
                  allowClear
                  placeholder="全部状态"
                  style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
                  value={availability}
                  onChange={(value) => {
                    setAvailability(value);
                    setPage(1);
                  }}
                  options={[
                    { value: 'true', label: '已上架' },
                    { value: 'false', label: '已下架' }
                  ]}
                />
              </>
            ) : null}
          </div>

          {error ? (
            <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
          ) : null}
          {notice && !error ? (
            <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>{notice}</div>
          ) : null}

          {tab === 'categories' ? (
            <Table<CatalogTreeRow>
              rowKey="id"
              loading={catalogLoading}
              {...getAdminTableProps(categoryColumns)}
              dataSource={categoryTableData}
              scroll={{ x: 'max-content' }}
              pagination={false}
              expandable={{
                expandedRowKeys: expandedKeys,
                onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
                indentSize: 20
              }}
              locale={{
                emptyText: (
                  <Empty description="总部尚未配置分类，请到「总部商品库 → 分类管理」中添加" />
                )
              }}
            />
          ) : (
            <Table<ProductRow>
              rowKey="id"
              loading={loading}
              {...getAdminTableProps(columns)}
              dataSource={rows}
              scroll={{ x: 'max-content' }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: false,
                showTotal: (count) => `共 ${count} 条`,
                onChange: setPage
              }}
              locale={{
                emptyText: (
                  <Empty description="暂无商品，可在店铺管理中使用「一键铺货」或等待总部发布新商品" />
                )
              }}
            />
          )}
        </>
      )}

      {mounted ? (
        <Modal
          open={productModalOpen}
          title="编辑门店商品"
          okText="保存"
          cancelText="取消"
          confirmLoading={submitting}
          onOk={() => void submitProduct()}
          onCancel={() => setProductModalOpen(false)}
          width={560}
          forceRender
        >
          <div
            style={{
              marginBottom: 16,
              padding: '8px 12px',
              borderRadius: 6,
              background: colors.subtle,
              border: `1px solid ${colors.border}`,
              fontSize: 12,
              lineHeight: 1.8,
              color: colors.textSecondary
            }}
          >
            商品名称、分类、单位由总部统一维护，门店只能调整售价、上下架、库存策略与排序。
            {editingBlocked ? (
              <div style={{ color: colors.danger }}>
                已被总部强制下架
                {editingProduct?.row.blockedReason ? `：${editingProduct.row.blockedReason}` : ''}
                ，需总部解除后才能上架。
              </div>
            ) : null}
          </div>
          <Form form={productForm} layout="vertical">
            <Form.Item label="商品名称">
              <Input value={editingProduct?.row.name ?? ''} disabled />
            </Form.Item>
            <Form.Item label="分类">
              <Input value={editingProduct?.categoryPath ?? '未分类'} disabled />
            </Form.Item>
            <Space size={12} style={{ display: 'flex' }} align="start">
              <Form.Item
                name="price"
                label="本店售价（元）"
                tooltip={editingShared ? '留空表示跟随总部建议价' : undefined}
                rules={editingShared ? [] : [{ required: true, message: '请输入售价' }]}
              >
                <InputNumber
                  style={{ width: 160 }}
                  min={0}
                  max={99999999}
                  precision={2}
                  allowClear={editingShared}
                  placeholder={
                    editingShared
                      ? `跟随建议价${editingProduct?.row.catalogPrice ? ` ¥${Number(editingProduct.row.catalogPrice).toFixed(2)}` : ''}`
                      : undefined
                  }
                />
              </Form.Item>
              <Form.Item
                name="stockType"
                label="默认规格库存追踪"
                style={{ width: 160 }}
                tooltip="仅影响默认规格；库存数量请到「规格」弹窗或库存管理中通过台账调整"
              >
                <Select
                  options={[
                    { value: 'tracked', label: '追踪库存' },
                    { value: 'untracked', label: '不追踪' }
                  ]}
                />
              </Form.Item>
            </Space>
            <Space size={24} style={{ display: 'flex' }} align="start">
              <Form.Item name="sortOrder" label="排序" tooltip="数字越小越靠前">
                <InputNumber style={{ width: 120 }} min={0} max={9999} precision={0} />
              </Form.Item>
              <Form.Item
                name="isAvailable"
                label="上架"
                valuePropName="checked"
                tooltip={editingBlocked ? '总部强制下架期间不可上架' : undefined}
              >
                <Switch disabled={editingBlocked} />
              </Form.Item>
            </Space>
          </Form>
        </Modal>
      ) : null}

      {mounted ? (
        <Modal
          open={skuModalOpen}
          title={skuProduct ? `规格管理 · ${skuProduct.name}` : '规格管理'}
          onCancel={() => setSkuModalOpen(false)}
          width={1120}
          footer={[
            <Button key="close" onClick={() => setSkuModalOpen(false)}>
              关闭
            </Button>,
            skuDraft ? (
              <Button
                key="save"
                type="primary"
                loading={skuSubmitting}
                onClick={() => void saveSku()}
              >
                保存规格
              </Button>
            ) : null
          ]}
        >
          <Space style={{ marginBottom: 12 }}>
            {skuProduct && !skuProduct.catalogProductId ? (
              <Button type="primary" onClick={startCreateSku}>
                新增规格
              </Button>
            ) : (
              <Tag color="blue">总部商品规格由总部维护，门店可改售价与上下架</Tag>
            )}
            <Button
              onClick={() => {
                if (skuProduct) void loadSkus(skuProduct.id);
              }}
            >
              刷新
            </Button>
          </Space>

          {skuError ? (
            <Alert
              type="error"
              showIcon
              title={skuError}
              style={{ marginBottom: 12 }}
              closable
              onClose={() => setSkuError('')}
            />
          ) : null}

          {skuDraft ? (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                background: colors.subtle
              }}
            >
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                {editingSku ? `编辑规格：${editingSku.specName}` : '新增规格'}
              </div>
              <Space wrap align="start">
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>规格名称</div>
                  <Input
                    style={{ width: 120 }}
                    value={skuDraft.specName}
                    disabled={Boolean(editingSku?.catalogSkuId)}
                    onChange={(event) => updateSkuDraft({ specName: event.target.value })}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>条码</div>
                  <Input
                    style={{ width: 130 }}
                    value={skuDraft.barcode}
                    disabled={Boolean(editingSku?.catalogSkuId)}
                    onChange={(event) => updateSkuDraft({ barcode: event.target.value })}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>单位</div>
                  <Input
                    style={{ width: 80 }}
                    value={skuDraft.unit}
                    disabled={Boolean(editingSku?.catalogSkuId)}
                    onChange={(event) => updateSkuDraft({ unit: event.target.value })}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>售价</div>
                  <Input
                    style={{ width: 100 }}
                    value={skuDraft.price}
                    placeholder={
                      editingSku?.catalogSkuId ? '留空跟随总部建议价' : '必填'
                    }
                    onChange={(event) => updateSkuDraft({ price: event.target.value })}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>库存追踪</div>
                  <Select
                    style={{ width: 100 }}
                    value={skuDraft.stockType}
                    disabled={Boolean(editingSku?.catalogSkuId)}
                    onChange={(value) => updateSkuDraft({ stockType: value })}
                    options={[
                      { value: 'tracked', label: '追踪' },
                      { value: 'untracked', label: '不追踪' }
                    ]}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>数量模式</div>
                  <Select
                    style={{ width: 100 }}
                    value={skuDraft.quantityMode}
                    disabled={Boolean(editingSku?.catalogSkuId)}
                    onChange={(value) => updateSkuDraft({ quantityMode: value })}
                    options={[
                      { value: 'integer', label: '整数' },
                      { value: 'decimal_2', label: '2 位小数' }
                    ]}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>排序</div>
                  <InputNumber
                    style={{ width: 72 }}
                    min={0}
                    max={9999}
                    precision={0}
                    value={skuDraft.sortOrder}
                    onChange={(value) => updateSkuDraft({ sortOrder: Number(value ?? 0) })}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>启用</div>
                  <Switch
                    checked={skuDraft.isAvailable}
                    onChange={(checked) => updateSkuDraft({ isAvailable: checked })}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>默认规格</div>
                  <Switch
                    checked={skuDraft.isDefault}
                    disabled={Boolean(editingSku?.isDefault)}
                    onChange={(checked) => updateSkuDraft({ isDefault: checked })}
                  />
                </div>
                <Button
                  style={{ marginTop: 22 }}
                  onClick={() => {
                    setSkuDraft(null);
                    setEditingSku(null);
                  }}
                >
                  取消
                </Button>
              </Space>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>
                库存数量不能在商品页直改；请到「库存管理」使用调整或采购入库生成台账。
              </div>
            </div>
          ) : null}

          <Table
            rowKey="id"
            size="small"
            loading={skuLoading}
            {...getAdminTableProps(skuColumns)}
            dataSource={skuRows}
            pagination={false}
          />
        </Modal>
      ) : null}
    </div>
  );
}
