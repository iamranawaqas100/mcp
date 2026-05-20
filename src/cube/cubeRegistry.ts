export interface CubeScopeFields {
  organizationIdField: string;
  propertyIdField: string;
}

/**
 * Resolves the mandatory org and property scope fields for a cube by
 * scanning its dimension list for the UDM naming conventions:
 *   - org field:      any dimension ending in `_organization_id`
 *   - property field: any dimension ending in `_property_leni_id`
 *
 * Returns null if either field is absent, meaning the cube cannot be
 * safely scoped and must not be exposed to MCP tools.
 */
export const resolveScopeFields = (
  dimensions: Array<{ name: string }>,
): CubeScopeFields | null => {
  const orgField = dimensions.find((d) => d.name.endsWith('_organization_id'))?.name;
  const propField = dimensions.find((d) => d.name.endsWith('_property_leni_id'))?.name;
  if (!orgField || !propField) return null;
  return { organizationIdField: orgField, propertyIdField: propField };
};
