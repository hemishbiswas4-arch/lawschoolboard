import { supabase } from './supabase.js';

function ensureRpcResult(data, message) {
  if (data === true) {
    return data;
  }

  if (data && typeof data === 'object') {
    return data;
  }

  throw new Error(message);
}

function normalizeAdminRecord(record) {
  if (!record) return null;

  const grantedByEmail = record.granted_by_email || record.grantedby || null;
  const grantSource = record.grant_source || (grantedByEmail ? 'granted_admin' : 'system_password');
  const role = record.role || (grantSource === 'system_password' ? 'super_admin' : 'admin');

  return {
    ...record,
    email: String(record.email || '').toLowerCase(),
    role,
    grant_source: grantSource,
    granted_by_email: grantedByEmail,
    created_at: record.created_at || record.updated_at || null,
    updated_at: record.updated_at || record.created_at || null
  };
}

function getAdminRoleRank(record) {
  if (!record) return 0;
  if (record.role === 'super_admin') return 20;
  if (record.role === 'admin') return 10;
  return 0;
}

function dedupeAdminRecords(records) {
  const byEmail = new Map();

  (records || [])
    .map(normalizeAdminRecord)
    .filter(entry => entry?.email)
    .forEach(entry => {
      const existing = byEmail.get(entry.email);
      if (!existing) {
        byEmail.set(entry.email, entry);
        return;
      }

      const rankDiff = getAdminRoleRank(entry) - getAdminRoleRank(existing);
      const entryUpdatedAt = new Date(entry.updated_at || entry.created_at || 0).getTime();
      const existingUpdatedAt = new Date(existing.updated_at || existing.created_at || 0).getTime();

      if (rankDiff > 0 || (rankDiff === 0 && entryUpdatedAt > existingUpdatedAt)) {
        byEmail.set(entry.email, entry);
      }
    });

  return [...byEmail.values()];
}

export async function grantAdminAccess(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.rpc('grant_admin_access', {
    target_email: normalizedEmail
  });

  if (error) throw error;
  return normalizeAdminRecord(ensureRpcResult(
    data,
    'Admin access was not confirmed. Please refresh and try again.'
  ));
}

export async function revokeAdminAccess(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.rpc('revoke_admin_access', {
    target_email: normalizedEmail
  });

  if (error) throw error;
  return ensureRpcResult(
    data,
    'Admin revocation was not confirmed. Please refresh and try again.'
  );
}

export async function fetchAdmins() {
  const { data, error } = await supabase
    .from('admins')
    .select('*');

  if (error) throw error;
  return dedupeAdminRecords(data);
}

export async function verifyAdminPassword(password) {
  const { data, error } = await supabase.rpc('verify_admin_password', {
    password_attempt: password
  });

  if (error) throw error;
  return normalizeAdminRecord(ensureRpcResult(
    data,
    'Super admin access was not confirmed. Please refresh and try again.'
  ));
}
