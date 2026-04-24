import { supabase } from './supabase.js';
import { createCourse, deleteCourse } from './data.js';

export async function addAdmin(email, grantedBy) {
  const { error } = await supabase
    .from('admins')
    .insert([{ email: email.toLowerCase(), grantedby: grantedBy }]);
  if (error) throw error;
}

export async function fetchAdmins() {
  const { data, error } = await supabase.from('admins').select('*');
  if (error) throw error;
  return data;
}

export async function verifyAdminPassword(password, userEmail) {
  // Call a Supabase Edge Function or check against a secure config table
  // For simplicity without edge functions, checking a secure config table
  const { data, error } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'admin_password')
    .single();
    
  if (error || !data) return false;
  
  if (data.value === password) {
    // Correct password, grant admin status
    await addAdmin(userEmail, 'system_password');
    return true;
  }
  return false;
}
