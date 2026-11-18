/**
 * 清理被替换或移除的上传图片。
 * 只在表单保存成功之后调用：先上传新图、保存成功再删旧图，
 * 取消抽屉或保存失败时旧文件仍然可用，不会出现坏链接。
 */
export async function deleteUploadedImage(url: string | null | undefined): Promise<boolean> {
  if (!url) return true;
  try {
    const response = await fetch('/api/admin/uploads', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      console.warn('[admin] 旧图片清理失败', {
        url,
        status: response.status,
        code: payload?.code,
        message: payload?.message
      });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[admin] 旧图片清理失败', url, error);
    return false;
  }
}
