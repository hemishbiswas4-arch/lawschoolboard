import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pawqdqgbafparrwefism.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_R428ur1eDU9EvHKkS0_eOA_A-TLgx0f';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
