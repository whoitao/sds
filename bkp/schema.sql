


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."fulfillment_type" AS ENUM (
    'delivery',
    'pickup'
);


ALTER TYPE "public"."fulfillment_type" OWNER TO "postgres";


CREATE TYPE "public"."member_role" AS ENUM (
    'shop_manager',
    'shop_staff',
    'delivery'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'pending_payment',
    'paid',
    'preparing',
    'delivering',
    'pickup_ready',
    'completed',
    'cancelled',
    'refunded',
    'refund_pending'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'wechat',
    'cash',
    'balance'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."payment_record_status" AS ENUM (
    'created',
    'paid',
    'offline',
    'refunded',
    'cancelled'
);


ALTER TYPE "public"."payment_record_status" OWNER TO "postgres";


CREATE TYPE "public"."product_stock_type" AS ENUM (
    'tracked',
    'untracked'
);


ALTER TYPE "public"."product_stock_type" OWNER TO "postgres";


CREATE TYPE "public"."purchase_order_status" AS ENUM (
    'draft',
    'submitted',
    'received',
    'cancelled'
);


ALTER TYPE "public"."purchase_order_status" OWNER TO "postgres";


CREATE TYPE "public"."quantity_mode" AS ENUM (
    'integer',
    'decimal_2'
);


ALTER TYPE "public"."quantity_mode" OWNER TO "postgres";


CREATE TYPE "public"."shop_status" AS ENUM (
    'open',
    'closed',
    'suspended'
);


ALTER TYPE "public"."shop_status" OWNER TO "postgres";


CREATE TYPE "public"."stock_movement_type" AS ENUM (
    'purchase_in',
    'purchase_return',
    'sale_out',
    'order_return',
    'adjustment',
    'waste',
    'initial',
    'transfer_out',
    'transfer_in'
);


ALTER TYPE "public"."stock_movement_type" OWNER TO "postgres";


COMMENT ON TYPE "public"."stock_movement_type" IS '库存流水类型：purchase_in / purchase_return / sale_out / order_return / adjustment / waste / initial / transfer_out / transfer_in';



CREATE TYPE "public"."user_role" AS ENUM (
    'customer',
    'shop_manager',
    'shop_staff',
    'delivery',
    'platform_admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "contact_name" character varying(50) NOT NULL,
    "contact_phone" character varying(11) NOT NULL,
    "province" character varying(20),
    "city" character varying(20),
    "district" character varying(20),
    "detail" character varying(200) NOT NULL,
    "longitude" numeric(10,7),
    "latitude" numeric(10,7),
    "is_default" boolean DEFAULT false NOT NULL,
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "province_code" character varying(12),
    "city_code" character varying(12),
    "district_code" character varying(12)
);


ALTER TABLE "public"."addresses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" character varying(80) NOT NULL,
    "module" character varying(32) NOT NULL,
    "action" character varying(32) NOT NULL,
    "name" character varying(64) NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "conditions" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" character varying(50) NOT NULL,
    "name" character varying(50) NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_user_shops" (
    "admin_user_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_user_shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_user_warehouses" (
    "admin_user_id" "uuid" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_user_warehouses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "username" character varying(50) NOT NULL,
    "password_hash" "text" NOT NULL,
    "display_name" character varying(50) NOT NULL,
    "role" character varying(32) DEFAULT 'platform_admin'::character varying NOT NULL,
    "status" smallint DEFAULT 1 NOT NULL,
    "failed_login_count" integer DEFAULT 0 NOT NULL,
    "locked_until" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preferences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cart_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cart_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_sku_id" "uuid" NOT NULL,
    CONSTRAINT "cart_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."cart_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."carts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "remark" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."carts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_id" "uuid",
    "level" smallint DEFAULT 1 NOT NULL,
    "name" character varying(50) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "icon_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "catalog_categories_level_check" CHECK (("level" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "catalog_categories_level_parent_check" CHECK (((("level" = 1) AND ("parent_id" IS NULL)) OR (("level" = 2) AND ("parent_id" IS NOT NULL)))),
    CONSTRAINT "catalog_categories_no_self_parent" CHECK ((("parent_id" IS NULL) OR ("parent_id" <> "id")))
);


ALTER TABLE "public"."catalog_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid",
    "name" character varying(100) NOT NULL,
    "description" "text",
    "image_url" "text",
    "unit" character varying(20) NOT NULL,
    "default_price" numeric(10,2) NOT NULL,
    "stock_type" "public"."product_stock_type" DEFAULT 'tracked'::"public"."product_stock_type" NOT NULL,
    "status" character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "catalog_products_default_price_check" CHECK (("default_price" >= (0)::numeric)),
    CONSTRAINT "catalog_products_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::"text"[])))
);


ALTER TABLE "public"."catalog_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_skus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "catalog_product_id" "uuid" NOT NULL,
    "spec_name" character varying(50) NOT NULL,
    "barcode" character varying(64),
    "unit" character varying(20) NOT NULL,
    "default_price" numeric(10,2) NOT NULL,
    "stock_type" "public"."product_stock_type" DEFAULT 'tracked'::"public"."product_stock_type" NOT NULL,
    "quantity_mode" "public"."quantity_mode" DEFAULT 'integer'::"public"."quantity_mode" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "catalog_skus_default_price_check" CHECK (("default_price" >= (0)::numeric)),
    CONSTRAINT "catalog_skus_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::"text"[])))
);


ALTER TABLE "public"."catalog_skus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "name" character varying(50) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "icon_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_id" "uuid",
    "level" smallint DEFAULT 1 NOT NULL,
    CONSTRAINT "categories_level_check" CHECK (("level" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "categories_level_parent_check" CHECK (((("level" = 1) AND ("parent_id" IS NULL)) OR (("level" = 2) AND ("parent_id" IS NOT NULL)))),
    CONSTRAINT "categories_no_self_parent" CHECK ((("parent_id" IS NULL) OR ("parent_id" <> "id")))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "token" character varying(64) NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nickname" character varying(50),
    "real_name" character varying(50),
    "phone" character varying(11),
    "total_orders" integer DEFAULT 0 NOT NULL,
    "total_spent" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."damage_report_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "product_sku_id" "uuid",
    "catalog_sku_id" "uuid",
    "item_name" character varying(100) NOT NULL,
    "spec_name" character varying(50),
    "unit" character varying(20) NOT NULL,
    "quantity" numeric(12,2) NOT NULL,
    "unit_cost" numeric(10,2) DEFAULT 0 NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "remark" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "damage_report_items_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "damage_report_items_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "damage_report_items_sku_check" CHECK ((("product_sku_id" IS NOT NULL) OR ("catalog_sku_id" IS NOT NULL))),
    CONSTRAINT "damage_report_items_unit_cost_check" CHECK (("unit_cost" >= (0)::numeric))
);


ALTER TABLE "public"."damage_report_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."damage_report_items" IS '报损明细：门店侧 product_sku_id，仓库侧 catalog_sku_id';



CREATE TABLE IF NOT EXISTS "public"."damage_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_no" character varying(32) NOT NULL,
    "subject_type" character varying(16) NOT NULL,
    "shop_id" "uuid",
    "warehouse_id" "uuid",
    "status" character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "reason_category" character varying(32) NOT NULL,
    "remark" "text",
    "review_note" "text",
    "created_by_admin_id" "uuid",
    "submitted_by_admin_id" "uuid",
    "submitted_at" timestamp with time zone,
    "reviewed_by_admin_id" "uuid",
    "reviewed_at" timestamp with time zone,
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "damage_reports_reason_check" CHECK ((("reason_category")::"text" = ANY ((ARRAY['expired'::character varying, 'damaged'::character varying, 'spoiled'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "damage_reports_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'submitted'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[]))),
    CONSTRAINT "damage_reports_subject_check" CHECK ((((("subject_type")::"text" = 'shop'::"text") AND ("shop_id" IS NOT NULL) AND ("warehouse_id" IS NULL)) OR ((("subject_type")::"text" = 'warehouse'::"text") AND ("warehouse_id" IS NOT NULL) AND ("shop_id" IS NULL))))
);


ALTER TABLE "public"."damage_reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."damage_reports" IS '报损单：门店报损或仓内报损，approve 时才扣减库存并写 waste 流水';



CREATE TABLE IF NOT EXISTS "public"."demand_plan_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "demand_plan_id" "uuid" NOT NULL,
    "catalog_sku_id" "uuid" NOT NULL,
    "item_name" character varying(100) NOT NULL,
    "spec_name" character varying(50),
    "unit" character varying(20) NOT NULL,
    "category_id" "uuid",
    "category_name" character varying(50),
    "total_requested_qty" numeric(14,2) NOT NULL,
    "final_qty" numeric(14,2) NOT NULL,
    "purchase_path" character varying(24) DEFAULT 'centralized'::character varying NOT NULL,
    "shop_breakdown" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "decision_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "demand_plan_items_path_check" CHECK ((("purchase_path")::"text" = ANY ((ARRAY['centralized'::character varying, 'central_kitchen'::character varying, 'regional_whitelist'::character varying])::"text"[]))),
    CONSTRAINT "demand_plan_items_qty_check" CHECK ((("total_requested_qty" >= (0)::numeric) AND ("final_qty" >= (0)::numeric)))
);


ALTER TABLE "public"."demand_plan_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demand_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_no" character varying(32) NOT NULL,
    "delivery_date" "date" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "status" character varying(16) DEFAULT 'collecting'::character varying NOT NULL,
    "is_current" boolean DEFAULT true NOT NULL,
    "total_skus" integer DEFAULT 0 NOT NULL,
    "total_requested_qty" numeric(14,2) DEFAULT 0 NOT NULL,
    "remark" "text",
    "decided_by_admin_id" "uuid",
    "decided_at" timestamp with time zone,
    "created_by_admin_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "demand_plans_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['collecting'::character varying, 'decided'::character varying, 'superseded'::character varying])::"text"[])))
);


