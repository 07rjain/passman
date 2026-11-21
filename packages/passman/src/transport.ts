import { setTimeout as delay } from "node:timers/promises";
import {
  API_PATH,
  canonicalOrigin,
  errorCodes,
  failure,
  PassmanError,
  type ErrorCode,
  z,
} from "@passman/protocol";

const maximumResponseSize = 2_000_000;
const knownError = z.object({ code: z.enum(errorCodes) });

export type TransportOptions = {
  origin: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
};
type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
};

export function parseResponse<Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): Output {
  const result = schema.safeParse(input);
  if (!result.success) return failure("INTEGRITY_FAILED");
  return result.data;
}

async function readJson(response: Response): Promise<unknown> {
  if (
    !response.body ||
    Number(response.headers.get("content-length")) > maximumResponseSize
  ) {
    return failure("INTEGRITY_FAILED");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseSize) return failure("INTEGRITY_FAILED");
      output += decoder.decode(value, { stream: true });
    }
    return JSON.parse(output + decoder.decode()) as unknown;
  } catch {
    return failure("INTEGRITY_FAILED");
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function statusError(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "INVALID_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return "UNAVAILABLE";
  }
}

function responseError(body: unknown, status: number): ErrorCode {
  const parsed = knownError.safeParse(body);
  const nested = z.object({ error: knownError }).safeParse(body);
  const code = parsed.success
    ? parsed.data.code
    : nested.success
      ? nested.data.error.code
      : statusError(status);
  if (
    status === 401 &&
    !["UNAUTHORIZED", "CREDENTIAL_EXPIRED", "CREDENTIAL_REVOKED"].includes(code)
  )
    return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (code === "NOT_FOUND" && status !== 404) return statusError(status);
  return code;
}

export function transport(options: TransportOptions, credential: string) {
  const origin = canonicalOrigin(options.origin);
  const fetchResponse = options.fetch ?? globalThis.fetch;
  async function request(
    path: string,
    { method = "GET", body, headers }: RequestOptions,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(15_000);
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout;
    try {
      const response = await fetchResponse(`${origin}${API_PATH}${path}`, {
        method,
        headers: {
          ...headers,
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
        redirect: "error",
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        const errorBody = await readJson(response).catch(() => undefined);
        return failure(responseError(errorBody, response.status));
      }
      return response.status === 204 ? undefined : await readJson(response);
    } catch (error) {
      if (error instanceof PassmanError) throw error;
      return failure("UNAVAILABLE");
    }
  }

  return async (
    path: string,
    parameters: RequestOptions = {},
  ): Promise<unknown> => {
    try {
      return await request(path, parameters);
    } catch (error) {
      if (
        (parameters.method ?? "GET") !== "GET" ||
        !(error instanceof PassmanError) ||
        error.code !== "UNAVAILABLE" ||
        options.signal?.aborted
      )
        throw error;
      await delay(150, undefined, { signal: options.signal }).catch(() =>
        failure("UNAVAILABLE"),
      );
      return request(path, parameters);
    }
  };
}
