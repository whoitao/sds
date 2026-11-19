'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Modal } from 'antd';

export interface DangerConfirmOptions {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
}

type ConfirmDanger = (options: DangerConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmDanger | null>(null);

/**
 * 全站统一的危险操作确认：
 * - 危险按钮统一红色（okButtonProps.danger）
 * - 默认焦点落在「取消」，避免误触回车
 * - 返回 Promise<boolean>，调用方 await 后再执行
 */
export function AdminConfirmProvider({ children }: { children: ReactNode }) {
  const [modal, contextHolder] = Modal.useModal();

  const confirm = useCallback<ConfirmDanger>(
    (options) =>
      new Promise<boolean>((resolve) => {
        modal.confirm({
          title: options.title,
          content: options.content,
          okText: options.okText ?? '确认',
          cancelText: options.cancelText ?? '取消',
          okButtonProps: { danger: true },
          focusable: { autoFocusButton: 'cancel' },
          centered: true,
          mask: { closable: false },
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        });
      }),
    [modal]
  );

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {contextHolder}
    </ConfirmContext.Provider>
  );
}

export function useConfirmDanger() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirmDanger 必须在 AdminConfirmProvider 内使用');
  }
  return context;
}
