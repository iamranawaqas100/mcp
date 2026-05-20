import { z } from 'zod';
import CubeApiService from '../../integrations/cube-api';
import { resolveScopeFields } from '../../cube/cubeRegistry';
import { McpAuth } from '../bearerAuth';

export const listCubesTool = {
  name: 'list_cubes',
  description:
    'List all UDM cubes (data models) the current user can query, along with their ' +
    'available measures and dimensions. Use this before calling `query_cube` to ' +
    'discover valid cube names, measure keys, and dimension keys.',
  inputSchema: z.object({}).describe('No arguments.'),
  handler: async (
    _input: any,
    _auth: McpAuth,
  ): Promise<{ cubes: Array<{ name: string; title: string; measures: any[]; dimensions: any[] }> }> => {
    const cube = new CubeApiService();
    const meta = await cube.meta();

    const cubes: Array<{ name: string; title: string; measures: any[]; dimensions: any[] }> = [];

    for (const c of meta.cubes || []) {
      const scopeFields = resolveScopeFields(c.dimensions || []);
      if (!scopeFields) continue; // skip cubes that cannot be safely scoped

      cubes.push({
        name: c.name,
        title: c.title || c.name,
        measures: (c.measures || []).map((m: any) => ({
          name: m.name,
          title: m.title || m.name,
          type: m.type,
        })),
        dimensions: (c.dimensions || []).map((d: any) => ({
          name: d.name,
          title: d.title || d.name,
          type: d.type,
        })),
      });
    }

    return { cubes };
  },
};
