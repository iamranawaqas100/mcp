/**
 * Connector-friendly KPI catalog. Mirrors `CUBE_KPI_CONFIGS` from
 * scheduler-service/src/utils/cubeConfig.ts but adds plain-English
 * `description` fields used by the MCP `list_kpis` tool.
 *
 * TODO(consolidate): extract a single shared package once monorepo
 * tooling allows cross-service imports.
 */

export const YTD_TIME_RANGE_SENTINEL = 'ytd';

export const generateYTDDateArray = (): string[] => {
  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const fmt = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return [fmt(startDate), fmt(today)];
};

export interface KpiSpec {
  /** Public, stable KPI key surfaced to Claude users. */
  key: string;
  /** Plain-English description for the LLM. */
  description: string;
  /** Cube measure (e.g. faor_occupancy_rate.occupancy_rate). */
  measureField: string;
  /** Cube dimension carrying the organisation id (must always be filtered). */
  organizationIdField: string;
  /** Cube dimension carrying the property's Leni UUID (always filtered). */
  propertyIdField: string;
  /** Property name dimension – used as the human-readable group-by. */
  propertyNameField: string;
  /** Time dimension, when the KPI is time-series. */
  timeDimensionField?: string;
  /** Default Cube timeRange when caller does not supply one. */
  defaultTimeRange?: string | string[];
  /** Static filters that must always be applied (charge group, status, ...). */
  additionalFilters?: Array<{ member: string; operator: string; values?: string[] }>;
}

