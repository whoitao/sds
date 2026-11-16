'use client';

// 总部商品库：共享商品（名称/描述/图片/建议价）+ 规格 + 发布流 + 强制下架
// 总部只维护商品与规格，库存由平台运营通过库存台账维护
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
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  TreeSelect
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  TagsOutlined,
  UndoOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';

interface CatalogCategoryRow {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  childCount: number;
}

interface CatalogRow {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  defaultPrice: string;
  unit: string;
  stockType: 'tracked' | 'untracked';
  status: 'draft' | 'published' | 'archived';
  isTest: boolean;
  publishedAt: string | null;
  updatedAt: string;
  shopProductCount: number;
  blockedShopCount: number;
  skuCount: number;
  defaultSkuId: string | null;
}

type QuantityMode = 'integer' | 'decimal_2';

interface CatalogSkuRow {
  id: string;
  specName: string;
  barcode: string | null;
  unit: string;
  defaultPrice: string;
  stockType: 'tracked' | 'untracked';
  quantityMode: QuantityMode;
  isDefault: boolean;
  status: 'active' | 'disabled';
  sortOrder: number;
  shopSkuCount: number;
  availableShopSkuCount: number;
}

interface CatalogSkuDraft {
  specName: string;
  barcode: string;
  unit: string;
  defaultPrice: string;
  stockType: 'tracked' | 'untracked';
  quantityMode: QuantityMode;
  isDefault: boolean;
  status: 'active' | 'disabled';
  sortOrder: number;
}

function emptyCatalogSkuDraft(row: CatalogRow): CatalogSkuDraft {
  return {
    specName: '',
    barcode: '',
    unit: row.unit,
    defaultPrice: row.defaultPrice,
    stockType: row.stockType,
    quantityMode: 'integer',
    isDefault: false,
    status: 'active',
    sortOrder: 0
  };
}

function catalogSkuDraftFromRow(row: CatalogSkuRow): CatalogSkuDraft {
  return {
    specName: row.specName,
    barcode: row.barcode ?? '',
    unit: row.unit,
    defaultPrice: row.defaultPrice,
    stockType: row.stockType,
    quantityMode: row.quantityMode,
    isDefault: row.isDefault,
    status: row.status,
    sortOrder: row.sortOrder
  };
}

const STATUS_META: Record<CatalogRow['status'], { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  published: { label: '已发布', color: 'success' },
  archived: { label: '已归档', color: 'default' }
};

