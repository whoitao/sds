import type { ReactNode } from 'react';
import { Col, Empty, Row } from 'antd';
import { adminColors as palette } from '../../../lib/theme';

function SectionCard({
  title,
  subtitle,
  children,
  bodyPadding = 12
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  bodyPadding?: number;
}) {
  return (
    <div
      style={{
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '9px 12px',
          borderBottom: `1px solid ${palette.border}`
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: palette.text }}>{title}</span>
        {subtitle ? (
          <span style={{ fontSize: 12, color: palette.textTertiary }}>{subtitle}</span>
        ) : null}
      </div>
      <div style={{ padding: bodyPadding, flex: 1 }}>{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div style={{ background: palette.surface, minHeight: '100vh' }}>
      <div className="admin-page-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: palette.text }}>控制面板</span>
          <span style={{ fontSize: 12, color: palette.textTertiary }}>平台经营数据与业务动态</span>
        </div>
      </div>
      <div style={{ padding: 12 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24}>
            <SectionCard title="内容区">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 200
                }}
              >
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无数据，业务模块接入后在此展示"
                />
              </div>
            </SectionCard>
          </Col>
        </Row>
      </div>
    </div>
  );
}
