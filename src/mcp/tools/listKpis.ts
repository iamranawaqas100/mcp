import { z } from 'zod';
import { cubeNameFromMeasure, fetchCubeMeasureNames } from '../../cube/cubeMeta';
import { KPI_CATALOG } from '../../shared/kpiCatalog';
import { McpAuth } from '../bearerAuth';

export const listKpisTool = {
  name: 'list_kpis',
  description:
    'List property analytics KPIs available in Cube that can be queried via ' +
    '`get_kpi`. Each entry has a stable `key`, description, default time range, ' +
    'and the underlying Cube measure. Only KPIs present in the live Cube schema are returned.',
  inputSchema: z.object({}).describe('No arguments.'),
  handler: async (
    _input: any,
    _auth: McpAuth,
  ): Promise<{
    kpis: Array<{
      key: string;
      description: string;
      defaultTimeRange?: string | string[];
      measureField: string;
      cube: string;
    }>;
  }> => {
    const measureNames = await fetchCubeMeasureNames();
    const kpis: Array<{
      key: string;
      description: string;
      defaultTimeRange?: string | string[];
      measureField: string;
      cube: string;
    }> = [];

    for (const k of Object.keys(KPI_CATALOG)) {
      const spec = KPI_CATALOG[k];
      if (!measureNames.has(spec.measureField)) {
        continue;
      }
      kpis.push({
        key: spec.key,
        description: spec.description,
        defaultTimeRange: spec.defaultTimeRange,
        measureField: spec.measureField,
        cube: cubeNameFromMeasure(spec.measureField),
      });
    }

    kpis.sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }));
    return { kpis };
  },
};
