import { AuthError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AuthResult = { error: string | null };

type Codeful = { code?: string; message?: string };

/**
 * Translate a Supabase auth error into a plain-English message safe to show
 * to the user. Unknown codes get a generic fallback so we never surface raw
 * error text or stack traces in the UI (per CLAUDE.md error-handling rules).
 *
 * Original error detail is logged in dev for debugging.
 */
export function translateAuthError(err: AuthError | Codeful): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[auth] supabase error:', err);
  }
  const code = (err as Codeful).code;
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'weak_password':
      return 'Password is too short. Use at least 6 characters.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists.';
    case 'over_email_send_rate_limit':
      return 'Too many attempts — wait a minute and try again.';
    case 'email_not_confirmed':
      return 'Please confirm your email before signing in.';
    case 'validation_failed':
      return 'Please check your email and password and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export async function signUp(args: {
  email: string;
  password: string;
  displayName: string;
  color: string;
}): Promise<AuthResult> {
  const { error } = await supabase.auth.signUp({
    email: args.email,
    password: args.password,
    options: {
      data: {
        display_name: args.displayName,
        color: args.color,
      },
    },
  });
  return { error: error ? translateAuthError(error) : null };
}

export async function signIn(args: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: args.email,
    password: args.password,
  });
  return { error: error ? translateAuthError(error) : null };
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  return { error: error ? translateAuthError(error) : null };
}
