'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { adminColors } from '../../lib/theme';

const { Title } = Typography;

interface LoginValues {
  username: string;
  password: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: LoginValues) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values)
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        setError(data.message ?? '登录失败，请稍后再试');
        return;
      }

      // 只接受站内相对路径，避免被 from 参数带到外部站点
      const from = new URLSearchParams(window.location.search).get('from');
      const target = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';
      router.replace(target);
      router.refresh();
    } catch {
      setError('网络异常，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="admin-login"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <video
        className="admin-login-video"
        src="/media/admin-login-harvest.mp4"
        poster="/media/admin-login-harvest-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
      <div className="admin-login-overlay" aria-hidden="true" />
      <Card
        style={{
          width: '100%',
          maxWidth: 360,
          position: 'relative',
          zIndex: 1,
          transform: 'translateY(20vh)',
          background: 'transparent',
          border: 'none',
          boxShadow: 'none'
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            margin: '0 auto 18px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 15,
            background: adminColors.primary,
            color: '#fff',
            fontSize: 28,
            fontWeight: 800,
            lineHeight: 1,
            boxShadow: '0 10px 28px rgba(76, 154, 106, 0.28)'
          }}
        >
          捎
        </div>
        <Title level={2} style={{ marginTop: 0, marginBottom: 26, color: '#fff', textAlign: 'center' }}>
          捎点啥 · 管理后台
        </Title>

        {error ? <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} /> : null}

        <Form<LoginValues>
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          size="large"
          style={{ width: '75%', margin: '0 auto' }}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="管理员账号"
              autoComplete="username"
              style={{
                background: 'rgba(15, 23, 42, 0.78)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 999,
                color: '#fff'
              }}
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="登录密码"
              autoComplete="current-password"
              style={{
                background: 'rgba(15, 23, 42, 0.78)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 999,
                color: '#fff'
              }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ borderRadius: 999 }}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </main>
  );
}