ALTER TABLE "public"."demand_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_type" character varying(32) NOT NULL,
    "document_id" "uuid" NOT NULL,
    "from_status" character varying(24),
    "to_status" character varying(24) NOT NULL,
    "operator_admin_id" "uuid",
    "operator_name" character varying(50),
    "reason" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."document_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "key" character varying(120) NOT NULL,
    "scope" character varying(64) NOT NULL,
    "request_hash" character varying(64),
    "status" character varying(16) DEFAULT 'processing'::character varying NOT NULL,
    "response_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    CONSTRAINT "idempotency_keys_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['processing'::character varying, 'completed'::character varying])::"text"[])))
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "product_sku_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "spec_name" character varying(100),
    "image_url" "text",
    "unit" character varying(20) NOT NULL,
    "quantity_mode" "public"."quantity_mode" NOT NULL,
    "unit_price" numeric(10,2) NOT NULL,
    "quantity" numeric(12,2) NOT NULL,
    "subtotal" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "order_items_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "order_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "method" "public"."payment_method" NOT NULL,
    "provider" character varying(32) DEFAULT 'sandbox'::character varying NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "status" "public"."payment_record_status" DEFAULT 'created'::"public"."payment_record_status" NOT NULL,
    "external_no" character varying(64),
    "paid_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "refund_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "order_payments_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."order_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_no" character varying(20) NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "status" "public"."order_status" DEFAULT 'paid'::"public"."order_status" NOT NULL,
    "fulfillment_type" "public"."fulfillment_type" NOT NULL,
    "address_id" "uuid",
    "contact_name" character varying(50),
    "contact_phone" character varying(11),
    "address_text" character varying(300),
    "item_count" numeric(12,2) DEFAULT 0 NOT NULL,
    "subtotal" numeric(10,2) NOT NULL,
    "delivery_fee" numeric(10,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(10,2) NOT NULL,
    "payment_method" "public"."payment_method",
    "paid_at" timestamp with time zone,
    "remark" "text",
    "cancelled_reason" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refunded_at" timestamp with time zone,
    "refund_amount" numeric(10,2),
    "refund_reason" "text",
    "refund_rejected_reason" "text",
    "status_before_refund" "public"."order_status",
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "orders_delivery_fee_check" CHECK (("delivery_fee" >= (0)::numeric)),
    CONSTRAINT "orders_discount_amount_check" CHECK (("discount_amount" >= (0)::numeric)),
    CONSTRAINT "orders_item_count_check" CHECK (("item_count" >= (0)::numeric)),
    CONSTRAINT "orders_refund_amount_check" CHECK ((("refund_amount" IS NULL) OR ("refund_amount" >= (0)::numeric))),
    CONSTRAINT "orders_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "orders_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_sku_stocks" (
    "product_sku_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "min_threshold" numeric(12,2) DEFAULT 0 NOT NULL,
    "max_threshold" numeric(12,2),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "avg_unit_cost" numeric(10,2) DEFAULT 0 NOT NULL,
    "reserved_qty" numeric(12,2) DEFAULT 0 NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "product_sku_stocks_avg_cost_check" CHECK (("avg_unit_cost" >= (0)::numeric)),
    CONSTRAINT "product_sku_stocks_max_threshold_check" CHECK (("max_threshold" >= (0)::numeric)),
    CONSTRAINT "product_sku_stocks_min_threshold_check" CHECK (("min_threshold" >= (0)::numeric)),
    CONSTRAINT "product_sku_stocks_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "product_sku_stocks_reserved_check" CHECK (("reserved_qty" >= (0)::numeric)),
    CONSTRAINT "product_sku_stocks_threshold_check" CHECK ((("max_threshold" IS NULL) OR ("max_threshold" >= "min_threshold")))
);


ALTER TABLE "public"."product_sku_stocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_skus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "catalog_sku_id" "uuid",
    "spec_name" character varying(50) NOT NULL,
    "barcode" character varying(64),
    "unit" character varying(20) NOT NULL,
    "price" numeric(10,2),
    "stock_type" "public"."product_stock_type" DEFAULT 'tracked'::"public"."product_stock_type" NOT NULL,
    "quantity_mode" "public"."quantity_mode" DEFAULT 'integer'::"public"."quantity_mode" NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "product_skus_price_required_for_local" CHECK ((("catalog_sku_id" IS NOT NULL) OR ("price" IS NOT NULL)))
);


ALTER TABLE "public"."product_skus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_stocks" (
    "product_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "product_stocks_quantity_check" CHECK (("quantity" >= 0))
);


ALTER TABLE "public"."product_stocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" character varying(100) NOT NULL,
    "description" "text",
    "image_url" "text",
    "price" numeric(10,2),
    "unit" character varying(20) NOT NULL,
    "stock_type" "public"."product_stock_type" DEFAULT 'tracked'::"public"."product_stock_type" NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "catalog_product_id" "uuid",
    "is_blocked" boolean DEFAULT false NOT NULL,
    "blocked_reason" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "products_price_required_for_local" CHECK ((("catalog_product_id" IS NOT NULL) OR ("price" IS NOT NULL)))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "product_sku_id" "uuid",
    "item_name" character varying(100) NOT NULL,
    "unit" character varying(20) NOT NULL,
    "quantity_mode" "public"."quantity_mode" DEFAULT 'integer'::"public"."quantity_mode" NOT NULL,
    "quantity" numeric(12,2) NOT NULL,
    "unit_cost" numeric(10,2) NOT NULL,
    "received_quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "difference_reason" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    "catalog_sku_id" "uuid",
    CONSTRAINT "purchase_order_items_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "purchase_order_items_check" CHECK ((("received_quantity" >= (0)::numeric) AND ("received_quantity" <= "quantity"))),
    CONSTRAINT "purchase_order_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "purchase_order_items_sku_subject_check" CHECK (("num_nonnulls"("product_sku_id", "catalog_sku_id") <= 1)),
    CONSTRAINT "purchase_order_items_unit_cost_check" CHECK (("unit_cost" >= (0)::numeric))
);


