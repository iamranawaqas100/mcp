import CubeApiService from '../integrations/cube-api';

/** Set of fully-qualified Cube measure names from live schema meta(). */
export const fetchCubeMeasureNames = async (): Promise<Set<string>> => {
  const cube = new CubeApiService();
  const meta = await cube.meta();
  const names = new Set<string>();
  for (const c of meta.cubes || []) {
    for (const m of c.measures || []) {
      if (typeof m.name === 'string' && m.name.length > 0) {
        names.add(m.name);
      }
    }
  }
  return names;
};

/** Cube name prefix from a measure field (e.g. faor_occupancy_rate.occupancy_rate → faor_occupancy_rate). */
export const cubeNameFromMeasure = (measureField: string): string => {
  const dot = measureField.indexOf('.');
  return dot > 0 ? measureField.slice(0, dot) : measureField;
};
