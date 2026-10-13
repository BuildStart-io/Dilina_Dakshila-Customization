-- ==============================================================================
-- BuildStart Customization: Mr. Dilina Dakshina
-- Migration 04: Products, Orders, Leads, Ad Attribution & 300 msgs/day Tracking
-- ==============================================================================

-- Ensure schema exists and permissions granted
CREATE SCHEMA IF NOT EXISTS "Dakshila_Dilina";
GRANT USAGE, CREATE ON SCHEMA "Dakshila_Dilina" TO anon, authenticated, service_role, postgres;

-- 1. Extend products table
ALTER TABLE IF EXISTS "Dakshila_Dilina".products
ADD COLUMN IF NOT EXISTS category text DEFAULT 'General',
ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT 100;

-- Also support central_cab if active
ALTER TABLE IF EXISTS "central_cab".products
ADD COLUMN IF NOT EXISTS category text DEFAULT 'General',
ADD COLUMN IF NOT EXISTS stock_quantity integer DEFAULT 100;

-- 2. Extend orders table
ALTER TABLE IF EXISTS "Dakshila_Dilina".orders
ADD COLUMN IF NOT EXISTS normal_phone text,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'payment_pending',
ADD COLUMN IF NOT EXISTS payment_slip_url text,
ADD COLUMN IF NOT EXISTS courier_status text DEFAULT 'courier_transfer_pending',
ADD COLUMN IF NOT EXISTS courier_tracking_id text,
ADD COLUMN IF NOT EXISTS bill_pdf_url text,
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS campaign_id text,
ADD COLUMN IF NOT EXISTS customer_notes text,
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS "central_cab".orders
ADD COLUMN IF NOT EXISTS normal_phone text,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'payment_pending',
ADD COLUMN IF NOT EXISTS payment_slip_url text,
ADD COLUMN IF NOT EXISTS courier_status text DEFAULT 'courier_transfer_pending',
ADD COLUMN IF NOT EXISTS courier_tracking_id text,
ADD COLUMN IF NOT EXISTS bill_pdf_url text,
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS campaign_id text,
ADD COLUMN IF NOT EXISTS customer_notes text,
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;

-- 3. Extend leads table
ALTER TABLE IF EXISTS "Dakshila_Dilina".leads
ADD COLUMN IF NOT EXISTS normal_phone text,
ADD COLUMN IF NOT EXISTS delivery_address text,
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS ad_name text,
ADD COLUMN IF NOT EXISTS campaign_id text,
ADD COLUMN IF NOT EXISTS campaign_name text,
ADD COLUMN IF NOT EXISTS selected_product text,
ADD COLUMN IF NOT EXISTS followups_sent integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_followup_limit integer DEFAULT 4,
ADD COLUMN IF NOT EXISTS next_followup_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'active',
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS "central_cab".leads
ADD COLUMN IF NOT EXISTS normal_phone text,
ADD COLUMN IF NOT EXISTS delivery_address text,
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'direct',
ADD COLUMN IF NOT EXISTS ad_id text,
ADD COLUMN IF NOT EXISTS ad_name text,
ADD COLUMN IF NOT EXISTS campaign_id text,
ADD COLUMN IF NOT EXISTS campaign_name text,
ADD COLUMN IF NOT EXISTS selected_product text,
ADD COLUMN IF NOT EXISTS followups_sent integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_followup_limit integer DEFAULT 4,
ADD COLUMN IF NOT EXISTS next_followup_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'active',
ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;

-- 4. Function to compute daily message metrics for 300 msgs/day capacity
CREATE OR REPLACE FUNCTION "Dakshila_Dilina".get_daily_message_stats(_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'sent', COALESCE(COUNT(*) FILTER (WHERE direction = 'outbound'), 0),
  'received', COALESCE(COUNT(*) FILTER (WHERE direction = 'inbound'), 0),
  'total', COALESCE(COUNT(*), 0),
  'limit', 300,
  'remaining', GREATEST(0, 300 - COALESCE(COUNT(*), 0))
)
FROM "Dakshila_Dilina".conversations
WHERE user_id = _user_id
AND created_at >= date_trunc('day', now());
$$;

CREATE OR REPLACE FUNCTION "central_cab".get_daily_message_stats(_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'sent', COALESCE(COUNT(*) FILTER (WHERE direction = 'outbound'), 0),
  'received', COALESCE(COUNT(*) FILTER (WHERE direction = 'inbound'), 0),
  'total', COALESCE(COUNT(*), 0),
  'limit', 300,
  'remaining', GREATEST(0, 300 - COALESCE(COUNT(*), 0))
)
FROM "central_cab".conversations
WHERE user_id = _user_id
AND created_at >= date_trunc('day', now());
$$;

-- Grant execution to all roles
GRANT EXECUTE ON FUNCTION "Dakshila_Dilina".get_daily_message_stats(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION "central_cab".get_daily_message_stats(uuid) TO anon, authenticated, service_role;
