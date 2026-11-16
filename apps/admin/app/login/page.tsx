'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { adminColors } from '../../lib/theme';

const { Title, Paragraph } = Typography;

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
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: adminColors.page
      }}
    >
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Title level={2} style={{ marginTop: 0, marginBottom: 8 }}>
          捎点啥 · 管理后台
        </Title>
        <Paragraph style={{ fontSize: 16, color: adminColors.textSecondary }}>请使用平台管理员账号登录</Paragraph>

        {error ? <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} /> : null}

        <Form<LoginValues> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
          <Form.Item
            label="账号"
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="管理员账号" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="登录密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </main>
  );
}
