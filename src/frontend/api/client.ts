export class ApiError extends Error {
  public serverError: string | undefined;

  constructor(
    public status: number,
    public statusText: string,
    message?: string,
    serverError?: string
  ) {
    super(message || serverError || `API Error: ${status} ${statusText}`);
    this.name = "ApiError";
    this.serverError = serverError;
  }
}

export type ApiClientMethods = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
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
      // Try to read the error body for a meaningful message
      let serverError: string | undefined;
      try {
        const ct = response.headers.get("content-type");
        if (ct && ct.includes("application/json")) {
          const errorBody = await response.json() as { error?: string; message?: string };
          serverError = errorBody.error || errorBody.message;
        }
      } catch {
        // Ignore parse failures — fall through to generic message
      }
      throw new ApiError(response.status, response.statusText, undefined, serverError);
    }

    // 204 No Content — return undefined
    if (response.status === 204) {
      return undefined as T;
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
    patch<T>(path: string, body: unknown): Promise<T> {
      return request<T>("PATCH", path, body);
    },
    del<T>(path: string): Promise<T> {
      return request<T>("DELETE", path);
    },
  };
}

export const apiClient = createApiClient();
