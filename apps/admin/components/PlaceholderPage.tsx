import type { ReactNode } from 'react';
import { adminColors as colors } from '../lib/theme';

/** 未实现模块的统一占位页，视觉规格与控制面板卡片保持一致 */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>{title}</div>
        <div style={{ fontSize: 12, color: colors.textTertiary, marginTop: 2 }}>{description}</div>
      </div>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 16
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 240,
            gap: 8
          }}
        >
          <span style={{ fontSize: 15, color: colors.textSecondary }}>功能开发中</span>
          <span style={{ fontSize: 12, color: colors.textTertiary }}>该菜单仅占位，本阶段未实现业务逻辑</span>
        </div>
      </div>
    </div>
  );
}
