import cubejs, { CubeApi } from '@cubejs-client/core';
import logger from '../utils/logger';

/**
 * Cube API Service
 */
export default class CubeApiService {
  private cubeApi: CubeApi;

  constructor() {
    const token = process.env.CUBE_API_TOKEN;
    const apiUrl = process.env.CUBE_API_BASE_ENDPOINT;
    if (!token || !apiUrl) {
      throw new Error('Cube API misconfigured: CUBE_API_TOKEN and CUBE_API_BASE_ENDPOINT are required');
    }
    this.cubeApi = cubejs(token, {
      apiUrl,
    });
  }

  public async meta(): Promise<any> {
    return this.cubeApi.meta();
  }

  /**
   * connectToCube
   * @param data { body: Cube query, endpoint?: string (optional override) }
   */
  public async connectToCube(data: { body: any; endpoint?: string }) {
    try {
      const resultSet = await this.cubeApi.load(data.body);

      return {
        status: 200,
        statusText: 'Success',
        data: resultSet.rawData(), // or chartPivot() depending on need
      };
    } catch (error) {
      logger.error('Cube API error', error);

      return {
        status: 500,
        statusText: 'Cube API Error',
        error,
      };
    }
  }
}
