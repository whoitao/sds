'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined
} from '@ant-design/icons';
import { ROLE_LABELS, type Role } from '@sds/shared';
import { adminColors as colors } from '../../../lib/theme';
import { ADMIN_FILTER_FIELD_WIDTH, getAdminTableProps } from '../../../lib/table';
import { AdminPermissionPanel } from '../../../components/AdminPermissionPanel';
import { useAdminSettings } from '../../../components/AdminSettingsProvider';
import { TabProgress } from '../../../components/TabProgress';

interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface AdminRow {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: number;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AddressRow {
  id: string;
  contactName: string;
  contactPhone: string;
  province: string | null;
  city: string | null;
  district: string | null;
  detail: string;
  remark: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AddressCustomer {
  id: string;
  nickname: string | null;
  realName: string | null;
  phone: string;
}

// 业务用户只保留顾客/店长/店员/配送员；平台管理员属于 admin_users，不在此出现
const ROLE_OPTIONS = Object.entries(ROLE_LABELS)
  .filter(([value]) => value !== 'platform_admin')
  .map(([value, label]) => ({ value, label }));

const ADMIN_ROLE_OPTIONS = [
  { value: 'platform_admin', label: ROLE_LABELS.platform_admin },
  { value: 'shop_manager', label: ROLE_LABELS.shop_manager }
];

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function roleLabel(value: string) {
  return ROLE_LABELS[value as Role] ?? value;
}

export default function UsersPage() {
  const { pageSize } = useAdminSettings();
  const [tab, setTab] = useState('users');
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  const [role, setRole] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [adminRows, setAdminRows] = useState<AdminRow[]>([]);
  const [total, setTotal] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 地址抽屉：只读查看某个用户（顾客）的收货地址
  const [addressUser, setAddressUser] = useState<UserRow | null>(null);
  const [addressCustomer, setAddressCustomer] = useState<AddressCustomer | null>(null);
  const [addressItems, setAddressItems] = useState<AddressRow[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState('');

  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [editingAdmin, setEditingAdmin] = useState<AdminRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  // 全局「每页条数」变化后回到第 1 页重新加载
  const [appliedPageSize, setAppliedPageSize] = useState(pageSize);
  if (pageSize !== appliedPageSize) {
    setAppliedPageSize(pageSize);
    setPage(1);
  }

  const load = useCallback(async () => {
    // 权限 tab 的数据由 AdminPermissionPanel 自行加载
    if (tab === 'rbac') return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (tab === 'users' && role) params.set('role', role);

    try {
      const response = await fetch(`/api/admin/${tab === 'users' ? 'users' : 'admins'}?${params}`, {
        cache: 'no-store'
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '加载失败');
        return;
      }
      if (tab === 'users') {
        setUserRows(payload.items ?? []);
      } else {
        setAdminRows(payload.items ?? []);
      }
      setTotal(payload.total ?? 0);
    } catch {
      setError('接口不可用');
    } finally {
      setLoading(false);
    }
  }, [tab, keyword, role, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // Modal 通过 portal 渲染到 body，服务端不产出节点；forceRender 会让客户端首帧多出
  // 一份 DOM 造成 hydration 不一致。等客户端挂载后再渲染 Modal（第 405 行已加 mounted 门控）。
  useEffect(() => {
    setMounted(true);
  }, []);

  function openCreate() {
    setEditingUser(null);
    setEditingAdmin(null);
    form.resetFields();
    if (tab === 'users') {
      form.setFieldsValue({ role: 'customer' });
    } else {
      form.setFieldsValue({ role: 'platform_admin', status: 1 });
    }
    setModalOpen(true);
  }

  function openEditUser(row: UserRow) {
    setEditingUser(row);
    setEditingAdmin(null);
    form.setFieldsValue({ phone: row.phone, name: row.name ?? '', role: row.role });
    setModalOpen(true);
  }

  function openEditAdmin(row: AdminRow) {
    setEditingAdmin(row);
    setEditingUser(null);
    form.setFieldsValue({ username: row.username, displayName: row.displayName, role: row.role, status: row.status });
    setModalOpen(true);
  }

  async function submit() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const isUsers = tab === 'users';
      const editingId = isUsers ? editingUser?.id : editingAdmin?.id;
      const url = `/api/admin/${isUsers ? 'users' : 'admins'}${editingId ? `/${editingId}` : ''}`;

      let body: Record<string, unknown>;
      if (isUsers) {
        body = { phone: values.phone, name: values.name || null, role: values.role };
        if (!editingId) delete body.name;
      } else if (editingId) {
        body = { displayName: values.displayName, role: values.role, status: values.status };
      } else {
        body = {
          username: values.username,
          password: values.password,
          displayName: values.displayName,
          role: values.role,
          status: values.status
        };
      }

      const response = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '保存失败');
        return;
      }
      setModalOpen(false);
      void load();
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleUser(row: UserRow) {
    const response = await fetch(`/api/admin/users/${row.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive })
    });
    if (response.ok) void load();
  }

  async function toggleAdmin(row: AdminRow) {
    const response = await fetch(`/api/admin/admins/${row.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: row.status === 1 ? 0 : 1 })
    });
    if (response.ok) void load();
  }

  async function openAddresses(row: UserRow) {
    setAddressUser(row);
    setAddressCustomer(null);
    setAddressItems([]);
    setAddressError('');
    setAddressLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${row.id}/addresses`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setAddressError(payload?.message ?? '加载失败');
        return;
      }
      setAddressCustomer(payload.customer ?? null);
      setAddressItems(payload.items ?? []);
    } catch {
      setAddressError('接口不可用');
    } finally {
      setAddressLoading(false);
    }
  }

  const userColumns: TableColumnsType<UserRow> = [
    { title: '手机号', dataIndex: 'phone', width: 160 },
    { title: '昵称', dataIndex: 'name', render: (value: string | null) => value || '—' },
    { title: '角色', dataIndex: 'role', width: 140, render: (value: string) => roleLabel(value) },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 110,
      render: (value: boolean) => (
        <Tag color={value ? 'success' : 'default'}>{value ? '启用' : '停用'}</Tag>
      )
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 190, render: (value: string) => formatTime(value) },
    {
      title: '操作',
      key: 'action',
      width: 160,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row: UserRow) => (
        <Space size={4}>
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<EnvironmentOutlined />}
            title="收货地址"
            aria-label="收货地址"
            onClick={() => void openAddresses(row)}
          />
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<EditOutlined />}
            title="编辑"
            aria-label="编辑"
            onClick={() => openEditUser(row)}
          />
          <Button
            variant="text"
            color={row.isActive ? 'danger' : 'primary'}
            size="small"
            icon={row.isActive ? <StopOutlined /> : <CheckCircleOutlined />}
            title={row.isActive ? '停用' : '启用'}
            aria-label={row.isActive ? '停用' : '启用'}
            onClick={() => void toggleUser(row)}
          />
        </Space>
      )
    }
  ];

  const adminColumns: TableColumnsType<AdminRow> = [
    { title: '账号', dataIndex: 'username', width: 160 },
    { title: '显示名', dataIndex: 'displayName' },
    { title: '角色', dataIndex: 'role', width: 140, render: (value: string) => roleLabel(value) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: number) => (
        <Tag color={value === 1 ? 'success' : 'default'}>{value === 1 ? '启用' : '停用'}</Tag>
      )
    },
    { title: '最近登录', dataIndex: 'lastLoginAt', width: 190, render: (value: string | null) => formatTime(value) },
    {
      title: '操作',
      key: 'action',
      width: 120,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, row: AdminRow) => (
        <Space size={4}>
          <Button
            variant="text"
            color="primary"
            size="small"
            icon={<EditOutlined />}
            title="编辑"
            aria-label="编辑"
            onClick={() => openEditAdmin(row)}
          />
          <Button
            variant="text"
            color={row.status === 1 ? 'danger' : 'primary'}
            size="small"
            icon={row.status === 1 ? <StopOutlined /> : <CheckCircleOutlined />}
            title={row.status === 1 ? '停用' : '启用'}
            aria-label={row.status === 1 ? '停用' : '启用'}
            onClick={() => void toggleAdmin(row)}
          />
        </Space>
      )
    }
  ];

  const addressColumns: TableColumnsType<AddressRow> = [
    { title: '联系人', dataIndex: 'contactName', width: 110 },
    { title: '手机号', dataIndex: 'contactPhone', width: 140 },
    {
      title: '收货地址',
      dataIndex: 'detail',
      render: (value: string, row: AddressRow) => (
        <div>
          <div>
            {[row.province, row.city, row.district].filter(Boolean).join('')}
            {value}
          </div>
          {row.remark ? (
            <div style={{ color: colors.textSecondary, fontSize: 12 }}>备注：{row.remark}</div>
          ) : null}
        </div>
      )
    },
    {
      title: '默认',
      dataIndex: 'isDefault',
      width: 90,
      render: (value: boolean) => (value ? <Tag color="success">默认</Tag> : '—')
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value: string) => formatTime(value)
    }
  ];

  return (
    <div>
      <div
        style={{
          background: colors.surface,
          minHeight: '100vh'
        }}
      >
        <div className="admin-page-bar">
          <Tabs
            activeKey={tab}
            onChange={(key) => {
              setTab(key);
              setPage(1);
              setTotal(0);
              setError('');
            }}
            style={{ flex: 1 }}
            tabBarStyle={{ marginBottom: 0 }}
            items={[
              { key: 'users', label: '用户' },
              { key: 'admins', label: '管理员' },
              { key: 'rbac', label: '管理员权限' }
            ]}
          />
          {tab === 'rbac' ? null : (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {tab === 'users' ? '新建用户' : '新建管理员'}
            </Button>
          )}
          <TabProgress activeKey={tab} />
        </div>

        {tab === 'rbac' ? (
          <AdminPermissionPanel />
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
              placeholder={tab === 'users' ? '按手机号搜索…' : '按账号搜索…'}
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
          {tab === 'users' ? (
            <Select
              allowClear
              placeholder="全部角色"
              style={{ width: ADMIN_FILTER_FIELD_WIDTH }}
              options={ROLE_OPTIONS}
              value={role}
              onChange={(value) => {
                setRole(value);
                setPage(1);
              }}
            />
          ) : null}
        </div>

        {error ? (
          <div style={{ padding: '0 12px 8px', fontSize: 13, color: colors.danger }}>{error}</div>
        ) : null}

        {tab === 'users' ? (
          <Table<UserRow>
            rowKey="id"
            loading={loading}
            {...getAdminTableProps(userColumns)}
            dataSource={userRows}
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
        ) : (
          <Table<AdminRow>
            rowKey="id"
            loading={loading}
            {...getAdminTableProps(adminColumns)}
            dataSource={adminRows}
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
        )}
          </>
        )}
      </div>

      {mounted ? (
      <Modal
        open={modalOpen}
        title={
          tab === 'users'
            ? editingUser
              ? '编辑用户'
              : '新建用户'
            : editingAdmin
              ? '编辑管理员'
              : '新建管理员'
        }
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          {tab === 'users' ? (
            <>
              <Form.Item
                name="phone"
                label="手机号"
                rules={[{ required: true, pattern: /^1\d{10}$/, message: '请输入 11 位手机号' }]}
              >
                <Input maxLength={11} placeholder="11 位手机号" />
              </Form.Item>
              <Form.Item name="name" label="昵称" rules={[{ max: 50, message: '最多 50 字' }]}>
                <Input maxLength={50} placeholder="选填" />
              </Form.Item>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
                <Select options={ROLE_OPTIONS} />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                name="username"
                label="账号"
                rules={[
                  { required: true, min: 3, max: 50, message: '账号 3-50 位' },
                  { pattern: /^[a-zA-Z0-9_.-]+$/, message: '仅允许字母、数字、下划线、点、短横线' }
                ]}
              >
                <Input disabled={Boolean(editingAdmin)} placeholder="登录账号" />
              </Form.Item>
              {!editingAdmin ? (
                <Form.Item
                  name="password"
                  label="初始密码"
                  rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}
                >
                  <Input.Password placeholder="至少 8 位" />
                </Form.Item>
              ) : null}
              <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]}>
                <Input maxLength={50} />
              </Form.Item>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
                <Select options={ADMIN_ROLE_OPTIONS} />
              </Form.Item>
              <Form.Item
                name="status"
                label="状态"
                valuePropName="checked"
                getValueProps={(value: number) => ({ checked: value === 1 })}
                normalize={(checked: boolean) => (checked ? 1 : 0)}
              >
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      ) : null}

      {mounted ? (
        <Drawer
          open={Boolean(addressUser)}
          size="large"
          title={`收货地址 · ${addressUser?.name || addressUser?.phone || ''}`}
          onClose={() => setAddressUser(null)}
        >
          {addressCustomer ? (
            <div style={{ marginBottom: 12, color: colors.textSecondary, fontSize: 13 }}>
              顾客：{addressCustomer.realName || addressCustomer.nickname || '—'}（
              {addressCustomer.phone}）
            </div>
          ) : null}
          {addressError ? (
            <div style={{ marginBottom: 12, fontSize: 13, color: colors.danger }}>{addressError}</div>
          ) : null}
          <Table<AddressRow>
            rowKey="id"
            size="small"
            loading={addressLoading}
            {...getAdminTableProps(addressColumns)}
            dataSource={addressItems}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    addressCustomer ? '该顾客还没有收货地址' : '该用户还不是顾客，没有收货地址'
                  }
                />
              )
            }}
          />
        </Drawer>
      ) : null}
    </div>
  );
}