ALTER TABLE "public"."purchase_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid",
    "po_no" character varying(32) NOT NULL,
    "supplier_id" "uuid",
    "supplier_name" character varying(100),
    "supplier_phone" character varying(20),
    "status" "public"."purchase_order_status" DEFAULT 'draft'::"public"."purchase_order_status" NOT NULL,
    "ordered_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "received_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "expected_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "created_by_admin_id" "uuid",
    "submitted_by_admin_id" "uuid",
    "received_by_admin_id" "uuid",
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "demand_plan_id" "uuid",
    "is_test" boolean DEFAULT false NOT NULL,
    "warehouse_id" "uuid",
    CONSTRAINT "purchase_orders_ordered_amount_check" CHECK (("ordered_amount" >= (0)::numeric)),
    CONSTRAINT "purchase_orders_received_amount_check" CHECK (("received_amount" >= (0)::numeric)),
    CONSTRAINT "purchase_orders_subject_check" CHECK (("num_nonnulls"("shop_id", "warehouse_id") = 1))
);


ALTER TABLE "public"."purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_receipt_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "purchase_order_item_id" "uuid" NOT NULL,
    "catalog_sku_id" "uuid",
    "item_name" character varying(100) NOT NULL,
    "unit" character varying(20) NOT NULL,
    "quantity_mode" "public"."quantity_mode" DEFAULT 'integer'::"public"."quantity_mode" NOT NULL,
    "expected_quantity" numeric(12,2) NOT NULL,
    "received_quantity" numeric(12,2) NOT NULL,
    "qualified_quantity" numeric(12,2) NOT NULL,
    "rejected_quantity" numeric(12,2) NOT NULL,
    "unit_cost" numeric(10,2) NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "difference_reason" character varying(24),
    "remark" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_receipt_items_qty_check" CHECK ((("received_quantity" >= (0)::numeric) AND ("qualified_quantity" >= (0)::numeric) AND ("rejected_quantity" >= (0)::numeric) AND (("qualified_quantity" + "rejected_quantity") = "received_quantity"))),
    CONSTRAINT "purchase_receipt_items_reason_check" CHECK ((("difference_reason" IS NULL) OR (("difference_reason")::"text" = ANY ((ARRAY['shortage'::character varying, 'damaged'::character varying, 'expired'::character varying, 'spec_mismatch'::character varying, 'other'::character varying])::"text"[]))))
);


ALTER TABLE "public"."purchase_receipt_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."purchase_receipt_items" IS '入库质检明细：应收/实收/合格/不合格与差异原因，作为拒收记录';



CREATE TABLE IF NOT EXISTS "public"."purchase_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_no" character varying(32) NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "warehouse_id" "uuid" NOT NULL,
    "status" character varying(16) DEFAULT 'posted'::character varying NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "received_by_admin_id" "uuid",
    "received_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "remark" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchase_receipts_status_check" CHECK ((("status")::"text" = 'posted'::"text"))
);


ALTER TABLE "public"."purchase_receipts" OWNER TO "postgres";


COMMENT ON TABLE "public"."purchase_receipts" IS '总部仓采购入库质检单：只把合格数量写入仓库库存';



CREATE TABLE IF NOT EXISTS "public"."regions" (
    "code" character varying(12) NOT NULL,
    "name" character varying(60) NOT NULL,
    "level" smallint NOT NULL,
    "parent_code" character varying(12),
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "regions_level_check" CHECK ((("level" >= 1) AND ("level" <= 3)))
);


ALTER TABLE "public"."regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_hidden_categories" (
    "shop_id" "uuid" NOT NULL,
    "catalog_category_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shop_hidden_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."member_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shop_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_requisition_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requisition_id" "uuid" NOT NULL,
    "product_sku_id" "uuid" NOT NULL,
    "catalog_sku_id" "uuid",
    "item_name" character varying(100) NOT NULL,
    "spec_name" character varying(50),
    "category_id" "uuid",
    "category_name" character varying(50),
    "unit" character varying(20) NOT NULL,
    "requested_qty" numeric(12,2) NOT NULL,
    "approved_qty" numeric(12,2),
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "shop_requisition_items_approved_qty_check" CHECK ((("approved_qty" IS NULL) OR ("approved_qty" >= (0)::numeric))),
    CONSTRAINT "shop_requisition_items_qty_check" CHECK (("requested_qty" > (0)::numeric))
);


ALTER TABLE "public"."shop_requisition_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_requisitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requisition_no" character varying(32) NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "expected_date" "date" NOT NULL,
    "time_window" character varying(16) DEFAULT 'all_day'::character varying NOT NULL,
    "status" character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "remark" "text",
    "submitted_by_admin_id" "uuid",
    "submitted_at" timestamp with time zone,
    "reviewed_by_admin_id" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_note" "text",
    "created_by_admin_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "shop_requisitions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'submitted'::character varying, 'approved'::character varying, 'withdrawn'::character varying])::"text"[]))),
    CONSTRAINT "shop_requisitions_time_window_check" CHECK ((("time_window")::"text" = ANY ((ARRAY['morning'::character varying, 'afternoon'::character varying, 'all_day'::character varying])::"text"[])))
);


ALTER TABLE "public"."shop_requisitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "shop_suppliers_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::"text"[])))
);


ALTER TABLE "public"."shop_suppliers" OWNER TO "postgres";


COMMENT ON TABLE "public"."shop_suppliers" IS '已废弃（0029）：供货关系统一到 supplier_scopes，本表仅保留历史数据，不再读写';



CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "cover_url" "text",
    "address" character varying(200) NOT NULL,
    "longitude" numeric(10,7) NOT NULL,
    "latitude" numeric(10,7) NOT NULL,
    "phone" character varying(11),
    "business_hours" "jsonb",
    "status" "public"."shop_status" DEFAULT 'open'::"public"."shop_status" NOT NULL,
    "announcement" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "maintenance_enabled" boolean DEFAULT false NOT NULL,
    "maintenance_message" "text" DEFAULT '站点正在维护，请稍后访问。'::"text" NOT NULL,
    "site_url" "text" DEFAULT ''::"text" NOT NULL,
    "default_title" "text" DEFAULT ''::"text" NOT NULL,
    "default_keywords" "text" DEFAULT ''::"text" NOT NULL,
    "default_description" "text" DEFAULT ''::"text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_settings_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."site_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid",
    "product_sku_id" "uuid",
    "movement_type" "public"."stock_movement_type" NOT NULL,
    "quantity_change" numeric(12,2) NOT NULL,
    "balance_after" numeric(12,2) NOT NULL,
    "unit_cost" numeric(10,2),
    "reference_type" character varying(24),
    "reference_id" "uuid",
    "operator_admin_id" "uuid",
    "operator_user_id" "uuid",
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_type" character varying(16) DEFAULT 'shop'::character varying NOT NULL,
    "location_id" "uuid" NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "catalog_sku_id" "uuid",
    CONSTRAINT "stock_movements_balance_after_check" CHECK (("balance_after" >= (0)::numeric)),
    CONSTRAINT "stock_movements_location_type_check" CHECK ((("location_type")::"text" = ANY ((ARRAY['shop'::character varying, 'warehouse'::character varying])::"text"[]))),
    CONSTRAINT "stock_movements_quantity_change_check" CHECK ((("quantity_change" <> (0)::numeric) OR (("movement_type" = 'waste'::"public"."stock_movement_type") AND (("reference_type")::"text" = 'warehouse_transfer'::"text")))),
    CONSTRAINT "stock_movements_reference_check" CHECK ((("reference_id" IS NULL) OR ("reference_type" IS NOT NULL))),
    CONSTRAINT "stock_movements_subject_check" CHECK ((((("location_type")::"text" = 'shop'::"text") AND ("shop_id" IS NOT NULL) AND ("product_sku_id" IS NOT NULL)) OR ((("location_type")::"text" = 'warehouse'::"text") AND ("catalog_sku_id" IS NOT NULL)))),
    CONSTRAINT "stock_movements_unit_cost_check" CHECK ((("unit_cost" IS NULL) OR ("unit_cost" >= (0)::numeric)))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_scopes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "subject_type" character varying(16) NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_scopes_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::"text"[]))),
    CONSTRAINT "supplier_scopes_subject_type_check" CHECK ((("subject_type")::"text" = ANY ((ARRAY['shop'::character varying, 'warehouse'::character varying])::"text"[])))
);


ALTER TABLE "public"."supplier_scopes" OWNER TO "postgres";


