import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { fetchCurrentUser } from '../integrations/user-api';
import { buildLoginRedirectUrl } from './loginRedirect';
import logger from '../utils/logger';

/**
 * Verifies the existing `sr_access` cookie minted by auth-service, then loads
 * user scope from user-service (`GET /users/me`). No direct database access.
 */

export interface LeniUserScope {
  id: string;
  email: string;
  organisationId: string | null;
  buildingIds: string[];
}

declare module 'express' {
  // tslint:disable-next-line:interface-name
  interface Request {
    leniUser?: LeniUserScope;
  }
}

export const requireSrAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (process.env.LOCAL_OAUTH_BYPASS === 'true') {
    req.leniUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'local-test@leni.co',
      organisationId: 'org-test',
      buildingIds: ['bld-1'],
    };
    next();
    return;
  }

  const cookies = (req as any).cookies || {};
  const token = cookies.sr_access;
  if (!token) {
    res.redirect(302, buildLoginRedirectUrl(req));
    return;
  }

  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    logger.error('[cookieBridge] JWT_ACCESS_SECRET is not set');
    res.status(500).send('Server misconfigured');
    return;
  }

  try {
    const decoded: any = jwt.verify(token, secret, { algorithms: ['HS256'] });
    const userId = decoded && decoded.userId;
    if (!userId) {
      res.redirect(302, buildLoginRedirectUrl(req));
      return;
    }

    const user = await fetchCurrentUser(token);
    if (!user || user.id !== userId) {
      res.redirect(302, buildLoginRedirectUrl(req));
      return;
    }

    req.leniUser = {
      id: user.id,
      email: user.email,
      organisationId: user.organisationId,
      buildingIds: user.buildingIds,
    };
    next();
  } catch (err) {
    logger.warn('[cookieBridge] sr_access verification failed', err as any);
    res.redirect(302, buildLoginRedirectUrl(req));
  }
};
