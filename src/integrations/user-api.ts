import logger from '../utils/logger';

export interface LeniUserFromApi {
  id: string;
  email: string;
  organisationId: string | null;
  buildingIds: string[];
}

const userServiceBaseUrl = (): string => {
  const raw =
    process.env.USER_SERVICE_URL ||
    process.env.API_GATEWAY ||
    'http://localhost:8088';
  return raw.replace(/\/$/, '');
};

/**
 * Loads the current user from user-service via the gateway (`GET /users/me`),
 * forwarding the Leni `sr_access` session cookie.
 */
export const fetchCurrentUser = async (srAccessToken: string): Promise<LeniUserFromApi | null> => {
  const url = `${userServiceBaseUrl()}/users/me`;
  try {
    const res = await fetch(url, {
      headers: {
        Cookie: `sr_access=${srAccessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      logger.warn(`[user-api] GET /users/me returned ${res.status}`);
      return null;
    }
    const body: any = await res.json();
    const id = typeof body.id === 'string' ? body.id : null;
    const email = typeof body.email === 'string' ? body.email : '';
    if (!id) return null;

    let organisationId: string | null = null;
    if (body.organisationId != null && String(body.organisationId).length > 0) {
      organisationId = String(body.organisationId);
    }

    let buildingIds: string[] = [];
    if (Array.isArray(body.buildingIds)) {
      buildingIds = body.buildingIds.filter((x: unknown) => typeof x === 'string') as string[];
    }

    return { id, email, organisationId, buildingIds };
  } catch (err) {
    logger.warn('[user-api] GET /users/me failed', err as any);
    return null;
  }
};
