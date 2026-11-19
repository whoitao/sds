'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { adminColors as colors } from '../../../lib/theme';
import { getAdminTableProps } from '../../../lib/table';
import {
  AdminFilterField,
  AdminFilterSearch,
  AdminListPage
} from '../../../components/AdminListPage';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TestDataCleanupButton } from '../../../components/TestDataCleanupButton';
import { useConfirmDanger } from '../../../components/AdminConfirmProvider';

interface AdminOption {
  id: string;
  username: string;
  displayName: string;
  status: number;
}

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  type: 'hq' | 'regional';
  address: string | null;
  coldZoneSupported: boolean;
  status: 'active' | 'disabled';
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPE_META: Record<WarehouseRow['type'], { label: string; color: string }> = {
  hq: { label: '总部仓', color: 'blue' },
  regional: { label: '区域仓', color: 'geekblue' }
};

const STATUS_META: Record<WarehouseRow['status'], { label: string; color: string }> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' }
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

/** 仓库管理页第一个 Tab：仓库列表与成员维护 */
export function WarehouseListPanel({ header }: { header: ReactNode }) {
  const { pageSize } = useAdminSettings();
  const confirmDanger = useConfirmDanger();
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mounted, setMounted] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const [memberOpen, setMemberOpen] = useState(false);
  const [memberWarehouse, setMemberWarehouse] = useState<WarehouseRow | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberCandidates, setMemberCandidates] = useState<AdminOption[]>([]);

  // 全局「每页条数」变化后回到第 1 页重新加载
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
    if (type) params.set('type', type);
    if (status) params.set('status', status);

    try {
      const response = await fetch(`/api/admin/warehouses?${params}`, { cache: 'no-store' });
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
  }, [keyword, type, status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setMounted(true);
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'hq', status: 'active', coldZoneSupported: false });
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  function openEdit(row: WarehouseRow) {
    setEditing(row);
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      type: row.type,
      address: row.address ?? '',
      coldZoneSupported: row.coldZoneSupported,
      status: row.status,
      remark: row.remark ?? ''
    });
    setError('');
    setNotice('');
    setFormOpen(true);
  }

  async function submitWarehouse() {
    const values = await form.validateFields();
    if (editing && editing.status === 'active' && values.status === 'disabled') {
      const confirmed = await confirmDanger({
        title: `停用仓库「${values.name}」？`,
        content: '停用后该仓库不能再入库、分拨或盘点，已有库存与单据保留；可重新启用。',
        okText: '确认停用'
      });
      if (!confirmed) return;
    }
    setSubmitting(true);
    setError('');
    try {
      const url = `/api/admin/warehouses${editing ? `/${editing.id}` : ''}`;
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          address: values.address || null,
          remark: values.remark || null
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '保存失败');
        return;
      }
      setFormOpen(false);
      setNotice(editing ? '仓库已更新' : '仓库已创建');
      void load();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function openMembers(row: WarehouseRow) {
    setMemberWarehouse(row);
    setMemberOpen(true);
    setMemberLoading(true);
    setMemberError('');
    setMemberIds([]);
    setMemberCandidates([]);
    try {
      const response = await fetch(`/api/admin/warehouses/${row.id}/members`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setMemberError(payload?.message ?? '加载成员失败');
        return;
      }
      setMemberIds((payload.items ?? []).map((item: AdminOption) => item.id));
      setMemberCandidates(payload.candidates ?? []);
    } catch {
      setMemberError('接口不可用');
    } finally {
      setMemberLoading(false);
    }
  }

  async function submitMembers() {
    if (!memberWarehouse) return;
    setMemberSaving(true);
    setMemberError('');
    try {
      const response = await fetch(`/api/admin/warehouses/${memberWarehouse.id}/members`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminUserIds: memberIds })
      });
      const payload = await response.json();
      if (!response.ok) {
        setMemberError(payload?.message ?? '保存失败');
        return;
      }
      setMemberOpen(false);
      setNotice(`「${memberWarehouse.name}」成员已更新`);
    } catch {
      setMemberError('保存失败');
    } finally {
      setMemberSaving(false);
    }
  }

  const columns: TableColumnsType<WarehouseRow> = [
    { title: '编码', dataIndex: 'code', width: 140 },
    { title: '仓库名称', dataIndex: 'name', width: 180 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (value: WarehouseRow['type']) => (
        <Tag color={TYPE_META[value].color}>{TYPE_META[value].label}</Tag>
      )
    },
    { title: '地址', dataIndex: 'address', width: 240, ellipsis: true, render: (value: string | null) => value || '—' },
    {
      title: '冷链',
      dataIndex: 'coldZoneSupported',
      width: 80,
      render: (value: boolean) => (value ? '支持' : '不支持')
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: WarehouseRow['status']) => (
        <Tag color={STATUS_META[value].color}>{STATUS_META[value].label}</Tag>
      )
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (value: string) => formatTime(value)
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row: WarehouseRow) => (
        <Space size={0}>
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<TeamOutlined />}
            title="成员管理"
            aria-label="成员管理"
            onClick={() => void openMembers(row)}
          />
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<EditOutlined />}
            title="编辑"
            aria-label="编辑"
            onClick={() => openEdit(row)}
          />
        </Space>
      )
    }
  ];

  return (
    <div>
      <AdminListPage
        header={header}
        actions={
          <Space size={8}>
            <TestDataCleanupButton onCleaned={() => void load()} />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建仓库
            </Button>
          </Space>
        }
        filters={
          <>
            <AdminFilterSearch
              value={searchText}
              placeholder="按编码/名称/地址搜索…"
              onChange={(value) => {
                setSearchText(value);
                if (!value) {
                  setKeyword('');
                  setPage(1);
                }
              }}
              onSearch={() => {
                setKeyword(searchText.trim());
                setPage(1);
              }}
            />
            <AdminFilterField>
              <Select
                allowClear
                placeholder="全部类型"
                value={type}
                onChange={(value) => {
                  setType(value);
                  setPage(1);
                }}
                options={[
                  { value: 'hq', label: '总部仓' },
                  { value: 'regional', label: '区域仓' }
                ]}
              />
            </AdminFilterField>
            <AdminFilterField>
              <Select
                allowClear
                placeholder="全部状态"
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
            </AdminFilterField>
          </>
        }
        notice={
          <>
            {error ? (
              <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>
                {error}
              </div>
            ) : null}
            {notice && !error ? (
              <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.textSecondary }}>
                {notice}
              </div>
            ) : null}
          </>
        }
      >
        <Table<WarehouseRow>
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
      </AdminListPage>

      {mounted ? (
        <Modal
          open={formOpen}
          title={editing ? '编辑仓库' : '新建仓库'}
          okText="保存"
          cancelText="取消"
          confirmLoading={submitting}
          onOk={() => void submitWarehouse()}
          onCancel={() => setFormOpen(false)}
          width={640}
          forceRender
        >
          <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item
                name="code"
                label="仓库编码"
                rules={[{ required: true, message: '请输入仓库编码' }]}
              >
                <Input maxLength={32} placeholder="如 HQ" />
              </Form.Item>
              <Form.Item
                name="name"
                label="仓库名称"
                rules={[{ required: true, message: '请输入仓库名称' }]}
              >
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="type" label="仓库类型" rules={[{ required: true, message: '请选择类型' }]}>
                <Select
                  options={[
                    { value: 'hq', label: '总部仓' },
                    { value: 'regional', label: '区域仓' }
                  ]}
                />
              </Form.Item>
              <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
                <Select
                  options={[
                    { value: 'active', label: '启用' },
                    { value: 'disabled', label: '停用' }
                  ]}
                />
              </Form.Item>
            </div>
            <Form.Item name="address" label="仓库地址">
              <Input maxLength={300} placeholder="选填" />
            </Form.Item>
            <Form.Item
              name="coldZoneSupported"
              label="支持冷链"
              valuePropName="checked"
              extra="仅作为仓库能力标记，本期不改变库存记账逻辑"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="remark" label="备注" rules={[{ max: 500, message: '最多 500 字' }]}>
              <Input.TextArea rows={3} maxLength={500} placeholder="选填" />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}

      <Modal
        open={memberOpen}
        title={memberWarehouse ? `成员管理 · ${memberWarehouse.name}` : '成员管理'}
        okText="保存"
        cancelText="取消"
        confirmLoading={memberSaving}
        onOk={() => void submitMembers()}
        onCancel={() => setMemberOpen(false)}
        width={560}
        forceRender
      >
        {memberError ? (
          <div style={{ marginBottom: 8, fontSize: 13, color: colors.danger }}>{memberError}</div>
        ) : null}
        <div style={{ marginBottom: 8, fontSize: 13, color: colors.textSecondary }}>
          只有被绑定的管理员才能查看和维护该仓库。
        </div>
        <Select
          mode="multiple"
          allowClear
          loading={memberLoading}
          value={memberIds}
          onChange={(value) => setMemberIds(value)}
          placeholder="选择管理员"
          optionFilterProp="label"
          style={{ width: '100%' }}
          options={memberCandidates.map((item) => ({
            value: item.id,
            label: `${item.displayName}（${item.username}）`
          }))}
        />
      </Modal>
    </div>
  );
}
