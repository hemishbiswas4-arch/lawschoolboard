import { supabase } from './supabase.js';

const VALID_PREFERENCE_YEARS = ['1', '2', '3', '4', '5'];
const VALID_PREFERENCE_TRIMESTERS = ['1', '2', '3'];

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

export function getBoardPreference(user) {
  const year = user?.user_metadata?.preferred_year ? String(user.user_metadata.preferred_year) : null;
  const trimester = user?.user_metadata?.preferred_trimester ? String(user.user_metadata.preferred_trimester) : null;

  if (!VALID_PREFERENCE_YEARS.includes(year) || !VALID_PREFERENCE_TRIMESTERS.includes(trimester)) {
    return null;
  }

  return { year, trimester };
}

export async function saveBoardPreference(year, trimester) {
  const normalizedYear = String(year);
  const normalizedTrimester = String(trimester);

  if (!VALID_PREFERENCE_YEARS.includes(normalizedYear) || !VALID_PREFERENCE_TRIMESTERS.includes(normalizedTrimester)) {
    throw new Error('Please choose a valid year and trimester.');
  }

  const { data: { user } } = await supabase.auth.getUser();
  const existingMetadata = user?.user_metadata || {};

  const { data, error } = await supabase.auth.updateUser({
    data: {
      ...existingMetadata,
      preferred_year: normalizedYear,
      preferred_trimester: normalizedTrimester
    }
  });

  if (error) throw error;
  return data.user;
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
