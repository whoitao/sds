-- 0007 分类树：两级分类（顶级 / 子级），同父级下名称唯一，跨店父级由复合外键兜底
-- 对应 PRD 5.4 categories；商品仍挂任意一级分类，筛选与统计按「自身 + 全部后代」口径。
BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1) 加列。parent_id 先不加外键，回填之后再建约束，避免顺序耦合
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS level smallint NOT NULL DEFAULT 1;

-- 2) 回填：现有数据全部是顶级分类
UPDATE categories SET level = 1 WHERE parent_id IS NULL;
UPDATE categories SET level = 2 WHERE parent_id IS NOT NULL;

-- 3) 跨店父级兜底：父分类必须与子分类同店
--    (id, shop_id) 唯一索引是复合外键的目标；parent_id 为空时该行不受约束
ALTER TABLE categories ADD CONSTRAINT categories_id_shop_unique UNIQUE (id, shop_id);
ALTER TABLE categories
  ADD CONSTRAINT categories_parent_same_shop_fk
  FOREIGN KEY (parent_id, shop_id) REFERENCES categories(id, shop_id) ON DELETE RESTRICT;

-- 4) 结构与一致性约束：两级、父子必同时成立、不能挂到自己
ALTER TABLE categories
  ADD CONSTRAINT categories_level_check CHECK (level IN (1, 2)),
  ADD CONSTRAINT categories_level_parent_check
    CHECK ((level = 1 AND parent_id IS NULL) OR (level = 2 AND parent_id IS NOT NULL)),
  ADD CONSTRAINT categories_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id);

-- 5) 唯一约束：改为「同父级下唯一」，NULLS NOT DISTINCT 让顶级之间也互斥
DROP INDEX IF EXISTS categories_shop_name_unique;
CREATE UNIQUE INDEX categories_sibling_name_unique
  ON categories (shop_id, parent_id, name) NULLS NOT DISTINCT;

-- 6) 索引：复合索引前缀已覆盖纯 shop_id 查询
DROP INDEX IF EXISTS categories_shop_idx;
CREATE INDEX IF NOT EXISTS categories_shop_parent_idx ON categories (shop_id, parent_id);

COMMIT;
