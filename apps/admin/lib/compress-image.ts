/** 图片前端压缩：按目标比例居中裁切，canvas 重编码 JPEG，逐级降质量/降尺寸直到进入目标体积 */

export const DEFAULT_MAX_BYTES = 20 * 1024;

const DEFAULT_RATIO = 2; // 宽:高 = 2:1，保持店铺封面原有默认行为
const MAX_WIDTH = 1200;
const MIN_WIDTH = 400; // 再小就放弃，提示用户换图
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class ImageCompressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCompressError';
  }
}

export interface CompressImageOptions {
  /** 裁切比例（宽 / 高），默认 2（店铺封面） */
  aspectRatio?: number;
  /** 目标体积（字节），默认 20KB */
  maxBytes?: number;
  /** 输出最大宽度，默认 1200 */
  maxWidth?: number;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function formatKb(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export async function compressImage(
  file: File,
  {
    aspectRatio = DEFAULT_RATIO,
    maxBytes = DEFAULT_MAX_BYTES,
    maxWidth = MAX_WIDTH
  }: CompressImageOptions = {}
): Promise<File> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageCompressError('仅支持 JPG / PNG / WebP / GIF 图片');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageCompressError('图片解析失败，请换一张图片');
  }

  // 居中裁成目标比例，保证存下来的图本身就是该比例
  const ratio = aspectRatio > 0 ? aspectRatio : DEFAULT_RATIO;
  const srcRatio = bitmap.width / bitmap.height;
  const cropWidth = srcRatio > ratio ? Math.round(bitmap.height * ratio) : bitmap.width;
  const cropHeight = srcRatio > ratio ? bitmap.height : Math.round(bitmap.width / ratio);
  const sx = Math.round((bitmap.width - cropWidth) / 2);
  const sy = Math.round((bitmap.height - cropHeight) / 2);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageCompressError('当前浏览器不支持图片压缩');

  let width = Math.min(maxWidth, cropWidth);
  let lastSize = 0;

  while (true) {
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width / ratio));
    // PNG / WebP 的透明区域转 JPEG 会变黑，先铺白底
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, quality);
      if (!blob) continue;
      lastSize = blob.size;
      if (blob.size <= maxBytes) {
        bitmap.close?.();
        const name = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.jpg`;
        return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
      }
    }

    if (width <= MIN_WIDTH) break;
    width = Math.max(MIN_WIDTH, Math.round(width * 0.75));
  }

  bitmap.close?.();
  throw new ImageCompressError(
    `压缩后仍有 ${formatKb(lastSize)}，超过 ${formatKb(maxBytes)} 上限，请换一张更简单的图片`
  );
}
