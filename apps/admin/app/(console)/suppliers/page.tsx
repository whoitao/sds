'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';

interface SupplierRow {
  id: string;
  code: string | null;
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  settlementMethod: string | null;
  taxNo: string | null;
  email: string | null;
  remark: string | null;
  status: 'active' | 'disabled';
  lastPurchaseAt: string | null;
  shopIds: string[];
  shopCount: number;
  warehouseIds: string[];
  warehouseCount: number;
}

interface ShopOption {
  id: string;
  name: string;
  status: string;
}

interface WarehouseOption {
  id: string;
  name: string;
  status: string;
}

interface SupplierScopeItem {
  subjectType: 'shop' | 'warehouse';
  subjectId: string;
  subjectName: string;
  status: string;
}

const STATUS_META: Record<SupplierRow['status'], { label: string; color: string }> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' }
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export default function SuppliersPage() {
  const { pageSize } = useAdminSettings();
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mounted, setMounted] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const [shops, setShops] = useState<ShopOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  /** 编辑时保留非启用状态的供货范围，避免全量替换把停用关系一并清掉 */
  const [inactiveScopes, setInactiveScopes] = useState<SupplierScopeItem[]>([]);

  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (status) params.set('status', status);

    try {
      const response = await fetch(`/api/admin/suppliers?${params}`, { cache: 'no-store' });
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
  }, [keyword, status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setMounted(true);
    void (async () => {
      const [shopResult, warehouseResult] = await Promise.all([
        fetch('/api/admin/shops?page=1&pageSize=100', { cache: 'no-store' })
          .then(async (response) => ((await response.json())?.items ?? []) as ShopOption[])
          .catch(() => [] as ShopOption[]),
        fetch('/api/admin/warehouses?page=1&pageSize=100', { cache: 'no-store' })
          .then(async (response) => ((await response.json())?.items ?? []) as WarehouseOption[])
          .catch(() => [] as WarehouseOption[])
      ]);
      setShops(shopResult);
      setWarehouses(warehouseResult);
    })();
  }, []);

  function openCreate() {
    setEditing(null);
    setInactiveScopes([]);
    form.resetFields();
    form.setFieldsValue({ status: 'active', shopIds: [], warehouseIds: [] });
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  async function openEdit(row: SupplierRow) {
    setEditing(row);
    form.setFieldsValue({
      code: row.code ?? '',
      name: row.name,
      contactName: row.contactName ?? '',
      phone: row.phone ?? '',
      address: row.address ?? '',
      settlementMethod: row.settlementMethod ?? '',
      taxNo: row.taxNo ?? '',
      email: row.email ?? '',
      remark: row.remark ?? '',
      status: row.status,
      shopIds: row.shopIds ?? [],
      warehouseIds: row.warehouseIds ?? []
    });
    setError('');
    setNotice('');
    setFormOpen(true);

    try {
      const response = await fetch(`/api/admin/suppliers/${row.id}/scopes`, {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) return;
      const items = (payload.items ?? []) as SupplierScopeItem[];
      const active = items.filter((item) => item.status === 'active');
      setInactiveScopes(items.filter((item) => item.status !== 'active'));
      form.setFieldsValue({
        shopIds: active.filter((item) => item.subjectType === 'shop').map((item) => item.subjectId),
        warehouseIds: active
          .filter((item) => item.subjectType === 'warehouse')
          .map((item) => item.subjectId)
      });
    } catch {
      // 供货范围读取失败时沿用列表数据，保存时会再次提交
    }
  }

  async function submitSupplier() {
    const values = await form.validateFields();
    setSubmitting(true);
    setError('');
    const payload = {
      code: values.code?.trim() || null,
      name: values.name.trim(),
      contactName: values.contactName?.trim() || null,
      phone: values.phone?.trim() || null,
      address: values.address?.trim() || null,
      settlementMethod: values.settlementMethod?.trim() || null,
      taxNo: values.taxNo?.trim() || null,
      email: values.email?.trim() || null,
      remark: values.remark?.trim() || null,
      status: values.status
    };
    try {
      const response = await fetch(
        `/api/admin/suppliers${editing ? `/${editing.id}` : ''}`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      const result = await response.json();
      if (!response.ok) {
        setError(result?.message ?? '保存失败');
        return;
      }
      const supplierId: string = editing ? editing.id : result.item.id;
      const shopIds: string[] = values.shopIds ?? [];
      const warehouseIds: string[] = values.warehouseIds ?? [];
      const scopes = [
        ...shopIds.map((subjectId) => ({ subjectType: 'shop', subjectId, status: 'active' })),
        ...warehouseIds.map((subjectId) => ({
          subjectType: 'warehouse',
          subjectId,
          status: 'active'
        })),
        ...inactiveScopes
          .filter((item) =>
            item.subjectType === 'shop'
              ? !shopIds.includes(item.subjectId)
              : !warehouseIds.includes(item.subjectId)
          )
          .map((item) => ({
            subjectType: item.subjectType,
            subjectId: item.subjectId,
            status: item.status
          }))
      ];
      const scopeResponse = await fetch(`/api/admin/suppliers/${supplierId}/scopes`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopes })
      });
      const scopeResult = await scopeResponse.json();
      if (!scopeResponse.ok) {
        setError(scopeResult?.message ?? '供应商已保存，但供货范围更新失败');
        void load();
        return;
      }
      setFormOpen(false);
      setNotice(editing ? '供应商已更新' : '供应商已创建');
      void load();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  const columns: TableColumnsType<SupplierRow> = [
    { title: '名称', dataIndex: 'name', width: 220, ellipsis: true },
    {
      title: '编码',
      dataIndex: 'code',
      width: 120,
      render: (value: string | null) => value || '—'
    },
    {
      title: '联系人',
      dataIndex: 'contactName',
      width: 110,
      render: (value: string | null) => value || '—'
    },
    {
      title: '电话',
      dataIndex: 'phone',
      width: 140,
      render: (value: string | null) => value || '—'
    },
    {
      title: '供货范围',
      key: 'scopeCount',
      width: 140,
      render: (_: unknown, row: SupplierRow) => (
        <span>
          {row.shopCount} 店 · {row.warehouseCount} 仓
        </span>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: SupplierRow['status']) => (
        <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
      )
    },
    {
      title: '最近采购时间',
      dataIndex: 'lastPurchaseAt',
      width: 170,
      render: (value: string | null) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row: SupplierRow) => (
        <Button
          variant="text"
          color="primary"
          size="small"
          icon={<EditOutlined />}
          title="编辑"
          aria-label="编辑"
          onClick={() => openEdit(row)}
        />
      )
    }
  ];

  return (
    <div>
      <div style={{ background: colors.surface, minHeight: '100vh' }}>
        <div className="admin-page-bar">
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>供应商档案</span>
          <Space size={8}>
            <TestDataCleanupButton onCleaned={() => void load()} />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建供应商
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
          <Space.Compact style={{ width: ADMIN_FILTER_FIELD_WIDTH }}>
            <Input
              allowClear
              value={searchText}
              placeholder="按名称/编码/联系人/电话搜索…"
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
              style={{
                background: colors.subtle,
                borderColor: colors.border,
                color: colors.textSecondary
              }}
              onClick={() => {
                setKeyword(searchText.trim());
                setPage(1);
              }}
            />
          </Space.Compact>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '停用' }
            ]}
          />
        </div>

        {error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
        ) : null}
        {notice && !error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>
            {notice}
          </div>
        ) : null}

        <Table<SupplierRow>
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
        />
      </div>

      {mounted ? (
        <Modal
          open={formOpen}
          title={editing ? '编辑供应商' : '新建供应商'}
          okText="保存"
          cancelText="取消"
          confirmLoading={submitting}
          onOk={() => void submitSupplier()}
          onCancel={() => setFormOpen(false)}
          width={720}
          forceRender
        >
          <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item
                name="name"
                label="供应商名称"
                rules={[{ required: true, message: '请输入供应商名称' }]}
              >
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="code" label="供应商编码">
                <Input maxLength={32} placeholder="选填，平台内唯一" />
              </Form.Item>
              <Form.Item name="contactName" label="联系人">
                <Input maxLength={50} placeholder="选填" />
              </Form.Item>
              <Form.Item name="phone" label="联系电话">
                <Input maxLength={30} placeholder="选填" />
              </Form.Item>
              <Form.Item name="settlementMethod" label="结算方式">
                <Input maxLength={32} placeholder="如 月结 30 天" />
              </Form.Item>
              <Form.Item name="taxNo" label="税号">
                <Input maxLength={50} placeholder="选填" />
              </Form.Item>
              <Form.Item
                name="email"
                label="邮箱"
                rules={[{ type: 'email', message: '邮箱格式不合法' }]}
              >
                <Input maxLength={120} placeholder="选填" />
              </Form.Item>
              <Form.Item name="status" label="启用状态">
                <Select
                  options={[
                    { value: 'active', label: '启用' },
                    { value: 'disabled', label: '停用' }
                  ]}
                />
              </Form.Item>
            </div>
            <Form.Item name="address" label="地址">
              <Input maxLength={300} placeholder="选填" />
            </Form.Item>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontSize: 14, color: colors.text }}>供货范围</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Form.Item name="shopIds" label="门店" style={{ marginBottom: 0 }}>
                  <Select
                    mode="multiple"
                    allowClear
                    optionFilterProp="label"
                    placeholder="选择供货门店"
                    options={shops.map((shop) => ({
                      value: shop.id,
                      label: shop.status !== 'open' ? `${shop.name}（未启用）` : shop.name
                    }))}
                  />
                </Form.Item>
                <Form.Item name="warehouseIds" label="总部仓" style={{ marginBottom: 0 }}>
                  <Select
                    mode="multiple"
                    allowClear
                    optionFilterProp="label"
                    placeholder="选择供货仓库"
                    options={warehouses.map((warehouse) => ({
                      value: warehouse.id,
                      label:
                        warehouse.status === 'active'
                          ? warehouse.name
                          : `${warehouse.name}（未启用）`
                    }))}
                  />
                </Form.Item>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: colors.textSecondary }}>
                采购下单时按这里的绑定过滤供应商；停用供应商不会出现在采购选择中，历史采购单不受影响
              </div>
            </div>
            <Form.Item name="remark" label="备注" rules={[{ max: 500, message: '最多 500 字' }]}>
              <Input.TextArea rows={3} maxLength={500} placeholder="选填" />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
    </div>
  );
}