COMMENT ON TABLE "public"."supplier_scopes" IS '供应商供货范围：subject_type=shop 门店 / warehouse 总部仓';



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "legacy_shop_id" "uuid",
    "name" character varying(100) NOT NULL,
    "contact_name" character varying(50),
    "phone" character varying(20),
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "code" character varying(32),
    "address" "text",
    "settlement_method" character varying(32),
    "tax_no" character varying(50),
    "email" character varying(120),
    "last_purchase_at" timestamp with time zone,
    "merged_into_id" "uuid",
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "suppliers_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::"text"[])))
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" character varying(11) NOT NULL,
    "name" character varying(50),
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'customer'::"public"."user_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "password_hash" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warehouse_stocks" (
    "warehouse_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "reserved_qty" numeric(12,2) DEFAULT 0 NOT NULL,
    "avg_unit_cost" numeric(10,2) DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "min_threshold" numeric(12,2) DEFAULT 0 NOT NULL,
    "max_threshold" numeric(12,2),
    CONSTRAINT "warehouse_stocks_avg_unit_cost_check" CHECK (("avg_unit_cost" >= (0)::numeric)),
    CONSTRAINT "warehouse_stocks_quantity_check" CHECK (("quantity" >= (0)::numeric)),
    CONSTRAINT "warehouse_stocks_reserved_qty_check" CHECK (("reserved_qty" >= (0)::numeric)),
    CONSTRAINT "warehouse_stocks_threshold_check" CHECK ((("min_threshold" >= (0)::numeric) AND (("max_threshold" IS NULL) OR ("max_threshold" >= (0)::numeric)) AND (("max_threshold" IS NULL) OR ("max_threshold" >= "min_threshold"))))
);


ALTER TABLE "public"."warehouse_stocks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."warehouse_stocks"."min_threshold" IS '仓库安全库存下限：可用量（库存 - 预留）<= 该值时进入低库存预警';



COMMENT ON COLUMN "public"."warehouse_stocks"."max_threshold" IS '仓库库存上限（可选），留空表示不设上限，仅作补货参考';



CREATE TABLE IF NOT EXISTS "public"."warehouse_transfer_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transfer_id" "uuid" NOT NULL,
    "catalog_sku_id" "uuid" NOT NULL,
    "product_sku_id" "uuid",
    "requested_quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "allocated_quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "shipped_quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "received_quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "difference_reason" character varying(24),
    "unit_cost" numeric(10,2) DEFAULT 0 NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "remark" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "loss_quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "loss_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "warehouse_transfer_items_loss_check" CHECK ((("loss_quantity" >= (0)::numeric) AND ("loss_amount" >= (0)::numeric))),
    CONSTRAINT "warehouse_transfer_items_qty_check" CHECK ((("requested_quantity" >= (0)::numeric) AND ("allocated_quantity" >= (0)::numeric) AND ("shipped_quantity" >= (0)::numeric) AND ("received_quantity" >= (0)::numeric) AND ("allocated_quantity" <= "requested_quantity") AND ("shipped_quantity" <= "allocated_quantity") AND ("received_quantity" <= "shipped_quantity") AND ("amount" >= (0)::numeric))),
    CONSTRAINT "warehouse_transfer_items_reason_check" CHECK ((("difference_reason" IS NULL) OR (("difference_reason")::"text" = ANY ((ARRAY['shortage'::character varying, 'damaged'::character varying, 'expired'::character varying, 'spec_mismatch'::character varying, 'other'::character varying])::"text"[]))))
);


ALTER TABLE "public"."warehouse_transfer_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."warehouse_transfer_items" IS '分拨单明细：申请/分配/发出/实收数量与成本；部分收货由发出与实收数量派生';



COMMENT ON COLUMN "public"."warehouse_transfer_items"."loss_quantity" IS '差异关闭时确认放弃的未收数量（发出 - 实收）';



COMMENT ON COLUMN "public"."warehouse_transfer_items"."loss_amount" IS '差异关闭时的损耗金额 = 损耗数量 × 发货时点成本';



CREATE TABLE IF NOT EXISTS "public"."warehouse_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transfer_no" character varying(32) NOT NULL,
    "from_warehouse_id" "uuid" NOT NULL,
    "to_shop_id" "uuid" NOT NULL,
    "status" character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    "requested_by_admin_id" "uuid",
    "handled_by_admin_id" "uuid",
    "allocated_at" timestamp with time zone,
    "shipped_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "remark" "text",
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "difference_closed_at" timestamp with time zone,
    "difference_close_reason" "text",
    "delivery_date" "date",
    "receiver_admin_id" "uuid",
    "received_by_admin_id" "uuid",
    "receive_due_at" timestamp with time zone,
    CONSTRAINT "warehouse_transfers_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'allocated'::character varying, 'shipped'::character varying, 'received'::character varying, 'cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."warehouse_transfers" OWNER TO "postgres";


COMMENT ON TABLE "public"."warehouse_transfers" IS '总部仓到门店分拨单；状态流转记录在 document_events（document_type=warehouse_transfer）';



COMMENT ON COLUMN "public"."warehouse_transfers"."difference_closed_at" IS '门店确认差异关闭的时间；为空表示未关闭差异';



COMMENT ON COLUMN "public"."warehouse_transfers"."difference_close_reason" IS '差异关闭备注（差异原因枚举记录在明细 difference_reason）';



COMMENT ON COLUMN "public"."warehouse_transfers"."delivery_date" IS '计划联动生成的交付日；手工新建为 null';



COMMENT ON COLUMN "public"."warehouse_transfers"."receiver_admin_id" IS '建议收货责任人（发货时按目标门店店长自动带出，可修改；为空表示未指派）';



COMMENT ON COLUMN "public"."warehouse_transfers"."received_by_admin_id" IS '实际收货人（代收时与建议责任人不一致）';



COMMENT ON COLUMN "public"."warehouse_transfers"."receive_due_at" IS '应收货截止时间（全部发出时按 SLA 写入）';



CREATE TABLE IF NOT EXISTS "public"."warehouses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" character varying(32) NOT NULL,
    "name" character varying(100) NOT NULL,
    "type" character varying(16) DEFAULT 'hq'::character varying NOT NULL,
    "address" "text",
    "cold_zone_supported" boolean DEFAULT false NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    CONSTRAINT "warehouses_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::"text"[]))),
    CONSTRAINT "warehouses_type_check" CHECK ((("type")::"text" = ANY ((ARRAY['hq'::character varying, 'regional'::character varying])::"text"[])))
);


ALTER TABLE "public"."warehouses" OWNER TO "postgres";


ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_permissions"
    ADD CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_role_permissions"
    ADD CONSTRAINT "admin_role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_user_roles"
    ADD CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_user_shops"
    ADD CONSTRAINT "admin_user_shops_pkey" PRIMARY KEY ("admin_user_id", "shop_id");