export const KPI_CATALOG: { [key: string]: KpiSpec } = {
  occupancy_rate: {
    key: 'occupancy_rate',
    description: 'Percentage of available units that are currently occupied (yesterday\'s snapshot by default).',
    measureField: 'faor_occupancy_rate.occupancy_rate',
    organizationIdField: 'faor_occupancy_rate.faor_organization_id',
    propertyIdField: 'faor_occupancy_rate.faor_property_leni_id',
    propertyNameField: 'faor_occupancy_rate.faor_property_name',
    timeDimensionField: 'faor_occupancy_rate.faor_stats_date',
    defaultTimeRange: 'yesterday',
  },
  vacancy_rate: {
    key: 'vacancy_rate',
    description: 'Percentage of available units that are currently vacant.',
    measureField: 'faor_occupancy_rate.vacancy_rate',
    organizationIdField: 'faor_occupancy_rate.faor_organization_id',
    propertyIdField: 'faor_occupancy_rate.faor_property_leni_id',
    propertyNameField: 'faor_occupancy_rate.faor_property_name',
    timeDimensionField: 'faor_occupancy_rate.faor_stats_date',
    defaultTimeRange: 'yesterday',
  },
  total_occupied_units: {
    key: 'total_occupied_units',
    description: 'Count of currently occupied units.',
    measureField: 'faor_occupancy_rate.total_occupied_units',
    organizationIdField: 'faor_occupancy_rate.faor_organization_id',
    propertyIdField: 'faor_occupancy_rate.faor_property_leni_id',
    propertyNameField: 'faor_occupancy_rate.faor_property_name',
    timeDimensionField: 'faor_occupancy_rate.faor_stats_date',
    defaultTimeRange: 'yesterday',
  },
  vacant_units: {
    key: 'vacant_units',
    description: 'Count of currently vacant units.',
    measureField: 'faor_occupancy_rate.vacant_units',
    organizationIdField: 'faor_occupancy_rate.faor_organization_id',
    propertyIdField: 'faor_occupancy_rate.faor_property_leni_id',
    propertyNameField: 'faor_occupancy_rate.faor_property_name',
    timeDimensionField: 'faor_occupancy_rate.faor_stats_date',
    defaultTimeRange: 'yesterday',
  },
  total_units_available: {
    key: 'total_units_available',
    description: 'Total rentable unit count across selected properties.',
    measureField: 'faor_occupancy_rate.total_units_available',
    organizationIdField: 'faor_occupancy_rate.faor_organization_id',
    propertyIdField: 'faor_occupancy_rate.faor_property_leni_id',
    propertyNameField: 'faor_occupancy_rate.faor_property_name',
    timeDimensionField: 'faor_occupancy_rate.faor_stats_date',
    defaultTimeRange: 'yesterday',
  },
  aged_receivables_total: {
    key: 'aged_receivables_total',
    description: 'Total outstanding tenant balance (aged receivables) for the current month.',
    measureField: 'faar_tenant_aged_recievables_v2.total_balance',
    organizationIdField: 'faar_tenant_aged_recievables_v2.faar_organization_id',
    propertyIdField: 'dipr_property_v2.dipr_property_leni_id',
    propertyNameField: 'dipr_property_v2.dipr_property_name',
    timeDimensionField: 'faar_tenant_aged_recievables_v2.faar_stats_month',
    defaultTimeRange: 'this month',
    additionalFilters: [
      { member: 'dich_charge_codes_v2.dich_charge_type_group', operator: 'set' },
    ],
  },
  monthly_collection_pct: {
    key: 'monthly_collection_pct',
    description: 'Percentage of expected rent collected this month (Rent Group only).',
    measureField: 'fatt_monthly_collection_trends.total_percent_collected',
    organizationIdField: 'fatt_monthly_collection_trends.fatt_organization_id',
    propertyIdField: 'fatt_monthly_collection_trends.fatt_property_leni_id',
    propertyNameField: 'fatt_monthly_collection_trends.fatt_property_name',
    timeDimensionField: 'fatt_monthly_collection_trends.fatt_stats_month',
    defaultTimeRange: 'this month',
    additionalFilters: [
      { member: 'fatt_monthly_collection_trends.fatt_charge_type_group', operator: 'equals', values: ['Rent Group'] },
    ],
  },
  evictions_count: {
    key: 'evictions_count',
    description: 'Number of tenants currently in eviction status.',
    measureField: 'dite_tenants_v2.count',
    organizationIdField: 'dite_tenants_v2.dite_organization_id',
    propertyIdField: 'dipr_property_v2.dipr_property_leni_id',
    propertyNameField: 'dipr_property_v2.dipr_property_name',
    additionalFilters: [
      { member: 'dite_tenants_v2.dite_status', operator: 'equals', values: ['Eviction'] },
    ],
  },
  renewal_trade_out_dollar_mtd: {
    key: 'renewal_trade_out_dollar_mtd',
    description: 'Month-to-date renewal trade-out in dollars.',
    measureField: 'falto_lease_trade_outs.Renewal_trade_out_dollar',
    organizationIdField: 'falto_lease_trade_outs.falto_organization_id',
    propertyIdField: 'falto_lease_trade_outs.falto_property_leni_id',
    propertyNameField: 'falto_lease_trade_outs.falto_property_name',
    timeDimensionField: 'falto_lease_trade_outs.falto_stats_month',
    defaultTimeRange: 'this month',
  },
  renewal_trade_out_dollar_ytd: {
    key: 'renewal_trade_out_dollar_ytd',
    description: 'Year-to-date renewal trade-out in dollars.',
    measureField: 'falto_lease_trade_outs.Renewal_trade_out_dollar_YD',
    organizationIdField: 'falto_lease_trade_outs.falto_organization_id',
    propertyIdField: 'falto_lease_trade_outs.falto_property_leni_id',
    propertyNameField: 'falto_lease_trade_outs.falto_property_name',
    timeDimensionField: 'falto_lease_trade_outs.falto_stats_month',
    defaultTimeRange: YTD_TIME_RANGE_SENTINEL,
  },
  renewal_trade_out_pct_ytd: {
    key: 'renewal_trade_out_pct_ytd',
    description: 'Year-to-date renewal trade-out as a percentage of prior rent.',
    measureField: 'falto_lease_trade_outs.avg_pct_diff_YTD',
    organizationIdField: 'falto_lease_trade_outs.falto_organization_id',
    propertyIdField: 'falto_lease_trade_outs.falto_property_leni_id',
    propertyNameField: 'falto_lease_trade_outs.falto_property_name',
    timeDimensionField: 'falto_lease_trade_outs.falto_stats_month',
    defaultTimeRange: YTD_TIME_RANGE_SENTINEL,
  },
};

export type KpiKey = keyof typeof KPI_CATALOG;

export const RENT_ROLL = {
  description: 'Tenant-level rent roll: status, property, and balance fields.',
  organizationIdField: 'dite_tenants_v2.dite_organization_id',
  propertyIdField: 'dipr_property_v2.dipr_property_leni_id',
  propertyNameField: 'dipr_property_v2.dipr_property_name',
  statusField: 'dite_tenants_v2.dite_status',
  countMeasure: 'dite_tenants_v2.count',
};

/** UDM property catalog cube — used by MCP `list_properties`. */
export const PROPERTIES = {
  cube: 'dipr_property_v2',
  measureField: 'dipr_property_v2.count',
  organizationIdField: 'dipr_property_v2.dipr_organization_id',
  propertyIdField: 'dipr_property_v2.dipr_property_leni_id',
  propertyNameField: 'dipr_property_v2.dipr_property_name',
  propertyCodeField: 'dipr_property_v2.dipr_property_code',
};
