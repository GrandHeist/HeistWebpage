import { domainToASCII } from 'node:url';

export const ROLES = ['server_owner', 'developer', 'player'];
export const MAX_SERVER_LENGTH = 100;

const MAX_EMAIL = 254;
const MAX_LOCAL = 64;
const LOCAL_CHARS = /^[a-z0-9._%+'&-]+$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const MESSAGES = {
  invalid_body: 'That request could not be read.',
  invalid_email: 'Please enter a valid email address.',
  invalid_role: 'Please pick one of the listed options.',
  invalid_server: 'The server name or link could not be read.',
  server_too_long: `Keep the server name or link to ${MAX_SERVER_LENGTH} characters or fewer.`,
};

const fail = (error) => ({ ok: false, error, message: MESSAGES[error] });

// Returns the cleaned address, or null if it is not acceptable.
// Deliberately stricter than the RFC: ASCII local part, real-looking domain, no IP literals.
export function normalizeEmail(input) {
  if (typeof input !== 'string' || input.length > 320) return null;
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > MAX_EMAIL) return null;
  // URL parsing would quietly drop tabs, newlines and invisible characters, so refuse them up front.
  if (/[\s\p{Cc}\p{Cf}]/u.test(email)) return null;

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return null;

  const local = email.slice(0, at);
  if (local.length > MAX_LOCAL || !LOCAL_CHARS.test(local)) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;

  // Internationalised domains are converted to their ASCII (punycode) form.
  const domain = domainToASCII(email.slice(at + 1));
  if (!domain || domain.length > 253 || !domain.includes('.')) return null;
  const labels = domain.split('.');
  if (!labels.every((label) => LABEL.test(label))) return null; // also rejects a trailing dot
  if (!TLD.test(labels[labels.length - 1])) return null;

  const result = `${local}@${domain}`;
  return result.length > MAX_EMAIL ? null : result;
}

// Optional free text: NFC, invisible/control characters removed, whitespace collapsed.
export function normalizeServer(input) {
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== 'string' || input.length > 2000) return { error: 'invalid_server' };
  const cleaned = input
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned === '') return { value: null };
  if (Array.from(cleaned).length > MAX_SERVER_LENGTH) return { error: 'server_too_long' };
  return { value: cleaned };
}

export function normalizeRole(input) {
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== 'string') return { error: 'invalid_role' };
  const role = input.trim().toLowerCase();
  if (role === '') return { value: null };
  return ROLES.includes(role) ? { value: role } : { error: 'invalid_role' };
}

// `body` is a plain object of raw field values. Returns { ok: true, bot, value } or { ok: false, error, message }.
// A filled honeypot field is reported as bot: true so the caller can pretend it worked.
export function validateSignup(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_body');
  const get = (key) => (Object.hasOwn(body, key) ? body[key] : undefined);

  const trap = get('homepage');
  if (trap !== undefined && trap !== null && trap !== '') return { ok: true, bot: true };

  const email = normalizeEmail(get('email'));
  if (!email) return fail('invalid_email');

  const role = normalizeRole(get('role'));
  if (role.error) return fail(role.error);

  const server = normalizeServer(get('server'));
  if (server.error) return fail(server.error);

  return { ok: true, bot: false, value: { email, role: role.value, server: server.value } };
}
