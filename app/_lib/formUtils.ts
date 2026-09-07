/** Shared FormData helpers for server actions (kept out of 'use server' files — those may only export async functions). */

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function formString(formData: FormData, key: string, fallback = ''): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : fallback;
}

/**
 * `JSON.parse` that yields `null` instead of throwing. Every JSON column in
 * Wallet's schema (`encrypted_metadata`, `wrapped_dek`, an encrypted
 * `payload`) and every JSON form field is data the server never authored, so
 * a malformed value must degrade to a locked/undecryptable state rather than
 * throwing out of a server action.
 */
export function parseJsonOrNull<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}
