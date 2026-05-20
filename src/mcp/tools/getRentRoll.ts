import { z } from 'zod';
import { RENT_ROLL } from '../../shared/kpiCatalog';
import { runScopedQuery, ScopedQuerySpec } from '../../cube/scopedCube';
import { McpAuth } from '../bearerAuth';

export const getRentRollInputSchema = z.object({
  status: z
    .enum(['Current', 'Notice', 'Eviction', 'Past', 'All'])
    .optional()
    .describe('Tenant status filter. Default: All.'),
  properties: z
    .array(z.string())
    .optional()
    .describe('Restrict to specific Leni property IDs. Default: ALL accessible.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('Row limit (capped at 10 000). Default: 1000.'),
});

export const getRentRollTool = {
  name: 'get_rent_roll',
  description:
    'Tenant-level rent roll grouped by property and tenant status. Useful ' +
    'for questions like "show me delinquent tenants" or "how many leases ' +
    'are on notice this week". Always scoped to the user\'s buildings.',
  inputSchema: getRentRollInputSchema,
  handler: async (
    input: z.infer<typeof getRentRollInputSchema>,
    auth: McpAuth,
  ): Promise<{ rows: any[]; rowCount: number }> => {
    const status = input.status || 'All';
    const filters: any[] = [];
    if (status !== 'All') {
      filters.push({
        member: RENT_ROLL.statusField,
        operator: 'equals',
        values: [status],
      });
    }
    if (input.properties && input.properties.length > 0) {
      const requested = input.properties;
      const allowed =
        auth.buildingIds === '*'
          ? requested
          : (auth.buildingIds as string[]).filter((b) => requested.indexOf(b) !== -1);
      if (allowed.length === 0) {
        throw new Error('None of the requested properties are within your access.');
      }
      filters.push({
        member: RENT_ROLL.propertyIdField,
        operator: 'equals',
        values: allowed,
      });
    }

    const spec: ScopedQuerySpec = {
      measures: [RENT_ROLL.countMeasure],
      dimensions: [RENT_ROLL.propertyNameField, RENT_ROLL.statusField],
      filters: filters.length > 0 ? filters : undefined,
      limit: input.limit || 1000,
      organizationIdField: RENT_ROLL.organizationIdField,
      propertyIdField: RENT_ROLL.propertyIdField,
    };

    const { rows, rowCount } = await runScopedQuery(spec, {
      userId: auth.userId,
      organisationId: auth.organisationId,
      buildingIds: auth.buildingIds,
    }, auth.jti);

    return { rows, rowCount };
  },
};
