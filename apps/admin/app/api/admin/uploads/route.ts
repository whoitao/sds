import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getApiBaseUrl } from '../../../../lib/api-base';
import { ADMIN_COOKIE } from '../../../../lib/auth-cookie';

/**
 * 图片上传的透传代理：multipart 不能走 proxyToApi 的 JSON 解析，
 * 这里原样转发字节流与 content-type，业务校验与存储都在 packages/api。
 */
export async function POST(request: Request) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: '未登录' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json(
      { code: 'INVALID_BODY', message: '请以 multipart/form-data 上传图片' },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(`${getApiBaseUrl()}/api/admin/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      body: await request.arrayBuffer(),
      cache: 'no-store'
    });

    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json({ code: 'API_UNREACHABLE', message: '服务不可用' }, { status: 503 });
  }
}

/** 删除上传文件的透传代理：请求体为 { url }，校验与存储操作都在 packages/api */
export async function DELETE(request: Request) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: '未登录' }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${getApiBaseUrl()}/api/admin/uploads`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: await request.text(),
      cache: 'no-store'
    });

    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json({ code: 'API_UNREACHABLE', message: '服务不可用' }, { status: 503 });
  }
}
