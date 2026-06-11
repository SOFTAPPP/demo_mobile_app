import { Request, Response, NextFunction } from 'express';

const XSS_PATTERNS = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>|on\w+\s*=\s*["'][^"']*["']|javascript\s*:/gi;

export function sanitizeInput(value: string): string {
  if (typeof value !== 'string') return value;
  return value.replace(XSS_PATTERNS, '').trim();
}

export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeInput(req.body[key]);
      }
    }
  }
  next();
}
