import { z } from 'zod';
import CubeApiService from '../../integrations/cube-api';
import { resolveScopeFields } from '../../cube/cubeRegistry';
import { runScopedQuery, ScopedQuerySpec } from '../../cube/scopedCube';
import { McpAuth } from '../bearerAuth';

const FilterSchema = z.object({
  member: z.string(),
  operator: z.string(),
  values: z.array(z.string()).optional(),
});

const TimeDimensionSchema = z.object({
  dimension: z.string(),
  dateRange: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
  granularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
});

export const queryCubeInputSchema = z.object({
  cube: z
    .string()
    .describe('Cube name from `list_cubes`. e.g. "faor_occupancy_rate".'),
  measures: z
    .array(z.string())
    .describe('Measure keys to aggregate. e.g. ["faor_occupancy_rate.occupancy_rate"].'),
  dimensions: z
    .array(z.string())
    .optional()
    .describe('Dimension keys to group by. e.g. ["faor_occupancy_rate.faor_property_name"].'),
  filters: z
    .array(FilterSchema)
    .optional()
    .describe('Additional filters to apply. Org and building filters are always injected automatically.'),
  timeDimensions: z
    .array(TimeDimensionSchema)
    .optional()
    .describe('Time dimension filters and granularity. e.g. [{ dimension: "...", dateRange: "last 30 days", granularity: "day" }].'),
  limit: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('Row limit (capped at 10 000). Default: 1000.'),
});

export const queryCubeTool = {
  name: 'query_cube',
  description:
    'Run a freeform analytics query against any UDM cube. Always scoped to the ' +
    'current user\'s organisation and accessible buildings — you cannot widen the ' +
    'scope via filters. Call `list_cubes` first to discover valid cube names, ' +
    'measure keys, and dimension keys.',
  inputSchema: queryCubeInputSchema,
  handler: async (
    input: z.infer<typeof queryCubeInputSchema>,
    auth: McpAuth,
  ): Promise<{ rows: any[]; rowCount: number; cube: string }> => {
    const cubeApi = new CubeApiService();
    const meta = await cubeApi.meta();

    const cubeMeta = (meta.cubes || []).find((c: any) => c.name === input.cube);
    if (!cubeMeta) {
      throw new Error(
        `Unknown cube: "${input.cube}". Call list_cubes to see available cubes.`,
      );
    }

    const scopeFields = resolveScopeFields(cubeMeta.dimensions || []);
    if (!scopeFields) {
      throw new Error(
        `Cube "${input.cube}" cannot be safely scoped (missing org or property fields).`,
      );
    }

    const spec: ScopedQuerySpec = {
      measures: input.measures,
      dimensions: input.dimensions,
      timeDimensions: input.timeDimensions,
      filters: input.filters as any[] | undefined,
      limit: input.limit || 1000,
      organizationIdField: scopeFields.organizationIdField,
      propertyIdField: scopeFields.propertyIdField,
    };

    const { rows, rowCount } = await runScopedQuery(
      spec,
      {
        userId: auth.userId,
        organisationId: auth.organisationId,
        buildingIds: auth.buildingIds,
      },
      auth.jti,
    );

    return { rows, rowCount, cube: input.cube };
  },
};