ALTER TABLE ONLY "public"."admin_user_warehouses"
    ADD CONSTRAINT "admin_user_warehouses_pkey" PRIMARY KEY ("admin_user_id", "warehouse_id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_categories"
    ADD CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_products"
    ADD CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_skus"
    ADD CONSTRAINT "catalog_skus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_id_shop_unique" UNIQUE ("id", "shop_id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_sessions"
    ADD CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."damage_report_items"
    ADD CONSTRAINT "damage_report_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demand_plan_items"
    ADD CONSTRAINT "demand_plan_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demand_plans"
    ADD CONSTRAINT "demand_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_events"
    ADD CONSTRAINT "document_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_payments"
    ADD CONSTRAINT "order_payments_order_id_key" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."order_payments"
    ADD CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_sku_stocks"
    ADD CONSTRAINT "product_sku_stocks_pkey" PRIMARY KEY ("product_sku_id");



ALTER TABLE ONLY "public"."product_skus"
    ADD CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_stocks"
    ADD CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_id_shop_unique" UNIQUE ("id", "shop_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_receipt_items"
    ADD CONSTRAINT "purchase_receipt_items_line_unique" UNIQUE ("receipt_id", "purchase_order_item_id");



ALTER TABLE ONLY "public"."purchase_receipt_items"
    ADD CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_receipts"
    ADD CONSTRAINT "purchase_receipts_no_unique" UNIQUE ("receipt_no");



ALTER TABLE ONLY "public"."purchase_receipts"
    ADD CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."shop_hidden_categories"
    ADD CONSTRAINT "shop_hidden_categories_pkey" PRIMARY KEY ("shop_id", "catalog_category_id");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_requisition_items"
    ADD CONSTRAINT "shop_requisition_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_requisitions"
    ADD CONSTRAINT "shop_requisitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_suppliers"
    ADD CONSTRAINT "shop_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_scopes"
    ADD CONSTRAINT "supplier_scopes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_scopes"
    ADD CONSTRAINT "supplier_scopes_unique" UNIQUE ("supplier_id", "subject_type", "subject_id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouse_stocks"
    ADD CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("warehouse_id", "sku_id");



ALTER TABLE ONLY "public"."warehouse_transfer_items"
    ADD CONSTRAINT "warehouse_transfer_items_line_unique" UNIQUE ("transfer_id", "catalog_sku_id");



ALTER TABLE ONLY "public"."warehouse_transfer_items"
    ADD CONSTRAINT "warehouse_transfer_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_no_unique" UNIQUE ("transfer_no");



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id");



CREATE INDEX "addresses_customer_idx" ON "public"."addresses" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "addresses_default_unique" ON "public"."addresses" USING "btree" ("customer_id") WHERE "is_default";



CREATE INDEX "addresses_district_code_idx" ON "public"."addresses" USING "btree" ("district_code");



CREATE UNIQUE INDEX "admin_permissions_code_unique" ON "public"."admin_permissions" USING "btree" ("code");



CREATE INDEX "admin_permissions_module_idx" ON "public"."admin_permissions" USING "btree" ("module");



CREATE INDEX "admin_role_permissions_role_idx" ON "public"."admin_role_permissions" USING "btree" ("role_id");



CREATE UNIQUE INDEX "admin_role_permissions_unique" ON "public"."admin_role_permissions" USING "btree" ("role_id", "permission_id");



CREATE UNIQUE INDEX "admin_roles_code_unique" ON "public"."admin_roles" USING "btree" ("code");



CREATE UNIQUE INDEX "admin_user_roles_unique" ON "public"."admin_user_roles" USING "btree" ("admin_user_id", "role_id");



CREATE INDEX "admin_user_roles_user_idx" ON "public"."admin_user_roles" USING "btree" ("admin_user_id");



CREATE INDEX "admin_user_shops_shop_idx" ON "public"."admin_user_shops" USING "btree" ("shop_id");



CREATE INDEX "admin_user_warehouses_warehouse_idx" ON "public"."admin_user_warehouses" USING "btree" ("warehouse_id");



CREATE UNIQUE INDEX "admin_users_username_unique" ON "public"."admin_users" USING "btree" ("username");



CREATE UNIQUE INDEX "cart_items_cart_sku_unique" ON "public"."cart_items" USING "btree" ("cart_id", "product_sku_id");



CREATE INDEX "cart_items_product_idx" ON "public"."cart_items" USING "btree" ("product_id");



CREATE INDEX "cart_items_product_sku_idx" ON "public"."cart_items" USING "btree" ("product_sku_id");



CREATE UNIQUE INDEX "carts_customer_shop_unique" ON "public"."carts" USING "btree" ("customer_id", "shop_id");



CREATE INDEX "carts_shop_updated_idx" ON "public"."carts" USING "btree" ("shop_id", "updated_at" DESC);



CREATE INDEX "carts_updated_idx" ON "public"."carts" USING "btree" ("updated_at" DESC);



CREATE INDEX "catalog_categories_parent_idx" ON "public"."catalog_categories" USING "btree" ("parent_id", "sort_order");



CREATE UNIQUE INDEX "catalog_categories_sibling_name_unique" ON "public"."catalog_categories" USING "btree" ("parent_id", "name") NULLS NOT DISTINCT;



CREATE INDEX "catalog_products_category_idx" ON "public"."catalog_products" USING "btree" ("category_id");



CREATE INDEX "catalog_products_status_idx" ON "public"."catalog_products" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "catalog_skus_default_unique" ON "public"."catalog_skus" USING "btree" ("catalog_product_id") WHERE "is_default";



CREATE INDEX "catalog_skus_product_idx" ON "public"."catalog_skus" USING "btree" ("catalog_product_id", "status", "sort_order");



CREATE UNIQUE INDEX "catalog_skus_product_spec_unique" ON "public"."catalog_skus" USING "btree" ("catalog_product_id", "spec_name");



CREATE INDEX "categories_shop_parent_idx" ON "public"."categories" USING "btree" ("shop_id", "parent_id");



CREATE UNIQUE INDEX "categories_sibling_name_unique" ON "public"."categories" USING "btree" ("shop_id", "parent_id", "name") NULLS NOT DISTINCT;



CREATE INDEX "customer_sessions_customer_idx" ON "public"."customer_sessions" USING "btree" ("customer_id");



CREATE INDEX "customer_sessions_expires_idx" ON "public"."customer_sessions" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "customer_sessions_token_unique" ON "public"."customer_sessions" USING "btree" ("token");



CREATE INDEX "customers_created_at_idx" ON "public"."customers" USING "btree" ("created_at" DESC);



CREATE INDEX "customers_phone_idx" ON "public"."customers" USING "btree" ("phone");



CREATE UNIQUE INDEX "customers_user_unique" ON "public"."customers" USING "btree" ("user_id");



CREATE INDEX "damage_report_items_report_idx" ON "public"."damage_report_items" USING "btree" ("report_id");



CREATE UNIQUE INDEX "damage_report_items_shop_sku_unique" ON "public"."damage_report_items" USING "btree" ("report_id", "product_sku_id") WHERE ("product_sku_id" IS NOT NULL);



CREATE UNIQUE INDEX "damage_report_items_warehouse_sku_unique" ON "public"."damage_report_items" USING "btree" ("report_id", "catalog_sku_id") WHERE ("catalog_sku_id" IS NOT NULL);



CREATE UNIQUE INDEX "damage_reports_no_unique" ON "public"."damage_reports" USING "btree" ("report_no");



CREATE INDEX "damage_reports_shop_idx" ON "public"."damage_reports" USING "btree" ("shop_id", "created_at");



CREATE INDEX "damage_reports_status_idx" ON "public"."damage_reports" USING "btree" ("status", "created_at");



CREATE INDEX "damage_reports_warehouse_idx" ON "public"."damage_reports" USING "btree" ("warehouse_id", "created_at");



CREATE UNIQUE INDEX "demand_plan_items_catalog_unique" ON "public"."demand_plan_items" USING "btree" ("demand_plan_id", "catalog_sku_id");



CREATE INDEX "demand_plan_items_category_idx" ON "public"."demand_plan_items" USING "btree" ("demand_plan_id", "category_name");



CREATE UNIQUE INDEX "demand_plans_current_unique" ON "public"."demand_plans" USING "btree" ("delivery_date", "warehouse_id") WHERE ("is_current" = true);



CREATE INDEX "demand_plans_is_test_idx" ON "public"."demand_plans" USING "btree" ("is_test") WHERE "is_test";



CREATE UNIQUE INDEX "demand_plans_no_unique" ON "public"."demand_plans" USING "btree" ("plan_no");



CREATE UNIQUE INDEX "demand_plans_version_unique" ON "public"."demand_plans" USING "btree" ("delivery_date", "warehouse_id", "version");



CREATE INDEX "document_events_created_idx" ON "public"."document_events" USING "btree" ("created_at");



CREATE INDEX "document_events_doc_idx" ON "public"."document_events" USING "btree" ("document_type", "document_id", "created_at");



CREATE INDEX "idempotency_keys_expires_idx" ON "public"."idempotency_keys" USING "btree" ("expires_at");



CREATE INDEX "idempotency_keys_scope_idx" ON "public"."idempotency_keys" USING "btree" ("scope");



CREATE INDEX "order_items_order_idx" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "order_items_sku_idx" ON "public"."order_items" USING "btree" ("product_sku_id");



CREATE INDEX "order_payments_status_idx" ON "public"."order_payments" USING "btree" ("status");



CREATE INDEX "orders_customer_created_idx" ON "public"."orders" USING "btree" ("customer_id", "created_at" DESC);



CREATE INDEX "orders_is_test_idx" ON "public"."orders" USING "btree" ("is_test") WHERE "is_test";



CREATE UNIQUE INDEX "orders_order_no_unique" ON "public"."orders" USING "btree" ("order_no");



CREATE INDEX "orders_shop_created_idx" ON "public"."orders" USING "btree" ("shop_id", "created_at" DESC);



CREATE INDEX "orders_status_idx" ON "public"."orders" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "product_sku_stocks_is_test_idx" ON "public"."product_sku_stocks" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "product_sku_stocks_shop_idx" ON "public"."product_sku_stocks" USING "btree" ("shop_id");



CREATE INDEX "product_skus_barcode_idx" ON "public"."product_skus" USING "btree" ("shop_id", "barcode") WHERE ("barcode" IS NOT NULL);



CREATE UNIQUE INDEX "product_skus_default_unique" ON "public"."product_skus" USING "btree" ("product_id") WHERE "is_default";



CREATE UNIQUE INDEX "product_skus_id_shop_unique" ON "public"."product_skus" USING "btree" ("id", "shop_id");



CREATE INDEX "product_skus_is_test_idx" ON "public"."product_skus" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "product_skus_product_idx" ON "public"."product_skus" USING "btree" ("product_id", "is_available", "sort_order");



CREATE UNIQUE INDEX "product_skus_product_spec_unique" ON "public"."product_skus" USING "btree" ("product_id", "spec_name");



CREATE UNIQUE INDEX "product_skus_shop_catalog_sku_unique" ON "public"."product_skus" USING "btree" ("shop_id", "catalog_sku_id") WHERE ("catalog_sku_id" IS NOT NULL);



CREATE INDEX "product_skus_shop_idx" ON "public"."product_skus" USING "btree" ("shop_id");



CREATE INDEX "product_stocks_shop_idx" ON "public"."product_stocks" USING "btree" ("shop_id");



CREATE INDEX "products_catalog_idx" ON "public"."products" USING "btree" ("catalog_product_id");



CREATE INDEX "products_category_idx" ON "public"."products" USING "btree" ("category_id");



CREATE UNIQUE INDEX "products_shop_catalog_unique" ON "public"."products" USING "btree" ("shop_id", "catalog_product_id") WHERE ("catalog_product_id" IS NOT NULL);



CREATE INDEX "products_shop_idx" ON "public"."products" USING "btree" ("shop_id");



CREATE UNIQUE INDEX "purchase_order_items_catalog_sku_unique" ON "public"."purchase_order_items" USING "btree" ("purchase_order_id", "catalog_sku_id") WHERE ("catalog_sku_id" IS NOT NULL);



CREATE INDEX "purchase_order_items_order_idx" ON "public"."purchase_order_items" USING "btree" ("purchase_order_id");



CREATE UNIQUE INDEX "purchase_order_items_sku_unique" ON "public"."purchase_order_items" USING "btree" ("purchase_order_id", "product_sku_id") WHERE ("product_sku_id" IS NOT NULL);



CREATE INDEX "purchase_orders_demand_plan_idx" ON "public"."purchase_orders" USING "btree" ("demand_plan_id") WHERE ("demand_plan_id" IS NOT NULL);



CREATE INDEX "purchase_orders_is_test_idx" ON "public"."purchase_orders" USING "btree" ("is_test") WHERE "is_test";



CREATE UNIQUE INDEX "purchase_orders_po_no_unique" ON "public"."purchase_orders" USING "btree" ("po_no");



CREATE INDEX "purchase_orders_shop_status_idx" ON "public"."purchase_orders" USING "btree" ("shop_id", "status", "created_at" DESC);



CREATE INDEX "purchase_orders_warehouse_status_idx" ON "public"."purchase_orders" USING "btree" ("warehouse_id", "status", "created_at" DESC);



CREATE INDEX "purchase_receipt_items_order_item_idx" ON "public"."purchase_receipt_items" USING "btree" ("purchase_order_item_id");



CREATE INDEX "purchase_receipt_items_receipt_idx" ON "public"."purchase_receipt_items" USING "btree" ("receipt_id");



CREATE INDEX "purchase_receipts_order_idx" ON "public"."purchase_receipts" USING "btree" ("purchase_order_id", "received_at" DESC);



CREATE INDEX "purchase_receipts_warehouse_idx" ON "public"."purchase_receipts" USING "btree" ("warehouse_id", "received_at" DESC);



CREATE INDEX "regions_level_idx" ON "public"."regions" USING "btree" ("level");



CREATE INDEX "regions_parent_idx" ON "public"."regions" USING "btree" ("parent_code");



CREATE INDEX "shop_hidden_categories_shop_idx" ON "public"."shop_hidden_categories" USING "btree" ("shop_id");



CREATE UNIQUE INDEX "shop_members_shop_user_unique" ON "public"."shop_members" USING "btree" ("shop_id", "user_id");



CREATE INDEX "shop_members_user_idx" ON "public"."shop_members" USING "btree" ("user_id");



CREATE INDEX "shop_requisition_items_catalog_idx" ON "public"."shop_requisition_items" USING "btree" ("catalog_sku_id");



CREATE UNIQUE INDEX "shop_requisition_items_sku_unique" ON "public"."shop_requisition_items" USING "btree" ("requisition_id", "product_sku_id");



CREATE UNIQUE INDEX "shop_requisitions_active_unique" ON "public"."shop_requisitions" USING "btree" ("shop_id", "expected_date") WHERE (("status")::"text" = ANY ((ARRAY['submitted'::character varying, 'approved'::character varying])::"text"[]));



CREATE INDEX "shop_requisitions_is_test_idx" ON "public"."shop_requisitions" USING "btree" ("is_test") WHERE "is_test";



CREATE UNIQUE INDEX "shop_requisitions_no_unique" ON "public"."shop_requisitions" USING "btree" ("requisition_no");



CREATE INDEX "shop_requisitions_shop_date_idx" ON "public"."shop_requisitions" USING "btree" ("shop_id", "expected_date", "created_at");



CREATE INDEX "shop_requisitions_status_idx" ON "public"."shop_requisitions" USING "btree" ("status", "expected_date");



CREATE INDEX "shop_suppliers_shop_idx" ON "public"."shop_suppliers" USING "btree" ("shop_id", "status");



CREATE INDEX "shop_suppliers_supplier_idx" ON "public"."shop_suppliers" USING "btree" ("supplier_id");



CREATE UNIQUE INDEX "shop_suppliers_unique" ON "public"."shop_suppliers" USING "btree" ("supplier_id", "shop_id");



CREATE INDEX "shops_is_test_idx" ON "public"."shops" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "shops_status_idx" ON "public"."shops" USING "btree" ("status");



CREATE UNIQUE INDEX "stock_movements_biz_unique" ON "public"."stock_movements" USING "btree" ("location_type", "location_id", "product_sku_id", "movement_type", "reference_type", "reference_id") WHERE (("reference_id" IS NOT NULL) AND (("reference_type")::"text" IS DISTINCT FROM 'warehouse_transfer'::"text"));



CREATE UNIQUE INDEX "stock_movements_initial_unique" ON "public"."stock_movements" USING "btree" ("location_type", "location_id", "product_sku_id") WHERE ("movement_type" = 'initial'::"public"."stock_movement_type");



CREATE INDEX "stock_movements_is_test_idx" ON "public"."stock_movements" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "stock_movements_location_idx" ON "public"."stock_movements" USING "btree" ("location_type", "location_id", "created_at" DESC);



CREATE INDEX "stock_movements_sku_idx" ON "public"."stock_movements" USING "btree" ("shop_id", "product_sku_id", "created_at" DESC);



CREATE INDEX "stock_movements_type_idx" ON "public"."stock_movements" USING "btree" ("shop_id", "movement_type", "created_at" DESC);



CREATE UNIQUE INDEX "stock_movements_warehouse_biz_unique" ON "public"."stock_movements" USING "btree" ("location_type", "location_id", "catalog_sku_id", "movement_type", "reference_type", "reference_id") WHERE ((("location_type")::"text" = 'warehouse'::"text") AND ("catalog_sku_id" IS NOT NULL) AND ("reference_id" IS NOT NULL) AND (("reference_type")::"text" IS DISTINCT FROM 'warehouse_transfer'::"text"));



CREATE INDEX "stock_movements_warehouse_idx" ON "public"."stock_movements" USING "btree" ("location_id", "catalog_sku_id", "created_at" DESC);



CREATE UNIQUE INDEX "stock_movements_warehouse_initial_unique" ON "public"."stock_movements" USING "btree" ("location_type", "location_id", "catalog_sku_id") WHERE ((("location_type")::"text" = 'warehouse'::"text") AND ("catalog_sku_id" IS NOT NULL) AND ("movement_type" = 'initial'::"public"."stock_movement_type"));



CREATE INDEX "supplier_scopes_subject_idx" ON "public"."supplier_scopes" USING "btree" ("subject_type", "subject_id", "status");



CREATE INDEX "supplier_scopes_supplier_idx" ON "public"."supplier_scopes" USING "btree" ("supplier_id", "status");



CREATE UNIQUE INDEX "suppliers_code_unique" ON "public"."suppliers" USING "btree" ("code") WHERE ("code" IS NOT NULL);



CREATE INDEX "suppliers_is_test_idx" ON "public"."suppliers" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "suppliers_legacy_shop_idx" ON "public"."suppliers" USING "btree" ("legacy_shop_id", "status");



CREATE INDEX "suppliers_name_idx" ON "public"."suppliers" USING "btree" ("name");



CREATE INDEX "users_created_at_idx" ON "public"."users" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "users_phone_unique" ON "public"."users" USING "btree" ("phone");



CREATE INDEX "warehouse_stocks_is_test_idx" ON "public"."warehouse_stocks" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "warehouse_stocks_sku_idx" ON "public"."warehouse_stocks" USING "btree" ("sku_id");



CREATE INDEX "warehouse_stocks_warehouse_sku_threshold_idx" ON "public"."warehouse_stocks" USING "btree" ("warehouse_id", "sku_id") INCLUDE ("quantity", "reserved_qty", "min_threshold");



CREATE INDEX "warehouse_transfer_items_catalog_sku_idx" ON "public"."warehouse_transfer_items" USING "btree" ("catalog_sku_id");



CREATE INDEX "warehouse_transfer_items_product_sku_idx" ON "public"."warehouse_transfer_items" USING "btree" ("product_sku_id") WHERE ("product_sku_id" IS NOT NULL);



CREATE INDEX "warehouse_transfer_items_transfer_idx" ON "public"."warehouse_transfer_items" USING "btree" ("transfer_id");



CREATE UNIQUE INDEX "warehouse_transfers_draft_shop_date_unique" ON "public"."warehouse_transfers" USING "btree" ("to_shop_id", "delivery_date") WHERE ((("status")::"text" = 'draft'::"text") AND ("delivery_date" IS NOT NULL));



COMMENT ON INDEX "public"."warehouse_transfers_draft_shop_date_unique" IS '同一门店 + 交付日只允许一张草稿，防止重复生成';



CREATE INDEX "warehouse_transfers_receiver_idx" ON "public"."warehouse_transfers" USING "btree" ("receiver_admin_id", "status", "receive_due_at");



CREATE INDEX "warehouse_transfers_shop_delivery_idx" ON "public"."warehouse_transfers" USING "btree" ("to_shop_id", "delivery_date", "status");



CREATE INDEX "warehouse_transfers_shop_idx" ON "public"."warehouse_transfers" USING "btree" ("to_shop_id", "created_at" DESC);



CREATE INDEX "warehouse_transfers_status_idx" ON "public"."warehouse_transfers" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "warehouse_transfers_warehouse_idx" ON "public"."warehouse_transfers" USING "btree" ("from_warehouse_id", "created_at" DESC);



CREATE UNIQUE INDEX "warehouses_code_unique" ON "public"."warehouses" USING "btree" ("code");



CREATE INDEX "warehouses_is_test_idx" ON "public"."warehouses" USING "btree" ("is_test") WHERE "is_test";



CREATE INDEX "warehouses_status_idx" ON "public"."warehouses" USING "btree" ("status");



CREATE INDEX "warehouses_type_idx" ON "public"."warehouses" USING "btree" ("type");



ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_city_code_fkey" FOREIGN KEY ("city_code") REFERENCES "public"."regions"("code");



ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_district_code_fkey" FOREIGN KEY ("district_code") REFERENCES "public"."regions"("code");



ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "public"."regions"("code");



ALTER TABLE ONLY "public"."admin_role_permissions"
    ADD CONSTRAINT "admin_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."admin_permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_role_permissions"
    ADD CONSTRAINT "admin_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_user_roles"
    ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_user_roles"
    ADD CONSTRAINT "admin_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_user_shops"
    ADD CONSTRAINT "admin_user_shops_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_user_shops"
    ADD CONSTRAINT "admin_user_shops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_user_warehouses"
    ADD CONSTRAINT "admin_user_warehouses_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_user_warehouses"
    ADD CONSTRAINT "admin_user_warehouses_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_product_sku_fk" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "carts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_categories"
    ADD CONSTRAINT "catalog_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."catalog_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."catalog_products"
    ADD CONSTRAINT "catalog_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_skus"
    ADD CONSTRAINT "catalog_skus_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "public"."catalog_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_parent_same_shop_fk" FOREIGN KEY ("parent_id", "shop_id") REFERENCES "public"."categories"("id", "shop_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_sessions"
    ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."damage_report_items"
    ADD CONSTRAINT "damage_report_items_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."damage_report_items"
    ADD CONSTRAINT "damage_report_items_product_sku_id_fkey" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."damage_report_items"
    ADD CONSTRAINT "damage_report_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."damage_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_submitted_by_admin_id_fkey" FOREIGN KEY ("submitted_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."demand_plan_items"
    ADD CONSTRAINT "demand_plan_items_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."demand_plan_items"
    ADD CONSTRAINT "demand_plan_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."demand_plan_items"
    ADD CONSTRAINT "demand_plan_items_demand_plan_id_fkey" FOREIGN KEY ("demand_plan_id") REFERENCES "public"."demand_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demand_plans"
    ADD CONSTRAINT "demand_plans_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."demand_plans"
    ADD CONSTRAINT "demand_plans_decided_by_admin_id_fkey" FOREIGN KEY ("decided_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."demand_plans"
    ADD CONSTRAINT "demand_plans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."document_events"
    ADD CONSTRAINT "document_events_operator_admin_id_fkey" FOREIGN KEY ("operator_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_sku_id_fkey" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_payments"
    ADD CONSTRAINT "order_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_sku_stocks"
    ADD CONSTRAINT "product_sku_stocks_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_sku_stocks"
    ADD CONSTRAINT "product_sku_stocks_sku_fk" FOREIGN KEY ("product_sku_id", "shop_id") REFERENCES "public"."product_skus"("id", "shop_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_skus"
    ADD CONSTRAINT "product_skus_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_skus"
    ADD CONSTRAINT "product_skus_product_fk" FOREIGN KEY ("product_id", "shop_id") REFERENCES "public"."products"("id", "shop_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_skus"
    ADD CONSTRAINT "product_skus_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stocks"
    ADD CONSTRAINT "product_stocks_product_fk" FOREIGN KEY ("product_id", "shop_id") REFERENCES "public"."products"("id", "shop_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stocks"
    ADD CONSTRAINT "product_stocks_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_catalog_product_id_fkey" FOREIGN KEY ("catalog_product_id") REFERENCES "public"."catalog_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_product_sku_id_fkey" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_demand_plan_id_fkey" FOREIGN KEY ("demand_plan_id") REFERENCES "public"."demand_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_received_by_admin_id_fkey" FOREIGN KEY ("received_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_submitted_by_admin_id_fkey" FOREIGN KEY ("submitted_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_receipt_items"
    ADD CONSTRAINT "purchase_receipt_items_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_receipt_items"
    ADD CONSTRAINT "purchase_receipt_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_receipt_items"
    ADD CONSTRAINT "purchase_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_receipts"
    ADD CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_receipts"
    ADD CONSTRAINT "purchase_receipts_received_by_admin_id_fkey" FOREIGN KEY ("received_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_receipts"
    ADD CONSTRAINT "purchase_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "public"."regions"("code");



ALTER TABLE ONLY "public"."shop_hidden_categories"
    ADD CONSTRAINT "shop_hidden_categories_catalog_category_id_fkey" FOREIGN KEY ("catalog_category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_hidden_categories"
    ADD CONSTRAINT "shop_hidden_categories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_requisition_items"
    ADD CONSTRAINT "shop_requisition_items_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shop_requisition_items"
    ADD CONSTRAINT "shop_requisition_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."catalog_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shop_requisition_items"
    ADD CONSTRAINT "shop_requisition_items_product_sku_id_fkey" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shop_requisition_items"
    ADD CONSTRAINT "shop_requisition_items_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "public"."shop_requisitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_requisitions"
    ADD CONSTRAINT "shop_requisitions_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shop_requisitions"
    ADD CONSTRAINT "shop_requisitions_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shop_requisitions"
    ADD CONSTRAINT "shop_requisitions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shop_requisitions"
    ADD CONSTRAINT "shop_requisitions_submitted_by_admin_id_fkey" FOREIGN KEY ("submitted_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shop_suppliers"
    ADD CONSTRAINT "shop_suppliers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_suppliers"
    ADD CONSTRAINT "shop_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_operator_admin_id_fkey" FOREIGN KEY ("operator_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_operator_user_id_fkey" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_sku_fk" FOREIGN KEY ("product_sku_id", "shop_id") REFERENCES "public"."product_skus"("id", "shop_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_scopes"
    ADD CONSTRAINT "supplier_scopes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_legacy_shop_id_fkey" FOREIGN KEY ("legacy_shop_id") REFERENCES "public"."shops"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_stocks"
    ADD CONSTRAINT "warehouse_stocks_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."warehouse_stocks"
    ADD CONSTRAINT "warehouse_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."warehouse_transfer_items"
    ADD CONSTRAINT "warehouse_transfer_items_catalog_sku_id_fkey" FOREIGN KEY ("catalog_sku_id") REFERENCES "public"."catalog_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."warehouse_transfer_items"
    ADD CONSTRAINT "warehouse_transfer_items_product_sku_id_fkey" FOREIGN KEY ("product_sku_id") REFERENCES "public"."product_skus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."warehouse_transfer_items"
    ADD CONSTRAINT "warehouse_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."warehouse_transfers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_handled_by_admin_id_fkey" FOREIGN KEY ("handled_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_received_by_admin_id_fkey" FOREIGN KEY ("received_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_receiver_admin_id_fkey" FOREIGN KEY ("receiver_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_requested_by_admin_id_fkey" FOREIGN KEY ("requested_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warehouse_transfers"
    ADD CONSTRAINT "warehouse_transfers_to_shop_id_fkey" FOREIGN KEY ("to_shop_id") REFERENCES "public"."shops"("id") ON DELETE RESTRICT;





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





































































































































































GRANT ALL ON TABLE "public"."addresses" TO "anon";
GRANT ALL ON TABLE "public"."addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."addresses" TO "service_role";



GRANT ALL ON TABLE "public"."admin_permissions" TO "anon";
GRANT ALL ON TABLE "public"."admin_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."admin_role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_roles" TO "anon";
GRANT ALL ON TABLE "public"."admin_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_roles" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_roles" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_shops" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_shops" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_shops" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_warehouses" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_warehouses" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_warehouses" TO "service_role";



GRANT ALL ON TABLE "public"."admin_users" TO "anon";
GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";



GRANT ALL ON TABLE "public"."cart_items" TO "anon";
GRANT ALL ON TABLE "public"."cart_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cart_items" TO "service_role";



GRANT ALL ON TABLE "public"."carts" TO "anon";
GRANT ALL ON TABLE "public"."carts" TO "authenticated";
GRANT ALL ON TABLE "public"."carts" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_categories" TO "anon";
GRANT ALL ON TABLE "public"."catalog_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_categories" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_products" TO "anon";
GRANT ALL ON TABLE "public"."catalog_products" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_products" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_skus" TO "anon";
GRANT ALL ON TABLE "public"."catalog_skus" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_skus" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."customer_sessions" TO "anon";
GRANT ALL ON TABLE "public"."customer_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."damage_report_items" TO "anon";
GRANT ALL ON TABLE "public"."damage_report_items" TO "authenticated";
GRANT ALL ON TABLE "public"."damage_report_items" TO "service_role";



GRANT ALL ON TABLE "public"."damage_reports" TO "anon";
GRANT ALL ON TABLE "public"."damage_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."damage_reports" TO "service_role";



GRANT ALL ON TABLE "public"."demand_plan_items" TO "anon";
GRANT ALL ON TABLE "public"."demand_plan_items" TO "authenticated";
GRANT ALL ON TABLE "public"."demand_plan_items" TO "service_role";



GRANT ALL ON TABLE "public"."demand_plans" TO "anon";
GRANT ALL ON TABLE "public"."demand_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."demand_plans" TO "service_role";



GRANT ALL ON TABLE "public"."document_events" TO "anon";
GRANT ALL ON TABLE "public"."document_events" TO "authenticated";
GRANT ALL ON TABLE "public"."document_events" TO "service_role";



GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_payments" TO "anon";
GRANT ALL ON TABLE "public"."order_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."order_payments" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."product_sku_stocks" TO "anon";
GRANT ALL ON TABLE "public"."product_sku_stocks" TO "authenticated";
GRANT ALL ON TABLE "public"."product_sku_stocks" TO "service_role";



GRANT ALL ON TABLE "public"."product_skus" TO "anon";
GRANT ALL ON TABLE "public"."product_skus" TO "authenticated";
GRANT ALL ON TABLE "public"."product_skus" TO "service_role";



GRANT ALL ON TABLE "public"."product_stocks" TO "anon";
GRANT ALL ON TABLE "public"."product_stocks" TO "authenticated";
GRANT ALL ON TABLE "public"."product_stocks" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_orders" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_receipt_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_receipt_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_receipt_items" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_receipts" TO "anon";
GRANT ALL ON TABLE "public"."purchase_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."regions" TO "anon";
GRANT ALL ON TABLE "public"."regions" TO "authenticated";
GRANT ALL ON TABLE "public"."regions" TO "service_role";



GRANT ALL ON TABLE "public"."shop_hidden_categories" TO "anon";
GRANT ALL ON TABLE "public"."shop_hidden_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_hidden_categories" TO "service_role";



GRANT ALL ON TABLE "public"."shop_members" TO "anon";
GRANT ALL ON TABLE "public"."shop_members" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_members" TO "service_role";



GRANT ALL ON TABLE "public"."shop_requisition_items" TO "anon";
GRANT ALL ON TABLE "public"."shop_requisition_items" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_requisition_items" TO "service_role";



GRANT ALL ON TABLE "public"."shop_requisitions" TO "anon";
GRANT ALL ON TABLE "public"."shop_requisitions" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_requisitions" TO "service_role";



GRANT ALL ON TABLE "public"."shop_suppliers" TO "anon";
GRANT ALL ON TABLE "public"."shop_suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."shops" TO "anon";
GRANT ALL ON TABLE "public"."shops" TO "authenticated";
GRANT ALL ON TABLE "public"."shops" TO "service_role";



GRANT ALL ON TABLE "public"."site_settings" TO "anon";
GRANT ALL ON TABLE "public"."site_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."site_settings" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_scopes" TO "anon";
GRANT ALL ON TABLE "public"."supplier_scopes" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_scopes" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."warehouse_stocks" TO "anon";
GRANT ALL ON TABLE "public"."warehouse_stocks" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouse_stocks" TO "service_role";



GRANT ALL ON TABLE "public"."warehouse_transfer_items" TO "anon";
GRANT ALL ON TABLE "public"."warehouse_transfer_items" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouse_transfer_items" TO "service_role";



GRANT ALL ON TABLE "public"."warehouse_transfers" TO "anon";
GRANT ALL ON TABLE "public"."warehouse_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouse_transfers" TO "service_role";



GRANT ALL ON TABLE "public"."warehouses" TO "anon";
GRANT ALL ON TABLE "public"."warehouses" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouses" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































