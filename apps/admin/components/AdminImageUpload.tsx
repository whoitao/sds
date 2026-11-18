'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Tooltip, Upload } from 'antd';
import {
  DeleteOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlusOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons';
import { adminColors as colors } from '../lib/theme';
import { ImageCompressError, compressImage } from '../lib/compress-image';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface AdminImageUploadProps {
  /** 表单值：图片地址；为空表示未上传 */
  value?: string | null;
  /** 上传成功/移除后回写图片地址，null 表示清空 */
  onChange?: (url: string | null) => void;
  /** 展示宽度（px），默认 120 */
  width?: number;
  /** 展示高度（px）；不传时按 aspectRatio 由宽度推算 */
  height?: number;
  /** 展示宽高比（宽 / 高），默认 1（正方形）；高度优先于该值 */
  aspectRatio?: number;
  /** 存储目录，服务端用于分目录（如 shops / catalog-categories） */
  dir?: string;
  /** 上传前压缩到目标体积（KB）；不传则不压缩、按原图上传 */
  compressToKB?: number;
  /** 压缩时的裁切比例，默认与展示比例一致 */
  compressRatio?: number;
  /** 允许的单张文件大小（MB），默认 5 */
  maxSizeMB?: number;
  /** 提示文案，收在问号 tooltip 里 */
  hint?: string;
  disabled?: boolean;
}

/**
 * 管理端通用图片上传：antd picture-card 形态，整块虚线区域即上传入口，
 * 空态为加号；已有图片时方块内预览，悬停显示预览 / 移除。
 * 统一走 /api/admin/uploads；表单只保存图片地址，调用方按普通字符串字段使用。
 */
export function AdminImageUpload({
  value,
  onChange,
  width = 120,
  height,
  aspectRatio = 1,
  dir = 'images',
  compressToKB,
  compressRatio,
  maxSizeMB = 5,
  hint,
  disabled = false
}: AdminImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const url = value || null;
  const boxHeight = height ?? Math.round(width / (aspectRatio || 1));
  const ratio = compressRatio ?? aspectRatio;
  const compact = width < 80;
  const tooltip =
    hint ?? `支持 JPG / PNG / WebP / GIF，单张 ≤ ${maxSizeMB}MB`;

  async function handleUpload(
    file: File,
    onSuccess?: (body?: unknown) => void,
    onError?: (error: Error) => void
  ) {
    setUploading(true);
    setError('');
    try {
      // 有压缩要求时先在浏览器里裁切重编码，未要求则原图直传
      const body = compressToKB
        ? await compressImage(file, { aspectRatio: ratio, maxBytes: compressToKB * 1024 })
        : file;
      const data = new FormData();
      data.append('file', body);
      data.append('dir', dir);

      const response = await fetch('/api/admin/uploads', { method: 'POST', body: data });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url) {
        const message = payload?.message ?? '上传失败，请稍后再试';
        setError(message);
        onError?.(new Error(message));
        return;
      }
      onChange?.(payload.url);
      onSuccess?.(payload);
      return;
    } catch (uploadError) {
      const message =
        uploadError instanceof ImageCompressError
          ? uploadError.message
          : '上传失败，请稍后再试';
      setError(message);
      onError?.(new Error(message));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      style={
        {
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          '--admin-image-upload-width': `${width}px`,
          '--admin-image-upload-height': `${boxHeight}px`
        } as CSSProperties
      }
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Upload
          className={`admin-image-upload${url ? ' admin-image-upload--filled' : ''}`}
          listType="picture-card"
          accept={ACCEPT}
          showUploadList={false}
          disabled={disabled || uploading}
          beforeUpload={(file) => {
            if (!ACCEPTED_TYPES.includes(file.type)) {
              setError('仅支持 JPG / PNG / WebP / GIF 图片');
              return Upload.LIST_IGNORE;
            }
            if (file.size > maxSizeMB * 1024 * 1024) {
              setError(`图片大小需在 ${maxSizeMB}MB 以内`);
              return Upload.LIST_IGNORE;
            }
            setError('');
            return true;
          }}
          customRequest={({ file, onSuccess, onError }) => {
            void handleUpload(file as File, onSuccess, onError);
          }}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            {url ? (
              <img
                src={url}
                alt="已上传图片"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: compact ? 16 : 20,
                  color: colors.textTertiary
                }}
              >
                <PlusOutlined />
              </div>
            )}

            {uploading ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: '#fff',
                  background: 'rgba(0, 0, 0, 0.45)'
                }}
              >
                <LoadingOutlined style={{ fontSize: compact ? 16 : 20 }} />
                {compact ? null : '上传中'}
              </div>
            ) : null}

            {!uploading && error ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: 4,
                  fontSize: 11,
                  lineHeight: 1.3,
                  textAlign: 'center',
                  color: colors.danger,
                  background: 'rgba(0, 0, 0, 0.28)'
                }}
              >
                <ExclamationCircleOutlined style={{ fontSize: compact ? 14 : 18 }} />
                {compact ? null : '上传失败'}
              </div>
            ) : null}

            {url && !uploading ? (
              <div className="admin-image-upload-actions">
                <button
                  type="button"
                  aria-label="预览"
                  title="预览"
                  onClick={(event) => {
                    event.stopPropagation();
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                >
                  <EyeOutlined />
                </button>
                <button
                  type="button"
                  aria-label="移除"
                  title="移除"
                  onClick={(event) => {
                    event.stopPropagation();
                    setError('');
                    onChange?.(null);
                  }}
                >
                  <DeleteOutlined />
                </button>
              </div>
            ) : null}
          </div>
        </Upload>
        <Tooltip title={tooltip}>
          <QuestionCircleOutlined
            aria-label="上传要求"
            style={{ marginTop: 2, color: colors.textTertiary, cursor: 'help' }}
          />
        </Tooltip>
      </div>
      {error ? <span style={{ fontSize: 12, color: colors.danger }}>{error}</span> : null}
    </div>
  );
}
