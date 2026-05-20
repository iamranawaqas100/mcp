import CubeApiService from '../integrations/cube-api';
import logger from '../utils/logger';

/**
 * Scope claims attached to every MCP request via the bearer-token middleware.
 * The wildcard `'*'` building list is reserved for org-wide admins; a plain
 * empty array means "no buildings" and MUST be rejected by tools.
 */
export interface CubeScope {
  userId: string;
  organisationId: string | null;
  buildingIds: string[] | '*';
}

export interface ScopedQuerySpec {
  measures: string[];
  dimensions?: string[];
  timeDimensions?: any[];
  filters?: any[];
  order?: any;
  limit?: number;
  /** Cube field that holds the org id; will be filtered to scope.organisationId. */
  organizationIdField: string;
  /** Cube field that holds the property's Leni UUID; will be filtered to scope.buildingIds. */
  propertyIdField: string;
}

const ROW_LIMIT_CAP = 10000;
const REQUEST_TIMEOUT_MS = 20000;
const PER_TOKEN_HOURLY_BUDGET = 100;
const BUDGET_WINDOW_MS = 60 * 60 * 1000;

const budgetTracker: Map<string, { count: number; windowStart: number }> = new Map();

/** Remove windows that ended; otherwise unique JTIs that never repeat grow the Map forever. */
const pruneStaleBudgetEntries = (now: number): void => {
  for (const [key, entry] of budgetTracker.entries()) {
    if (now - entry.windowStart > BUDGET_WINDOW_MS) {
      budgetTracker.delete(key);
    }
  }
};

const checkBudget = (jti: string): boolean => {
  const now = Date.now();
  pruneStaleBudgetEntries(now);
  const entry = budgetTracker.get(jti);
  if (!entry || now - entry.windowStart > BUDGET_WINDOW_MS) {
    budgetTracker.set(jti, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= PER_TOKEN_HOURLY_BUDGET) {
    return false;
  }
  entry.count = entry.count + 1;
  return true;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cube query timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
};

/**
 * Build a Cube query body from a scoped spec, unconditionally injecting
 * organisation + building filters from the bearer-token claims. Tool inputs
 * are NEVER trusted to scope.
 */
export const buildScopedBody = (spec: ScopedQuerySpec, scope: CubeScope) => {
  const filters: any[] = [];

  // Org filter — required.
  if (!scope.organisationId) {
    throw new Error('Token has no organisation_id; cannot scope Cube query');
  }
  filters.push({
    member: spec.organizationIdField,
    operator: 'equals',
    values: [scope.organisationId],
  });

  // Building filter — only if not org-wide (`*`).
  if (scope.buildingIds !== '*') {
    if (!Array.isArray(scope.buildingIds) || scope.buildingIds.length === 0) {
      throw new Error('Token grants access to no buildings');
    }
    filters.push({
      member: spec.propertyIdField,
      operator: 'equals',
      values: scope.buildingIds,
    });
  }

  // Caller-supplied filters are appended AFTER scope filters; scope cannot
  // be widened, only narrowed (Cube AND-combines filters at the same level).
  if (spec.filters && spec.filters.length > 0) {
    for (const f of spec.filters) {
      filters.push(f);
    }
  }

  const body: any = {
    measures: spec.measures,
    filters,
  };
  if (spec.dimensions) body.dimensions = spec.dimensions;
  if (spec.timeDimensions) body.timeDimensions = spec.timeDimensions;
  if (spec.order) body.order = spec.order;

  let bodyLimit = ROW_LIMIT_CAP;
  const rawLimit = spec.limit;
  if (rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0) {
    const n = Math.trunc(rawLimit);
    bodyLimit = Math.min(Math.max(1, n), ROW_LIMIT_CAP);
  }
  body.limit = bodyLimit;

  return body;
};

/**
 * Run a scoped Cube query. Enforces:
 *  - per-token hourly query budget
 *  - row-limit cap (10 000)
 *  - request timeout (20 s)
 *  - mandatory org + building filter injection
 */
export const runScopedQuery = async (
  spec: ScopedQuerySpec,
  scope: CubeScope,
  jti: string,
): Promise<{ rows: any[]; rowCount: number }> => {
  if (!checkBudget(jti)) {
    const err: any = new Error('Per-token hourly query budget exceeded');
    err.statusCode = 429;
    throw err;
  }

  const body = buildScopedBody(spec, scope);
  const cube = new CubeApiService();
  const result = await withTimeout(cube.connectToCube({ body }), REQUEST_TIMEOUT_MS);

  if (result.status !== 200) {
    logger.error('[scopedCube] Cube query failed', { status: result.status, body });
    const err: any = new Error('Cube query failed');
    err.statusCode = 502;
    err.cause = (result as any).error;
    throw err;
  }

  const rows = (result as any).data || [];
  return { rows, rowCount: rows.length };
};
