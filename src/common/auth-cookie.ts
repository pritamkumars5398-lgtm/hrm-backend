import type { CookieOptions, Response } from 'express';
import { AUTH_COOKIE } from './jwt-payload';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(isProduction: boolean): CookieOptions {
  return {
    // Not readable from JavaScript — the whole point of the cookie approach
    // over localStorage (§11.1).
    httpOnly: true,
    // Cross-site cookies must be Secure, so production needs both. In dev the
    // frontend and API are same-site over http, where lax works.
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  };
}

export function setAuthCookie(res: Response, token: string, isProduction: boolean): void {
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions(isProduction), maxAge: SEVEN_DAYS_MS });
}

/** Must clear with the same attributes it was set with, or the browser keeps it. */
export function clearAuthCookie(res: Response, isProduction: boolean): void {
  res.clearCookie(AUTH_COOKIE, cookieOptions(isProduction));
}
