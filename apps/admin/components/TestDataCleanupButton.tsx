'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Table, Tag, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

interface CleanupCount {
  table: string;
  label: string;
  count: number;
}

interface TestDataCleanupButtonProps {
  onCleaned?: () => void;
  danger?: boolean;
}

/**
 * 统一的「清理测试数据」入口：
 * - 复用 /api/admin/test-data，预览与执行同一套接口
 * - 仅具备 test_data.cleanup 权限（super_admin）时展示
 * - 二次确认弹窗展示各表删除条数，确认后执行并提示结果
 */
export function TestDataCleanupButton({ onCleaned, danger = true }: TestDataCleanupButtonProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [counts, setCounts] = useState<CleanupCount[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin/me/permissions', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setAllowed((payload.permissions ?? []).includes('test_data.cleanup'));
      } catch {
        // 权限探测失败时不展示入口
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function openModal() {
    setOpen(true);
    setError('');
    setPreviewLoading(true);
    setCounts([]);
    setTotal(0);
    try {
      const response = await fetch('/api/admin/test-data', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '加载待清理数据失败');
        return;
      }
      setCounts(
        (payload.tables ?? []).filter((item: CleanupCount) => Number(item.count) > 0)
      );
      setTotal(Number(payload.total ?? 0));
    } catch {
      setError('接口不可用');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function cleanup() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/test-data', { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.message ?? '清理失败');
        return;
      }
      messageApi.success(`已清理 ${payload.total ?? 0} 条测试数据`);
      setOpen(false);
      setCounts([]);
      setTotal(0);
      onCleaned?.();
    } catch {
      setError('接口不可用');
    } finally {
      setSubmitting(false);
    }
  }

  const tableColumns = useMemo(
    () => [
      { title: '数据表', dataIndex: 'label', key: 'label' },
      { title: '条数', dataIndex: 'count', key: 'count', width: 100 }
    ],
    []
  );

  if (!allowed) return null;

  return (
    <>
      {contextHolder}
      <Button danger={danger} icon={<DeleteOutlined />} onClick={() => void openModal()}>
        清理测试数据
      </Button>
      <Modal
        open={open}
        title="清理测试数据"
        okText="确认清理"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          disabled: previewLoading || submitting || total === 0
        }}
        confirmLoading={submitting}
        onOk={() => void cleanup()}
        onCancel={() => {
          if (!submitting) setOpen(false);
        }}
        width={560}
      >
        {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}
        {previewLoading ? (
          <div style={{ padding: 16, textAlign: 'center', opacity: 0.65 }}>统计中…</div>
        ) : total === 0 ? (
          <Alert type="success" showIcon title="当前没有测试数据" />
        ) : (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={`将删除 ${total} 条 is_test = true 的测试数据，正式数据不受影响`}
              description="按外键顺序在同一个事务内删除；测试库存与测试流水一并清理，不会留下负库存。"
            />
            <Table<CleanupCount>
              rowKey="table"
              size="small"
              sticky
              pagination={false}
              columns={tableColumns}
              dataSource={counts}
            />
            <div style={{ marginTop: 12 }}>
              <Tag color="default">只删除测试标记数据</Tag>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
