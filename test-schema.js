import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pawqdqgbafparrwefism.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_R428ur1eDU9EvHKkS0_eOA_A-TLgx0f';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function check() {
  console.log('Checking live schema for user_preferences...');
  const { data, error } = await supabase.from('user_preferences').select('*').limit(1);
  console.log('Result:', { data, error });
  
  console.log('Checking config table...');
  const res2 = await supabase.from('config').select('*').limit(1);
  console.log('Config Result:', res2);
}

check();
