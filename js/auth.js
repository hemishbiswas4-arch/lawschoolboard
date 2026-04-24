import { supabase } from './supabase.js';

function getAuthRedirectUrl() {
  const configuredUrl = import.meta.env.VITE_APP_URL?.trim();
  if (configuredUrl) {
    try {
      const normalizedConfiguredUrl = configuredUrl.replace(/\/+$/, '');
      const configuredHost = new URL(normalizedConfiguredUrl).hostname;
      const currentHost = window.location.hostname;
      const configuredIsLocalhost = ['localhost', '127.0.0.1'].includes(configuredHost);
      const currentIsLocalhost = ['localhost', '127.0.0.1'].includes(currentHost);

      // Never let a production page inherit a localhost redirect target.
      if (!configuredIsLocalhost || currentIsLocalhost) {
        return normalizedConfiguredUrl;
      }
    } catch (error) {
      console.warn('Ignoring invalid VITE_APP_URL for auth redirect:', error);
    }
  }

  return window.location.origin;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      queryParams: { hd: 'nls.ac.in' },
      redirectTo: getAuthRedirectUrl()
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function getUserEmail(session) {
  return session?.user?.email || null;
}

export function isNLSEmail(email) {
  return email ? email.toLowerCase().endsWith('@nls.ac.in') : false;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function checkIsAdmin(email) {
  if (!email) return false;
  const { data } = await supabase.from('admins').select('email').eq('email', email.toLowerCase()).maybeSingle();
  return !!data;
}
