import type { User } from '@agentops/contracts';
import type { Request } from 'express';

export type AuthUser = User;

export interface JwtPayload {
  sub: number;
  email: string;
  name: string;
  role: AuthUser['role'];
}

export type AuthedRequest = Request & { user?: AuthUser };
