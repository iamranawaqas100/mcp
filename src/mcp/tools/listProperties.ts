import { z } from 'zod';
import { runScopedQuery, ScopedQuerySpec } from '../../cube/scopedCube';
import { PROPERTIES } from '../../shared/kpiCatalog';
import { McpAuth } from '../bearerAuth';

export const listPropertiesTool = {
  name: 'list_properties',
  description:
    'List the properties (buildings) the current Leni user has access to, ' +
    'from the UDM property catalog (Cube `dipr_property_v2`). ' +
    'Returns each property\'s Leni ID (use it as the building filter for ' +
    'other tools), display name, and short code if available.',
  inputSchema: z.object({}).describe('No arguments.'),
  handler: async (
    _input: any,
    auth: McpAuth,
  ): Promise<{ properties: Array<{ id: string; name: string; code: string | null }> }> => {
    if (!auth.organisationId) {
      throw new Error('Token has no organisation_id');
    }
    if (auth.buildingIds !== '*' && (!Array.isArray(auth.buildingIds) || auth.buildingIds.length === 0)) {
      return { properties: [] };
    }

    const spec: ScopedQuerySpec = {
      measures: [PROPERTIES.measureField],
      dimensions: [
        PROPERTIES.propertyIdField,
        PROPERTIES.propertyNameField,
        PROPERTIES.propertyCodeField,
      ],
      limit: 10000,
      organizationIdField: PROPERTIES.organizationIdField,
      propertyIdField: PROPERTIES.propertyIdField,
    };

    const { rows } = await runScopedQuery(
      spec,
      {
        userId: auth.userId,
        organisationId: auth.organisationId,
        buildingIds: auth.buildingIds,
      },
      auth.jti,
    );

    const byId = new Map<string, { id: string; name: string; code: string | null }>();
    for (const row of rows) {
      const id = row[PROPERTIES.propertyIdField];
      if (typeof id !== 'string' || id.length === 0) continue;
      const name = row[PROPERTIES.propertyNameField];
      const code = row[PROPERTIES.propertyCodeField];
      byId.set(id, {
        id,
        name: typeof name === 'string' && name.length > 0 ? name : id,
        code: typeof code === 'string' && code.length > 0 ? code : null,
      });
    }

    const properties = Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );

    return { properties };
  },
};
