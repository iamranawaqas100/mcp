import { z } from 'zod';
import { KPI_CATALOG, generateYTDDateArray, YTD_TIME_RANGE_SENTINEL } from '../../shared/kpiCatalog';
import { runScopedQuery, ScopedQuerySpec } from '../../cube/scopedCube';
import { McpAuth } from '../bearerAuth';

const GroupBy = z.enum(['property', 'day', 'week', 'month', 'none']).optional();

export const getKpiInputSchema = z.object({
  kpi: z
    .string()
    .describe('The KPI key (call `list_kpis` for the catalog). e.g. "occupancy_rate".'),
  properties: z
    .array(z.string())
    .optional()
    .describe('Restrict to specific Leni property IDs. Defaults to ALL accessible properties.'),
  timeRange: z
    .union([
      z.string(),
      z.tuple([z.string(), z.string()]),
    ])
    .optional()
    .describe('Cube time range, e.g. "this month", "last 30 days", or ["2024-01-01","2024-12-31"].'),
  groupBy: GroupBy.describe('How to break the result down. Default: "property".'),
  limit: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('Row limit (capped at 10 000).'),
});

export const getKpiTool = {
  name: 'get_kpi',
  description:
    'Fetch a property analytics KPI scoped to the current user\'s ' +
    'organisation and accessible buildings. Returns rows of `{property, ' +
    'value, ...}`. Use `list_kpis` first to discover KPI keys.',
  inputSchema: getKpiInputSchema,
  handler: async (
    input: z.infer<typeof getKpiInputSchema>,
    auth: McpAuth,
  ): Promise<{ rows: any[]; rowCount: number; kpi: string; appliedTimeRange?: any }> => {
    const spec = KPI_CATALOG[input.kpi];
    if (!spec) {
      throw new Error(`Unknown KPI: ${input.kpi}. Call list_kpis for the catalog.`);
    }

    const groupBy = input.groupBy || 'property';
    const dimensions: string[] = [];
    if (groupBy === 'property' || groupBy === 'day' || groupBy === 'week' || groupBy === 'month') {
      dimensions.push(spec.propertyNameField);
    }

    const timeDimensions: any[] = [];
    let appliedTimeRange: any = undefined;
    if (spec.timeDimensionField) {
      let tr: any = input.timeRange !== undefined ? input.timeRange : spec.defaultTimeRange;
      if (tr === YTD_TIME_RANGE_SENTINEL) tr = generateYTDDateArray();
      const td: any = { dimension: spec.timeDimensionField };
      if (tr) td.dateRange = tr;
      if (groupBy === 'day') td.granularity = 'day';
      else if (groupBy === 'week') td.granularity = 'week';
      else if (groupBy === 'month') td.granularity = 'month';
      timeDimensions.push(td);
      appliedTimeRange = tr;
    }

    const filters: any[] = [];
    if (spec.additionalFilters) {
      for (const f of spec.additionalFilters) filters.push(f);
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
        member: spec.propertyIdField,
        operator: 'equals',
        values: allowed,
      });
    }

    const querySpec: ScopedQuerySpec = {
      measures: [spec.measureField],
      dimensions: dimensions.length > 0 ? dimensions : undefined,
      timeDimensions: timeDimensions.length > 0 ? timeDimensions : undefined,
      filters: filters.length > 0 ? filters : undefined,
      limit: input.limit,
      organizationIdField: spec.organizationIdField,
      propertyIdField: spec.propertyIdField,
    };

    const { rows, rowCount } = await runScopedQuery(querySpec, {
      userId: auth.userId,
      organisationId: auth.organisationId,
      buildingIds: auth.buildingIds,
    }, auth.jti);

    return { rows, rowCount, kpi: input.kpi, appliedTimeRange };
  },
};
