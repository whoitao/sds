-- 0042：图片地址统一存「桶内相对路径」
--
-- 背景：历史上上传接口把 Supabase Storage 的完整公开 URL 直接写进了业务表。
-- 现在统一改成只存桶内相对路径（如 catalog-products/202611/xxx.png），
-- 由 API 读接口用 resolveImageUrl() 拼成完整地址后返回给 admin/web/mobile。
--
-- 覆盖列（本仓库所有存图片地址的列）：
--   shops.cover_url                 店铺封面
--   catalog_categories.icon_url     总部商品分类图标
--   catalog_products.image_url      总部商品图片
--   categories.icon_url             门店分类图标（历史表）
--   products.image_url              门店商品图片（历史表）
--   users.avatar_url                顾客头像
--   order_items.image_url           订单明细里的商品图快照
--
-- 只处理「本桶公开地址」；以下一律不动：
--   - 空值 / 空字符串
--   - 外部域名 URL
--   - 已经是相对路径的值
-- 可重复执行（第二次执行匹配 0 行）。

begin;

update shops
set cover_url = substring(cover_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1),
    updated_at = now()
where cover_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

update catalog_categories
set icon_url = substring(icon_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1)
where icon_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

update catalog_products
set image_url = substring(image_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1),
    updated_at = now()
where image_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

update categories
set icon_url = substring(icon_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1)
where icon_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

update products
set image_url = substring(image_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1),
    updated_at = now()
where image_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

update users
set avatar_url = substring(avatar_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1),
    updated_at = now()
where avatar_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

update order_items
set image_url = substring(image_url from length('https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/') + 1)
where image_url like 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/%';

commit;

-- 回滚 SQL（把相对路径重新拼回完整公开 URL；仅回滚本迁移改过的形态）：
-- begin;
-- update shops set cover_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || cover_url
--   where cover_url is not null and cover_url <> '' and cover_url not like 'http%';
-- update catalog_categories set icon_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || icon_url
--   where icon_url is not null and icon_url <> '' and icon_url not like 'http%';
-- update catalog_products set image_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || image_url
--   where image_url is not null and image_url <> '' and image_url not like 'http%';
-- update categories set icon_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || icon_url
--   where icon_url is not null and icon_url <> '' and icon_url not like 'http%';
-- update products set image_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || image_url
--   where image_url is not null and image_url <> '' and image_url not like 'http%';
-- update users set avatar_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || avatar_url
--   where avatar_url is not null and avatar_url <> '' and avatar_url not like 'http%';
-- update order_items set image_url = 'https://ifscebksoxrfymieheil.supabase.co/storage/v1/object/public/sdsbucket/' || image_url
--   where image_url is not null and image_url <> '' and image_url not like 'http%';
-- commit;
-- 注意：回滚会把「迁移前就已经是相对路径」的行也拼成完整 URL；本库迁移前无此类数据。
