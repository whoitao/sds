/** 店铺封面图前端压缩：中心裁成 2:1，canvas 重编码 JPEG，逐级降质量/降尺寸直到进入目标体积 */

export const COVER_MAX_BYTES = 20 * 1024;

const COVER_RATIO = 2; // 宽:高 = 2:1
const COVER_MAX_WIDTH = 1200; // 1200 × 600
const COVER_MIN_WIDTH = 400; // 再小就放弃，提示用户换图
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class ImageCompressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCompressError';
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function formatKb(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export async function compressCoverImage(file: File, maxBytes = COVER_MAX_BYTES): Promise<File> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageCompressError('仅支持 JPG / PNG / WebP / GIF 图片');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageCompressError('图片解析失败，请换一张图片');
  }

  // 居中裁成 2:1，保证存下来的图本身就是封面比例
  const srcRatio = bitmap.width / bitmap.height;
  const cropWidth = srcRatio > COVER_RATIO ? Math.round(bitmap.height * COVER_RATIO) : bitmap.width;
  const cropHeight = srcRatio > COVER_RATIO ? bitmap.height : Math.round(bitmap.width / COVER_RATIO);
  const sx = Math.round((bitmap.width - cropWidth) / 2);
  const sy = Math.round((bitmap.height - cropHeight) / 2);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageCompressError('当前浏览器不支持图片压缩');

  let width = Math.min(COVER_MAX_WIDTH, cropWidth);
  let lastSize = 0;

  while (true) {
    canvas.width = width;
    canvas.height = Math.round(width / COVER_RATIO);
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
        const name = `${file.name.replace(/\.[^.]+$/, '') || 'cover'}.jpg`;
        return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
      }
    }

    if (width <= COVER_MIN_WIDTH) break;
    width = Math.max(COVER_MIN_WIDTH, Math.round(width * 0.75));
  }

  bitmap.close?.();
  throw new ImageCompressError(`压缩后仍有 ${formatKb(lastSize)}，超过 ${formatKb(maxBytes)} 上限，请换一张更简单的图片`);
}
