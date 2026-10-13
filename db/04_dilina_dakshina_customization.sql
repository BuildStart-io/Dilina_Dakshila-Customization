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

-- 5. Broadcast campaigns and queue tables
CREATE TABLE IF NOT EXISTS "Dakshila_Dilina".broadcast_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text DEFAULT 'Promotional Broadcast'::text NOT NULL,
    title text DEFAULT 'Promotional Broadcast'::text NOT NULL,
    segment text DEFAULT 'all'::text NOT NULL,
    audience_filter text DEFAULT 'all'::text NOT NULL,
    message text,
    message_template text,
    media_url text,
    media_type text,
    total_recipients integer DEFAULT 0 NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    delay_seconds integer DEFAULT 10 NOT NULL,
    delay_seconds_min integer DEFAULT 8 NOT NULL,
    delay_seconds_max integer DEFAULT 15 NOT NULL,
    batch_size integer DEFAULT 30 NOT NULL,
    batch_cooldown_seconds integer DEFAULT 120 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broadcast_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sending'::text, 'in_progress'::text, 'completed'::text, 'paused'::text, 'cancelled'::text, 'failed'::text])))
);

CREATE TABLE IF NOT EXISTS "Dakshila_Dilina".broadcast_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES "Dakshila_Dilina".broadcast_campaigns(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number text NOT NULL,
    customer_name text,
    recipient_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broadcast_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_user_id ON "Dakshila_Dilina".broadcast_campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue_campaign_id ON "Dakshila_Dilina".broadcast_queue (campaign_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue_status ON "Dakshila_Dilina".broadcast_queue (status);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue_user_id ON "Dakshila_Dilina".broadcast_queue (user_id);

ALTER TABLE "Dakshila_Dilina".broadcast_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Dakshila_Dilina".broadcast_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'Dakshila_Dilina' AND tablename = 'broadcast_campaigns' AND policyname = 'Users can manage own broadcast campaigns'
  ) THEN
    CREATE POLICY "Users can manage own broadcast campaigns" ON "Dakshila_Dilina".broadcast_campaigns USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'Dakshila_Dilina' AND tablename = 'broadcast_queue' AND policyname = 'Users can manage own broadcast queue'
  ) THEN
    CREATE POLICY "Users can manage own broadcast queue" ON "Dakshila_Dilina".broadcast_queue USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
  END IF;
END $$;

GRANT ALL ON TABLE "Dakshila_Dilina".broadcast_campaigns TO anon, authenticated, service_role;
GRANT ALL ON TABLE "Dakshila_Dilina".broadcast_queue TO anon, authenticated, service_role;

