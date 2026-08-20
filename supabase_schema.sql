-- =============================================================================
-- SCHÉMA SUPABASE POUR LA PLATEFORME DE BOTS IA OMNICANAUX (IDEMPOTENT)
-- =============================================================================

-- 1. Table des Boutiques & Commerçants
CREATE TABLE IF NOT EXISTS public.merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    manager_name TEXT,
    manager_phone TEXT NOT NULL,
    manager_email TEXT,
    whatsapp_phone_number_id TEXT,
    whatsapp_phone_number TEXT,
    city TEXT DEFAULT 'Yaoundé',
    delivery_terms TEXT,
    system_prompt TEXT,
    catalog JSONB DEFAULT '[]'::jsonb,
    credits_remaining INTEGER DEFAULT 20, -- 20 messages d'essai offerts
    total_messages_processed INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table des Paiements & Recharges PayMooney
CREATE TABLE IF NOT EXISTS public.bot_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    item_ref TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL, -- en FCFA
    currency TEXT DEFAULT 'XAF',
    credits_granted INTEGER NOT NULL,
    pack_name TEXT NOT NULL,
    payer_phone TEXT,
    payment_method TEXT DEFAULT 'paymooney',
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    raw_gateway_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

-- 3. Table des Commandes Reçues par le Bot
CREATE TABLE IF NOT EXISTS public.bot_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
    customer_name TEXT,
    customer_phone TEXT NOT NULL,
    customer_address TEXT,
    order_details TEXT NOT NULL,
    total_amount INTEGER,
    channel TEXT DEFAULT 'whatsapp', -- 'whatsapp', 'telegram', 'instagram'
    status TEXT DEFAULT 'new', -- 'new', 'confirmed', 'delivered', 'cancelled'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour accélérer la recherche
CREATE INDEX IF NOT EXISTS idx_merchants_whatsapp ON public.merchants(whatsapp_phone_number);
CREATE INDEX IF NOT EXISTS idx_merchants_phone ON public.merchants(manager_phone);
CREATE INDEX IF NOT EXISTS idx_payments_item_ref ON public.bot_payments(item_ref);

-- RLS (Row Level Security)
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_orders ENABLE ROW LEVEL SECURITY;

-- Suppression des anciennes politiques si existantes pour éviter les erreurs
DROP POLICY IF EXISTS "Accès public lecture/écriture pour service backend" ON public.merchants;
DROP POLICY IF EXISTS "Accès public paiements pour service backend" ON public.bot_payments;
DROP POLICY IF EXISTS "Accès public commandes pour service backend" ON public.bot_orders;

-- Création sécurisée des politiques
CREATE POLICY "Accès public lecture/écriture pour service backend" ON public.merchants FOR ALL USING (true);
CREATE POLICY "Accès public paiements pour service backend" ON public.bot_payments FOR ALL USING (true);
CREATE POLICY "Accès public commandes pour service backend" ON public.bot_orders FOR ALL USING (true);
