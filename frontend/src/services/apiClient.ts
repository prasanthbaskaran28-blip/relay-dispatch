import axios, { AxiosError } from "axios";
import type { ApiErrorResponse } from "../types/api";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
  timeout: 15_000,
});

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("relay-dispatcher-token");
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      typeof window !== "undefined" &&
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      sessionStorage.getItem("relay-dispatcher-token")
    ) {
      window.dispatchEvent(new Event("relay:dispatcher-unauthorized"));
    }
    return Promise.reject(error);
  },
);

export class ApiRequestError extends Error {
  code: string;
  status?: number;
  details: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    code = "API_ERROR",
    status?: number,
    details: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function getApiError(error: unknown): ApiRequestError {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    const axiosError = error as AxiosError<ApiErrorResponse>;
    const body = axiosError.response?.data?.error;
    return new ApiRequestError(
      body?.message ?? axiosError.message ?? "The request could not be completed.",
      body?.code ?? "API_ERROR",
      axiosError.response?.status,
      body?.details ?? [],
    );
  }
  if (error instanceof Error) return new ApiRequestError(error.message);
  return new ApiRequestError("An unexpected error occurred.");
}

export default apiClient;
