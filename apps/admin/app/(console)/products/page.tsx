'use client';

// 门店商品管理（多店方案 P5 后）：
// - 分类：总部共享树，门店只能隐藏/显示（写接口已下线）
// - 商品：共享字段只读，门店只维护售价（可跟随建议价）、上下架、库存策略、排序
// - 总部强制下架期间，门店不能上架，也不能删除该商品
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import {
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
  StopOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';

interface ShopOption {
  id: string;
  name: string;
}

interface CatalogNode {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
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
  const watchedStockType = Form.useWatch('stockType', productForm);
  const [submitting, setSubmitting] = useState(false);

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
      stockQuantity: row.stockQuantity,
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
      // 库存是门店级独立写口：与商品字段分开保存，避免总部字段被覆盖
      if (
        values.stockType === 'tracked' &&
        typeof values.stockQuantity === 'number' &&
        values.stockQuantity !== editingProduct.row.stockQuantity
      ) {
        const stockResponse = await fetch(`/api/admin/products/${editingProduct.row.id}/stock`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quantity: values.stockQuantity })
        });
        if (!stockResponse.ok) {
          const stockPayload = await stockResponse.json().catch(() => null);
          setError(stockPayload?.message ?? '商品已保存，但库存更新失败');
          void loadProducts();
          return;
        }
      }
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

  const categoryColumns: TableColumnsType<CatalogTreeRow> = [
    {
      title: '分类名称',
      dataIndex: 'name',
      render: (value: string, row) => (
        <Space size={6}>
          <span>{value}</span>
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
      width: 200,
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
      width: 110,
      align: 'right',
      render: (value: number, row) =>
        row.stockType === 'tracked' ? (
          <span>{value}</span>
        ) : (
          <Tag color="default">不追踪</Tag>
        )
    },
    {
      title: '状态',
      dataIndex: 'isAvailable',
      width: 120,
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
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row) => (
        <Space size={2}>
          <Tooltip title="编辑售价/上下架/库存">
            <Button
              variant="text"
              color="primary"
              size="small"
              icon={<EditOutlined />}
              aria-label="编辑"
              onClick={() => openProductEdit(row)}
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
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>商品管理</span>
          <span style={{ fontSize: 12, color: colors.textTertiary }}>
            商品由总部商品库统一发布，门店维护价格与上下架
          </span>
        </Space>
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
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as 'products' | 'categories')}
        tabBarStyle={{ margin: 0, padding: '0 12px' }}
        items={[
          { key: 'products', label: '商品' },
          { key: 'categories', label: '分类可见性' }
        ]}
      />

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
            <Space.Compact>
              <Input
                allowClear
                value={searchText}
                placeholder={tab === 'products' ? '按商品名称搜索…' : '按分类名称搜索…'}
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

            {tab === 'products' ? (
              <>
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
                  treeData={catalogTreeData}
                />
                <Select
                  allowClear
                  placeholder="全部状态"
                  style={{ width: 120 }}
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
              columns={categoryColumns}
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
                  <Empty description="总部尚未配置分类，请在「总部商品库」中创建商品时选择分类" />
                )
              }}
            />
          ) : (
            <Table<ProductRow>
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={rows}
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
              <Form.Item name="stockType" label="库存追踪" style={{ width: 160 }}>
                <Select
                  options={[
                    { value: 'tracked', label: '追踪库存' },
                    { value: 'untracked', label: '不追踪' }
                  ]}
                />
              </Form.Item>
            </Space>
            <Space size={24} style={{ display: 'flex' }} align="start">
              <Form.Item
                name="stockQuantity"
                label="库存数量"
                tooltip="仅本店库存，不影响其他门店"
              >
                <InputNumber
                  style={{ width: 120 }}
                  min={0}
                  max={999999}
                  precision={0}
                  disabled={watchedStockType !== 'tracked'}
                />
              </Form.Item>
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
    </div>
  );
}
