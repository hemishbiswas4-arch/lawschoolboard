-- NLS Law School Display Board Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: config
CREATE TABLE IF NOT EXISTS public.config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

-- Insert default admin password (change this in production)
INSERT INTO public.config (key, value, description) 
VALUES ('admin_password', 'nlsadmin123', 'Password to bootstrap admin access')
ON CONFLICT (key) DO NOTHING;

-- Table: admins
CREATE TABLE IF NOT EXISTS public.admins (
    email TEXT PRIMARY KEY,
    grantedBy TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Table: courses
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    professor TEXT,
    year INTEGER,
    trimester INTEGER,
    isElective BOOLEAN DEFAULT false,
    classroom TEXT,
    weeklySchedule TEXT,
    totalSessions INTEGER DEFAULT 40,
    currentSession INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    outline TEXT,
    lastUpdated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updatedBy TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Set up Row Level Security (RLS)

-- Admins Table RLS
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view admins" 
    ON public.admins FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Only admins can insert admins" 
    ON public.admins FOR INSERT 
    TO authenticated 
    WITH CHECK (
        (auth.jwt()->>'email' IN (SELECT email FROM public.admins))
        OR 
        (auth.jwt()->>'email' = email) -- allow self-insert if they know the password (enforced in API/Edge fn, but allowed here)
    );

-- Config Table RLS
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read config"
    ON public.config FOR SELECT
    TO authenticated
    USING (true);

-- Courses Table RLS
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

-- 1. All authenticated users (from nls.ac.in, enforced by Auth) can view courses
CREATE POLICY "Anyone authenticated can view courses" 
    ON public.courses FOR SELECT 
    TO authenticated 
    USING (true);

-- 2. All authenticated users can UPDATE courses (collaborative edits)
CREATE POLICY "Anyone authenticated can update courses" 
    ON public.courses FOR UPDATE 
    TO authenticated 
    USING (true)
    WITH CHECK (true);

-- 3. Only admins can INSERT courses
CREATE POLICY "Only admins can insert courses" 
    ON public.courses FOR INSERT 
    TO authenticated 
    WITH CHECK (
        auth.jwt()->>'email' IN (SELECT email FROM public.admins)
    );

-- 4. Only admins can DELETE courses
CREATE POLICY "Only admins can delete courses" 
    ON public.courses FOR DELETE 
    TO authenticated 
    USING (
        auth.jwt()->>'email' IN (SELECT email FROM public.admins)
    );

-- Realtime replication setup
-- Note: You might need to run this manually in the SQL editor if this fails
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;
ALTER PUBLICATION supabase_realtime ADD TABLE public.courses;
