import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, optionalAuth } from './auth';
import { config } from '../config/env';

const sign = (payload: object) => jwt.sign(payload, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });

function mkRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res) as any;
  res.json = vi.fn().mockReturnValue(res) as any;
  return res as Response;
}

const restToken = () => sign({ userId: 'u1', email: 'a@b.c', role: 'admin', tenantId: 't1' });
const mcpToken = () => sign({ userId: 'u1', email: 'a@b.c', role: 'admin', tenantId: 't1', aud: 'mcp' });

describe('authenticate (REST) — audience binding', () => {
  it('accepts a normal REST token (no aud) and attaches the user', () => {
    const req = { headers: { authorization: `Bearer ${restToken()}` } } as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user?.tenantId).toBe('t1');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects an MCP-audience token with 401 (leaked connector token cannot hit REST)', () => {
    const req = { headers: { authorization: `Bearer ${mcpToken()}` } } as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('rejects a missing token', () => {
    const req = { headers: {} } as Request;
    const res = mkRes();
    const next = vi.fn() as NextFunction;
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('optionalAuth — audience binding', () => {
  it('attaches the user for a REST token', () => {
    const req = { headers: { authorization: `Bearer ${restToken()}` } } as Request;
    const next = vi.fn() as NextFunction;
    optionalAuth(req, mkRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user?.tenantId).toBe('t1');
  });

  it('does NOT attach the user for an MCP-audience token, but still proceeds', () => {
    const req = { headers: { authorization: `Bearer ${mcpToken()}` } } as Request;
    const next = vi.fn() as NextFunction;
    optionalAuth(req, mkRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});
