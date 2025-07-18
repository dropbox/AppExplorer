export interface ApiResponse<T = any> {
  data: T;
  status: number;
  message?: string;
}

export interface ApiError {
  message: string;
  code: string;
  status: number;
}

export class ApiService {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /**
   * Fetch data from the API
   */
  async fetchData<T>(endpoint: string): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(url, { headers });
      const data = await response.json();

      return {
        data,
        status: response.status,
        message: response.statusText,
      };
    } catch (error) {
      return Promise.reject({
        message: error instanceof Error ? error.message : "Unknown error",
        code: "FETCH_ERROR",
        status: 0,
      } as ApiError);
    }
  }

  /**
   * Post data to the API
   */
  async postData<T>(endpoint: string, payload: any): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      return {
        data,
        status: response.status,
        message: response.statusText,
      };
    } catch (error) {
      return Promise.reject({
        message: error instanceof Error ? error.message : "Unknown error",
        code: "POST_ERROR",
        status: 0,
      } as ApiError);
    }
  }

  /**
   * Set API key for authentication
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}