const STOCK_TYPE_LABEL: Record<CatalogRow['stockType'], string> = {
  tracked: '追踪库存',
  untracked: '不追踪'
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export default function CatalogPage() {
  const { pageSize } = useAdminSettings();
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [categories, setCategories] = useState<CatalogCategoryRow[]>([]);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogRow | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const [publishPrompt, setPublishPrompt] = useState<{ ids: string[]; shopCount: number } | null>(null);
  const [offlinePrompt, setOfflinePrompt] = useState<CatalogRow | null>(null);
  const [offlineReason, setOfflineReason] = useState('');

  const [skuProduct, setSkuProduct] = useState<CatalogRow | null>(null);
  const [skuRows, setSkuRows] = useState<CatalogSkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<CatalogSkuRow | null>(null);
  const [skuDraft, setSkuDraft] = useState<CatalogSkuDraft | null>(null);
  const [skuSubmitting, setSkuSubmitting] = useState(false);
  const [skuError, setSkuError] = useState('');

  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupCounts, setCleanupCounts] = useState<{
    catalogProducts: number;
    shopProducts: number;
  } | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupSubmitting, setCleanupSubmitting] = useState(false);

  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/catalog/categories', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '分类加载失败');
        return;
      }
      setCategories(payload.items ?? []);
    } catch {
      setError('接口不可用');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (categoryFilter) params.set('categoryId', categoryFilter);
    if (statusFilter) params.set('status', statusFilter);

    try {
      const response = await fetch(`/api/admin/catalog/products?${params}`, { cache: 'no-store' });
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
  }, [keyword, categoryFilter, statusFilter, page, pageSize]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo(() => {
    const roots = categories.filter((item) => item.parentId === null);
    return roots.map((root) => ({
      value: root.id,
      title: `${root.name}${root.isActive ? '' : '（已停用）'}`,
      children: categories
        .filter((item) => item.parentId === root.id)
        .map((child) => ({
          value: child.id,
          title: `${child.name}${child.isActive ? '' : '（已停用）'}`
        }))
    }));
  }, [categories]);

  const categoryPath = useMemo(() => {
    const meta = new Map<string, string>();
    for (const item of categories) {
      const parent = item.parentId
        ? categories.find((candidate) => candidate.id === item.parentId)
        : undefined;
      meta.set(item.id, parent ? `${parent.name} / ${item.name}` : item.name);
    }
    return meta;
  }, [categories]);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ categoryId: categoryFilter, defaultPrice: 0, unit: '斤', stockType: 'tracked' });
    setModalOpen(true);
  }

  function openEdit(row: CatalogRow) {
    setEditing(row);
    form.setFieldsValue({
      categoryId: row.categoryId ?? undefined,
      name: row.name,
      defaultPrice: Number(row.defaultPrice),
      unit: row.unit,
      stockType: row.stockType,
      description: row.description ?? '',
      imageUrl: row.imageUrl ?? ''
    });
    setModalOpen(true);
  }

  async function submit() {
    const values = await form.validateFields();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editing ? `/api/admin/catalog/products/${editing.id}` : '/api/admin/catalog/products',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...values,
            categoryId: values.categoryId ?? null,
            description: values.description || null,
            imageUrl: values.imageUrl || null
          })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '保存失败');
        return;
      }
      setModalOpen(false);
      setNotice(editing ? '已保存，门店侧共享字段将同步更新' : '已保存为草稿，发布后门店可见');
      void load();
      void loadCategories();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function publish(ids: string[]) {
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/products/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '发布失败');
        return;
      }
      setPublishPrompt(null);
      setSelectedKeys([]);
      setNotice(
        `已发布 ${payload.published ?? ids.length} 个商品，补铺 ${payload.attachedShops ?? 0} 个门店商品`
      );
      void load();
    } catch {
      setError('发布失败');
    }
  }

  async function setOffline(row: CatalogRow, blocked: boolean, reason?: string) {
    setError('');
    try {
      const response = await fetch(`/api/admin/catalog/products/${row.id}/offline`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blocked, reason: reason ?? null })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? (blocked ? '强制下架失败' : '解除失败'));
        return;
      }
      setOfflinePrompt(null);
      setOfflineReason('');
      setNotice(
        blocked
          ? `已强制下架，影响 ${payload.affectedShops ?? 0} 个门店商品`
          : `已解除强制下架，影响 ${payload.affectedShops ?? 0} 个门店商品`
      );
      void load();
    } catch {
      setError('操作失败');
    }
  }

  async function archive(row: CatalogRow, archived: boolean) {
    const response = await fetch(`/api/admin/catalog/products/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: archived ? 'archived' : 'draft' })
    });
    if (response.ok) {
      setNotice(archived ? '已归档，门店侧不再显示' : '已恢复为草稿');
      void load();
      return;
    }
    const payload = await response.json().catch(() => null);
    setError(payload?.message ?? '操作失败');
  }

  async function openCleanup() {
    setError('');
    setCleanupOpen(true);
    setCleanupLoading(true);
    setCleanupCounts(null);
    try {
      const response = await fetch('/api/admin/catalog/test-data', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '测试数据统计失败');
        return;
      }
      setCleanupCounts({
        catalogProducts: payload.catalogProducts ?? 0,
        shopProducts: payload.shopProducts ?? 0
      });
    } catch {
      setError('接口不可用');
    } finally {
      setCleanupLoading(false);
    }
  }

  async function cleanupTestData() {
    setCleanupSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/test-data', { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '清理失败');
        return;
      }
      setCleanupOpen(false);
      setCleanupCounts(null);
      setSelectedKeys([]);
      setNotice(
        `已清理 ${payload.catalogProducts ?? 0} 条测试商品、${payload.shopProducts ?? 0} 条门店商品行`
      );
      void load();
      void loadCategories();
    } catch {
      setError('清理失败');
    } finally {
      setCleanupSubmitting(false);
    }
  }

  async function loadSkus(productId: string) {
    setSkuLoading(true);
    setSkuError('');
    try {
      const response = await fetch(`/api/admin/catalog/products/${productId}/skus`, {
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

  function openSkuModal(row: CatalogRow) {
    setSkuProduct(row);
    setSkuModalOpen(true);
    setEditingSku(null);
    setSkuDraft(null);
    setSkuError('');
    void loadSkus(row.id);
  }

  function startCreateSku() {
    if (!skuProduct || skuProduct.status === 'archived') return;
    setEditingSku(null);
    setSkuDraft(emptyCatalogSkuDraft(skuProduct));
    setSkuError('');
  }

  function startEditSku(row: CatalogSkuRow) {
    setEditingSku(row);
    setSkuDraft(catalogSkuDraftFromRow(row));
    setSkuError('');
  }

  function updateSkuDraft(patch: Partial<CatalogSkuDraft>) {
    setSkuDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveSku() {
    if (!skuProduct || !skuDraft) return;
    const defaultPrice = Number(skuDraft.defaultPrice);
    if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
      setSkuError('建议价不合法');
      return;
    }
    if (!skuDraft.specName.trim() || !skuDraft.unit.trim()) {
      setSkuError('规格名称与单位必填');
      return;
    }

    const body = {
      specName: skuDraft.specName.trim(),
      barcode: skuDraft.barcode.trim() || null,
      unit: skuDraft.unit.trim(),
      defaultPrice,
      stockType: skuDraft.stockType,
      quantityMode: skuDraft.quantityMode,
      isDefault: skuDraft.isDefault,
      status: skuDraft.status,
      sortOrder: skuDraft.sortOrder
    };

    setSkuSubmitting(true);
    setSkuError('');
    try {
      const response = await fetch(
        editingSku
          ? `/api/admin/catalog/skus/${editingSku.id}`
          : `/api/admin/catalog/products/${skuProduct.id}/skus`,
        {
          method: editingSku ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        setSkuError(payload?.message ?? '规格保存失败');
        return;
      }
      setEditingSku(null);
      setSkuDraft(null);
      await loadSkus(skuProduct.id);
      void load();
    } catch {
      setSkuError('规格保存失败');
    } finally {
      setSkuSubmitting(false);
    }
  }

  function deleteSku(row: CatalogSkuRow) {
    if (!skuProduct) return;
    Modal.confirm({
      title: `删除规格「${row.specName}」？`,
      content: '已同步到门店的规格不能删除，只能停用。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const response = await fetch(`/api/admin/catalog/skus/${row.id}`, {
          method: 'DELETE'
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setSkuError(payload?.message ?? '删除失败');
          return;
        }
        await loadSkus(skuProduct.id);
        void load();
      }
    });
  }

  const skuColumns: TableColumnsType<CatalogSkuRow> = [
    {
      title: '规格',
      dataIndex: 'specName',
      render: (value: string, row) => (
        <Space size={4}>
          <span>{value}</span>
          {row.isDefault ? <Tag color="blue">默认</Tag> : null}
          {row.status === 'disabled' ? <Tag color="default">停用</Tag> : null}
        </Space>
      )
    },
    { title: '单位', dataIndex: 'unit', width: 70 },
    {
      title: '建议价',
      dataIndex: 'defaultPrice',
      width: 110,
      align: 'right',
      render: (value: string) => `¥${Number(value).toFixed(2)}`
    },
    {
      title: '库存追踪',
      dataIndex: 'stockType',
      width: 100,
      render: (value: CatalogSkuRow['stockType']) => STOCK_TYPE_LABEL[value]
    },
    {
      title: '数量模式',
      dataIndex: 'quantityMode',
      width: 100,
      render: (value: QuantityMode) =>
        value === 'integer' ? <Tag>整数</Tag> : <Tag color="cyan">2 位小数</Tag>
    },
    {
      title: '已铺门店',
      dataIndex: 'shopSkuCount',
      width: 110,
      align: 'right',
      render: (value: number, row) =>
        value > 0 ? `${value} 家（${row.availableShopSkuCount} 启用）` : '—'
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            disabled={skuProduct?.status === 'archived'}
            onClick={() => startEditSku(row)}
          >
            编辑
          </Button>
          {!row.isDefault ? (
            <Button
              size="small"
              danger
              disabled={skuProduct?.status === 'archived'}
              onClick={() => deleteSku(row)}
            >
              删除
            </Button>
          ) : null}
        </Space>
      )
    }
  ];

  const draftSelected = rows.filter((row) => selectedKeys.includes(row.id) && row.status === 'draft');

  const columns: TableColumnsType<CatalogRow> = [
    {
      title: '商品名称',
      dataIndex: 'name',
      width: 200,
      render: (value: string, row) => (
        <Space size={6}>
          <span>{value}</span>
          {row.isTest ? <Tag color="orange">测试</Tag> : null}
          {row.skuCount > 1 ? <Tag>{row.skuCount} 规格</Tag> : null}
          {row.blockedShopCount > 0 ? <Tag color="error">强制下架中</Tag> : null}
        </Space>
      )
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 180,
      render: (_: string | null, row) =>
        row.categoryId ? (categoryPath.get(row.categoryId) ?? row.categoryName ?? '未分类') : '未分类'
    },
    {
      title: '建议价',
      dataIndex: 'defaultPrice',
      width: 100,
      align: 'right',
      render: (value: string) => `¥${Number(value).toFixed(2)}`
    },
    { title: '单位', dataIndex: 'unit', width: 80 },
    {
      title: '库存追踪',
      dataIndex: 'stockType',
      width: 100,
      render: (value: CatalogRow['stockType']) => STOCK_TYPE_LABEL[value]
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: CatalogRow['status']) => (
        <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
      )
    },
    {
      title: '铺货门店',
      dataIndex: 'shopProductCount',
      width: 110,
      align: 'right',
      render: (value: number) => (value > 0 ? `${value} 家` : '—')
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
      width: 220,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row) => (
        <Space size={2}>
          <Tooltip title="编辑">
            <Button
              variant="text"
              color="primary"
              size="small"
              icon={<EditOutlined />}
              aria-label="编辑"
              disabled={row.status === 'archived'}
              onClick={() => openEdit(row)}
            />
          </Tooltip>
          <Tooltip title="规格">
            <Button
              variant="text"
              color="primary"
              size="small"
              icon={<TagsOutlined />}
              aria-label="规格"
              onClick={() => openSkuModal(row)}
            />
          </Tooltip>
          {row.status === 'draft' ? (
            <Tooltip title="发布">
              <Button
                variant="text"
                color="primary"
                size="small"
                icon={<CheckCircleOutlined />}
                aria-label="发布"
                onClick={() => setPublishPrompt({ ids: [row.id], shopCount: row.shopProductCount })}
              />
            </Tooltip>
          ) : null}
          {row.status !== 'archived' ? (
            row.blockedShopCount > 0 ? (
              <Tooltip title="解除强制下架">
                <Button
                  variant="text"
                  color="primary"
                  size="small"
                  icon={<UndoOutlined />}
                  aria-label="解除强制下架"
                  onClick={() => void setOffline(row, false)}
                />
              </Tooltip>
            ) : (
              <Tooltip title="强制下架全部门店">
                <Button
                  variant="text"
                  color="danger"
                  size="small"
                  icon={<StopOutlined />}
                  aria-label="强制下架"
                  onClick={() => {
                    setOfflinePrompt(row);
                    setOfflineReason('');
                  }}
                />
              </Tooltip>
            )
          ) : null}
          {row.status === 'archived' ? (
            <Popconfirm
              title="恢复为草稿？"
              okText="恢复"
              cancelText="取消"
              onConfirm={() => void archive(row, false)}
            >
              <Button variant="text" size="small" icon={<UndoOutlined />} aria-label="恢复为草稿" />
            </Popconfirm>
          ) : (
            <Popconfirm
              title="归档该商品？"
              description="归档后门店侧不再显示，且不可编辑"
              okText="归档"
              cancelText="取消"
              onConfirm={() => void archive(row, true)}
            >
              <Button variant="text" color="danger" size="small" aria-label="归档">
                归档
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ background: colors.surface, minHeight: '100vh' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            height: 44,
            padding: '0 12px',
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <Space size={12}>
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>总部商品库</span>
            <span style={{ fontSize: 12, color: colors.textTertiary }}>
              共享字段总部维护，门店只改价格与上下架
            </span>
          </Space>
          <Space size={8}>
            <Button danger icon={<DeleteOutlined />} onClick={() => void openCleanup()}>
              清理测试数据
            </Button>
            <Button
              icon={<CheckCircleOutlined />}
              disabled={draftSelected.length === 0}
              onClick={() => setPublishPrompt({ ids: draftSelected.map((row) => row.id), shopCount: 0 })}
            >
              {`批量发布${draftSelected.length > 0 ? `（${draftSelected.length}）` : ''}`}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建商品
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 12px 8px',
            flexWrap: 'wrap'
          }}
        >
          <Space.Compact>
            <Input
              allowClear
              value={searchText}
              placeholder="按商品名称搜索…"
              style={{ width: 280 }}
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

          <TreeSelect
            allowClear
            showSearch
            treeDefaultExpandAll
            treeNodeFilterProp="title"
            placeholder="全部分类"
            style={{ width: 200 }}
            value={categoryFilter}
            onChange={(value?: string) => {
              setCategoryFilter(value);
              setPage(1);
            }}
            treeData={tree}
          />

          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 120 }}
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={[
              { value: 'draft', label: '草稿' },
              { value: 'published', label: '已发布' },
              { value: 'archived', label: '已归档' }
            ]}
          />
        </div>

        {error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
        ) : null}
        {notice && !error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>{notice}</div>
        ) : null}

        <Table<CatalogRow>
          rowKey="id"
          loading={loading}
          {...getAdminTableProps(columns)}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys)
          }}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (count) => `共 ${count} 条`,
            style: { margin: '12px' },
            onChange: setPage
          }}
          locale={{
            emptyText: <Empty description="总部商品库为空，点右上角新建；保存后发布即可全店可见" />
          }}
        />
      </div>

      {mounted ? (
        <>
          <Modal
            open={modalOpen}
            title={editing ? '编辑总部商品' : '新建总部商品'}
            okText="保存"
            cancelText="取消"
            confirmLoading={submitting}
            onOk={() => void submit()}
            onCancel={() => setModalOpen(false)}
            width={640}
            forceRender
          >
            <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
              <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
                <Input maxLength={100} />
              </Form.Item>
              <Space size={12} style={{ display: 'flex' }}>
                <Form.Item name="categoryId" label="分类" style={{ width: 240 }}>
                  <TreeSelect
                    allowClear
                    showSearch
                    treeDefaultExpandAll
                    treeNodeFilterProp="title"
                    placeholder="未分类"
                    treeData={tree}
                  />
                </Form.Item>
                <Form.Item
                  name="defaultPrice"
                  label="建议价（元）"
                  tooltip="门店未单独定价时以此价为准"
                  rules={[{ required: true, message: '请输入建议价' }]}
                >
                  <InputNumber style={{ width: 160 }} min={0} max={99999999} precision={2} />
                </Form.Item>
                <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]}>
                  <Input style={{ width: 120 }} maxLength={20} placeholder="斤 / 个 / 袋" />
                </Form.Item>
              </Space>
              <Form.Item name="description" label="商品描述" rules={[{ max: 1000, message: '最多 1000 字' }]}>
                <Input.TextArea rows={3} maxLength={1000} placeholder="选填" />
              </Form.Item>
              <Form.Item name="imageUrl" label="商品图片 URL" rules={[{ type: 'url', message: '请输入合法 URL' }]}>
                <Input placeholder="选填" />
              </Form.Item>
              <Form.Item name="stockType" label="库存追踪" style={{ width: 160 }}>
                <Select
                  options={[
                    { value: 'tracked', label: '追踪库存' },
                    { value: 'untracked', label: '不追踪' }
                  ]}
                />
              </Form.Item>
            </Form>
          </Modal>

          <Modal
            open={skuModalOpen}
            title={skuProduct ? `规格管理 · ${skuProduct.name}` : '规格管理'}
            onCancel={() => setSkuModalOpen(false)}
            width={920}
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
              <Button
                type="primary"
                disabled={skuProduct?.status === 'archived'}
                onClick={startCreateSku}
              >
                新增规格
              </Button>
              <Button
                onClick={() => {
                  if (skuProduct) void loadSkus(skuProduct.id);
                }}
              >
                刷新
              </Button>
              {skuProduct?.status !== 'published' ? (
                <Tag>草稿商品规格不会铺货到门店</Tag>
              ) : null}
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
                      style={{ width: 160 }}
                      value={skuDraft.specName}
                      onChange={(event) => updateSkuDraft({ specName: event.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>条码</div>
                    <Input
                      style={{ width: 150 }}
                      value={skuDraft.barcode}
                      onChange={(event) => updateSkuDraft({ barcode: event.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>单位</div>
                    <Input
                      style={{ width: 90 }}
                      value={skuDraft.unit}
                      onChange={(event) => updateSkuDraft({ unit: event.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>建议价</div>
                    <Input
                      style={{ width: 120 }}
                      value={skuDraft.defaultPrice}
                      onChange={(event) => updateSkuDraft({ defaultPrice: event.target.value })}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>库存追踪</div>
                    <Select
                      style={{ width: 110 }}
                      value={skuDraft.stockType}
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
                      style={{ width: 120 }}
                      value={skuDraft.quantityMode}
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
                      style={{ width: 90 }}
                      min={0}
                      max={9999}
                      precision={0}
                      value={skuDraft.sortOrder}
                      onChange={(value) => updateSkuDraft({ sortOrder: Number(value ?? 0) })}
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
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>启用</div>
                    <Switch
                      checked={skuDraft.status === 'active'}
                      disabled={Boolean(editingSku?.isDefault)}
                      onChange={(checked) =>
                        updateSkuDraft({ status: checked ? 'active' : 'disabled' })
                      }
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
                  默认规格不能停用或删除；共享字段变更会同步到全部门店规格。
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

          <Modal
            open={Boolean(publishPrompt)}
            title="发布商品"
            okText="确认发布"
            cancelText="取消"
            onOk={() => void publish(publishPrompt?.ids ?? [])}
            onCancel={() => setPublishPrompt(null)}
          >
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              将发布 {publishPrompt?.ids.length ?? 0} 个商品。
              <br />
              发布后立即对所有门店可见，并自动铺货到尚未上架的门店；已铺货门店的价格、上下架、排序不会被覆盖。
            </div>
          </Modal>

          <Modal
            open={cleanupOpen}
            title="清理测试数据"
            okText="确认清理"
            okButtonProps={{
              danger: true,
              disabled:
                cleanupLoading ||
                cleanupSubmitting ||
                !cleanupCounts ||
                (cleanupCounts.catalogProducts === 0 && cleanupCounts.shopProducts === 0)
            }}
            confirmLoading={cleanupSubmitting}
            cancelText="取消"
            onOk={() => void cleanupTestData()}
            onCancel={() => {
              if (!cleanupSubmitting) setCleanupOpen(false);
            }}
          >
            {cleanupLoading ? (
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>正在统计测试数据…</div>
            ) : cleanupCounts ? (
              cleanupCounts.catalogProducts === 0 && cleanupCounts.shopProducts === 0 ? (
                <div style={{ fontSize: 14, lineHeight: 1.8 }}>当前没有标记为测试的数据。</div>
              ) : (
                <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                  将删除 <strong>{cleanupCounts.catalogProducts}</strong> 条总部测试商品、
                  <strong>{cleanupCounts.shopProducts}</strong> 条门店商品行。
                  <br />
                  门店库存随商品级联删除；只删除 <code>is_test = true</code> 的数据，正式商品不受影响。
                  该操作不可撤销。
                </div>
              )
            ) : (
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>统计失败，请关闭后重试。</div>
            )}
          </Modal>

          <Modal
            open={Boolean(offlinePrompt)}
            title="强制下架"
            okText="确认下架"
            okButtonProps={{ danger: true, disabled: offlineReason.trim().length === 0 }}
            cancelText="取消"
            onOk={() => void setOffline(offlinePrompt as CatalogRow, true, offlineReason.trim())}
            onCancel={() => setOfflinePrompt(null)}
          >
            <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>
              「{offlinePrompt?.name}」将在全部门店立即下架，门店无法自行恢复，需总部解除。
            </div>
            <Input.TextArea
              rows={3}
              maxLength={200}
              value={offlineReason}
              placeholder="下架原因（必填，门店可见）：如食品安全、资质过期"
              onChange={(event) => setOfflineReason(event.target.value)}
            />
          </Modal>
        </>
      ) : null}
    </div>
  );
}
