'use client';

// 购物车管理：只读查看顾客购物车（与移动端同一份 carts / cart_items）
// 列表沿用后台紧凑规格：通栏表头、筛选行、固定操作列、Tag、分页跟随全局每页条数
import { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Empty, Input, Select, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { EyeOutlined, SearchOutlined } from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';

interface ShopOption {
  id: string;
  name: string;
}

interface CartRow {
  id: string;
  shopId: string;
  shopName: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  remark: string;
  itemCount: number;
  totalAmount: string;
  updatedAt: string;
}

interface CartDetailItem {
  id: string;
  productId: string;
  name: string;
  unit: string;
  unitPrice: string;
  quantity: number;
  subtotal: string;
}

interface CartDetail {
  id: string;
  shopName: string;
  customerName: string;
  customerPhone: string | null;
  remark: string;
  updatedAt: string;
  itemCount: number;
  totalAmount: string;
  items: CartDetailItem[];
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export default function CartsPage() {
  const { pageSize } = useAdminSettings();
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [rows, setRows] = useState<CartRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [shopId, setShopId] = useState<string | undefined>();
  const [customer, setCustomer] = useState('');
  const [productName, setProductName] = useState('');
  const [customerInput, setCustomerInput] = useState('');
  const [productInput, setProductInput] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<CartDetail | null>(null);

  useEffect(() => {
    async function loadShops() {
      try {
        const response = await fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' });
        const payload = await response.json();
        setShops(response.ok ? (payload.items ?? []) : []);
      } catch {
        setShops([]);
      }
    }
    void loadShops();
  }, []);

  const loadCarts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (shopId) query.set('shopId', shopId);
      if (customer.trim()) query.set('customer', customer.trim());
      if (productName.trim()) query.set('productName', productName.trim());
      const response = await fetch(`/api/admin/carts?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '购物车加载失败');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(payload.items ?? []);
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [customer, page, pageSize, productName, shopId]);

  useEffect(() => {
    void loadCarts();
  }, [loadCarts]);

  async function openDetail(row: CartRow) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/admin/carts/${row.id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '明细加载失败');
        return;
      }
      setDetail(payload as CartDetail);
    } catch {
      setError('接口不可用');
    } finally {
      setDetailLoading(false);
    }
  }

  function submitSearch() {
    setCustomer(customerInput);
    setProductName(productInput);
    setPage(1);
  }

  const columns: TableColumnsType<CartRow> = [
    {
      title: '门店',
      dataIndex: 'shopName',
      width: 180,
      ellipsis: true
    },
    {
      title: '顾客',
      dataIndex: 'customerName',
      width: 180,
      render: (_, row) => (
        <Space size={6} orientation="vertical" style={{ lineHeight: 1.4 }}>
          <span>{row.customerName}</span>
          <span style={{ fontSize: 12, color: colors.textTertiary }}>{row.customerPhone ?? '—'}</span>
        </Space>
      )
    },
    {
      title: '条目数',
      dataIndex: 'itemCount',
      width: 96,
      align: 'center',
      render: (value: number) => <Tag color="blue">{value} 条</Tag>
    },
    {
      title: '合计',
      dataIndex: 'totalAmount',
      width: 110,
      align: 'right',
      render: (value: string) => `¥${value}`
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      render: (value: string) =>
        value ? value : <span style={{ color: colors.textTertiary }}>—</span>
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => formatTime(value)
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(row)}>
          查看明细
        </Button>
      )
    }
  ];

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
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>购物车管理</span>
          <span style={{ fontSize: 12, color: colors.textTertiary }}>
            顾客在移动端加入的购物车，与顾客端实时同一份数据
          </span>
        </Space>
        <span style={{ fontSize: 12, color: colors.textTertiary }}>共 {total} 个购物车</span>
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
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="全部门店"
          style={{ width: 200 }}
          value={shopId}
          onChange={(value) => {
            setShopId(value);
            setPage(1);
          }}
          options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
        />
        <Input
          allowClear
          value={customerInput}
          placeholder="按顾客姓名或手机号搜索…"
          style={{ width: 220 }}
          onChange={(event) => {
            const value = event.target.value;
            setCustomerInput(value);
            if (!value) {
              setCustomer('');
              setPage(1);
            }
          }}
          onPressEnter={submitSearch}
        />
        <Input
          allowClear
          value={productInput}
          placeholder="按商品名称搜索…"
          style={{ width: 200 }}
          onChange={(event) => {
            const value = event.target.value;
            setProductInput(value);
            if (!value) {
              setProductName('');
              setPage(1);
            }
          }}
          onPressEnter={submitSearch}
        />
        <Button
          icon={<SearchOutlined />}
          style={{ background: colors.subtle, borderColor: colors.border, color: colors.textSecondary }}
          onClick={submitSearch}
        >
          查询
        </Button>
      </div>

      {error ? (
        <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
      ) : null}

      <Table<CartRow>
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
          style: { margin: '12px' },
          onChange: setPage
        }}
        locale={{
          emptyText: <Empty description="暂无购物车数据，顾客在移动端加入商品后会出现在这里" />
        }}
      />

      <Drawer
        open={detailOpen}
        title="购物车明细"
        size="large"
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
      >
        {detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                rowGap: 8,
                columnGap: 8,
                fontSize: 13
              }}
            >
              <span style={{ color: colors.textTertiary }}>门店</span>
              <span>{detail.shopName}</span>
              <span style={{ color: colors.textTertiary }}>顾客</span>
              <span>
                {detail.customerName}
                <span style={{ marginLeft: 8, color: colors.textTertiary }}>
                  {detail.customerPhone ?? '—'}
                </span>
              </span>
              <span style={{ color: colors.textTertiary }}>最后更新</span>
              <span>{formatTime(detail.updatedAt)}</span>
              <span style={{ color: colors.textTertiary }}>备注</span>
              <span>{detail.remark || '—'}</span>
            </div>

            <Table<CartDetailItem>
              rowKey="id"
              size="small"
              {...getAdminTableProps<CartDetailItem>([
                { title: '商品', dataIndex: 'name', ellipsis: true },
                {
                  title: '单价',
                  dataIndex: 'unitPrice',
                  width: 90,
                  align: 'right',
                  render: (value: string, row) => `¥${value}/${row.unit}`
                },
                { title: '数量', dataIndex: 'quantity', width: 70, align: 'center' },
                {
                  title: '小计',
                  dataIndex: 'subtotal',
                  width: 90,
                  align: 'right',
                  render: (value: string) => `¥${value}`
                }
              ])}
              dataSource={detail.items}
              pagination={false}
              locale={{ emptyText: <Empty description="购物车已无条目" /> }}
            />

            <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600 }}>
              共 {detail.itemCount} 样，合计 ¥{detail.totalAmount}
            </div>
          </div>
        ) : (
          <Empty description={detailLoading ? '正在加载明细…' : '暂无明细'} />
        )}
      </Drawer>
    </div>
  );
}
