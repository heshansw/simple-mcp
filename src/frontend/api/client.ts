export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message?: string
  ) {
    super(message || `API Error: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

export type ApiClientMethods = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
};

function createApiClient(): ApiClientMethods {
  const baseUrl = "/api";

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new ApiError(response.status, response.statusText);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new ApiError(response.status, response.statusText, "Invalid response type");
    }

    return response.json() as Promise<T>;
  }

  return {
    get<T>(path: string): Promise<T> {
      return request<T>("GET", path);
    },
    post<T>(path: string, body: unknown): Promise<T> {
      return request<T>("POST", path, body);
    },
    put<T>(path: string, body: unknown): Promise<T> {
      return request<T>("PUT", path, body);
    },
    del<T>(path: string): Promise<T> {
      return request<T>("DELETE", path);
    },
  };
}

export const apiClient = createApiClient();
