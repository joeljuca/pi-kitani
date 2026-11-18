import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKitaniExtension, DEFAULT_CONFIG } from "./index.js";

function mockFetch() {
  const fn = vi.fn();
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockPi() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerProvider: vi.fn(),
    _handler(event: string) {
      return handlers.get(event);
    },
  };
}

function mockCtx() {
  return { ui: { notify: vi.fn() } };
}

const ENV_VARS = ["KITANI_API_BASE_URL", "KITANI_API_KEY"] as const;

const ENV_BACKUP: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_VARS) {
    ENV_BACKUP[name] = process.env[name];
    // Start every test from a clean slate
    delete process.env[name];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    const value = ENV_BACKUP[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("createKitaniExtension", () => {
  it("returns a function", () => {
    expect(createKitaniExtension()).toBeInstanceOf(Function);
  });

  describe("config precedence: config param > env var > default", () => {
    it("uses defaults when nothing is provided", () => {
      const pi = mockPi();
      createKitaniExtension()(pi as never);

      expect(pi.registerProvider).toHaveBeenCalledWith(
        "kitani",
        expect.objectContaining({
          baseUrl: DEFAULT_CONFIG.apiBaseUrl,
          apiKey: "$KITANI_API_KEY",
          authHeader: true,
          api: "openai-completions",
        }),
      );
    });

    it("registers $KITANI_API_KEY so pi resolves the key at request time", () => {
      // Even with the env var set, pi receives the template and resolves it
      // per request — the factory never captures a key value.
      process.env.KITANI_API_KEY = "abc123def456abc123def456abc123def456";
      const pi = mockPi();
      createKitaniExtension()(pi as never);

      expect(pi.registerProvider).toHaveBeenCalledWith(
        "kitani",
        expect.objectContaining({
          apiKey: "$KITANI_API_KEY",
        }),
      );
    });

    it("reads KITANI_API_BASE_URL env var", () => {
      process.env.KITANI_API_BASE_URL = "https://selfhosted.example.com/v1";
      const pi = mockPi();
      createKitaniExtension()(pi as never);

      expect(pi.registerProvider).toHaveBeenCalledWith(
        "kitani",
        expect.objectContaining({
          baseUrl: "https://selfhosted.example.com/v1",
        }),
      );
    });

    it("config param overrides KITANI_API_BASE_URL env var", () => {
      process.env.KITANI_API_BASE_URL = "https://env.example.com/v1";
      const pi = mockPi();
      createKitaniExtension({ apiBaseUrl: "https://config.example.com/v1" })(pi as never);

      expect(pi.registerProvider).toHaveBeenCalledWith(
        "kitani",
        expect.objectContaining({
          baseUrl: "https://config.example.com/v1",
        }),
      );
    });
  });
});

describe("extension function", () => {
  it("registers the provider with name 'kitani'", () => {
    const pi = mockPi();
    createKitaniExtension()(pi as never);

    expect(pi.registerProvider).toHaveBeenCalledWith("kitani", expect.any(Object));
  });

  it("registers an input listener", () => {
    const pi = mockPi();
    createKitaniExtension()(pi as never);

    expect(pi.on).toHaveBeenCalledWith("input", expect.any(Function));
  });

  describe("/login kitani interception", () => {
    it("returns { action: 'handled' } and shows a notification", async () => {
      const pi = mockPi();
      createKitaniExtension()(pi as never);

      const handler = pi._handler("input");
      const ctx = mockCtx();
      const result = await handler!({ text: "/login kitani" }, ctx);

      expect(result).toEqual({ action: "handled" });
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("API key"), "info");
    });

    it("returns { action: 'continue' } for other inputs", async () => {
      const pi = mockPi();
      createKitaniExtension()(pi as never);

      const handler = pi._handler("input");
      const ctx = mockCtx();
      const result = await handler!({ text: "/model" }, ctx);

      expect(result).toEqual({ action: "continue" });
      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });
  });
});

describe("refreshModels", () => {
  let fetch: ReturnType<typeof mockFetch>;
  let pi: ReturnType<typeof mockPi>;
  let provider: Record<string, unknown>;

  beforeEach(() => {
    fetch = mockFetch();
    pi = mockPi();
    createKitaniExtension()(pi as never);
    provider = pi.registerProvider.mock.calls[0][1];
  });

  it("fetches from {baseUrl}/models", async () => {
    fetch.mockResolvedValue(mockResponse({ data: [] }));

    await provider.refreshModels({ signal: new AbortController().signal });

    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_CONFIG.apiBaseUrl}/models`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("sends the Authorization header", async () => {
    process.env.KITANI_API_KEY = "my_test_key";
    fetch.mockResolvedValue(mockResponse({ data: [] }));

    await provider.refreshModels({ signal: new AbortController().signal });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my_test_key",
        }),
      }),
    );
  });

  it("prefers a stored credential over the env var", async () => {
    process.env.KITANI_API_KEY = "env_key";
    fetch.mockResolvedValue(mockResponse({ data: [] }));

    await provider.refreshModels({
      signal: new AbortController().signal,
      credential: { type: "api_key", key: "stored_key" },
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer stored_key",
        }),
      }),
    );
  });

  it("passes the abort signal", async () => {
    const signal = new AbortController().signal;
    fetch.mockResolvedValue(mockResponse({ data: [] }));

    await provider.refreshModels({ signal });

    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }));
  });

  it("maps models from the response", async () => {
    // Shape verified against GET https://api.kitani.ai/v1/models
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "z-ai/glm-5.3",
            object: "model",
            owned_by: "kitani",
            display_name: "GLM 5.3",
            capabilities: ["chat", "coding", "tool use", "reasoning"],
            modalities: ["text"],
            context_length: 1_048_576,
            available: true,
            suggested_input_price_per_million: 1.3,
            suggested_output_price_per_million: 4.25,
            providers: [
              {
                id: "kitani-dedicated",
                cache_pricing: { read_per_million: 0.13 },
              },
            ],
            contract: {
              max_output_tokens: 1_048_576,
              capabilities: ["chat", "coding", "tool use", "reasoning"],
            },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models).toEqual([
      {
        id: "z-ai/glm-5.3",
        name: "GLM 5.3",
        reasoning: true,
        thinkingLevelMap: { off: "none", xhigh: "max" },
        cost: { input: 1.3, output: 4.25, cacheRead: 0.13, cacheWrite: 0 },
        contextWindow: 1_048_576,
        maxTokens: 1_048_576,
        input: ["text"],
        compat: {
          supportsStore: false,
          supportsLongCacheRetention: false,
          supportsStrictMode: false,
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          supportsFinishReason: true,
          supportsDeveloperRole: true,
          maxTokensField: "max_tokens",
        },
      },
    ]);
  });

  it("falls back to the context window when contract.max_output_tokens is null", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "example/model",
            context_length: 32_768,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: null },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0]).toMatchObject({
      contextWindow: 32_768,
      maxTokens: 32_768,
    });
  });

  it("throws instead of guessing when a model lacks a context window", async () => {
    // No silent fallback: a payload shape change must fail loudly.
    fetch.mockResolvedValue(
      mockResponse({
        data: [{ id: "mystery-model", object: "model", available: true, capabilities: ["chat"] }],
      }),
    );

    await expect(provider.refreshModels({ signal: new AbortController().signal })).rejects.toThrow(
      /mystery-model.*missing metadata/,
    );
  });

  it("skips models that are not available", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "unavailable/model",
            context_length: 131_072,
            available: false,
            capabilities: ["chat"],
            contract: { max_output_tokens: 131_072 },
          },
          {
            id: "available/model",
            context_length: 8_192,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: 4_096 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models.map((m) => m.id)).toEqual(["available/model"]);
  });

  it("skips non-chat models (e.g. image generation)", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "kitani/morgana-v1.2",
            context_length: null,
            available: true,
            capabilities: ["image_generation"],
            modalities: ["image"],
          },
          {
            id: "chat/model",
            context_length: 8_192,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: 4_096 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models.map((m) => m.id)).toEqual(["chat/model"]);
  });

  it("reads input modalities from the payload", async () => {
    // The /v1/models payload advertises modalities per model; that is the
    // source of truth.
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "vision/model",
            context_length: 131_072,
            available: true,
            capabilities: ["chat", "vision"],
            modalities: ["text", "image"],
            contract: { max_output_tokens: 131_072 },
          },
          {
            id: "text/model",
            context_length: 8_192,
            available: true,
            capabilities: ["chat"],
            modalities: ["text"],
            contract: { max_output_tokens: 4_096 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0].input).toEqual(["text", "image"]);
    expect(models[1].input).toEqual(["text"]);
  });

  it("defaults models without modalities to text-only input", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "future/model",
            context_length: 200_000,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: 32_768 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0].input).toEqual(["text"]);
  });

  it("marks models with the reasoning capability as reasoning with a thinking level map", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "deepseek/deepseek-v4.1-flash-1017-thinking",
            context_length: 1_048_576,
            available: true,
            capabilities: ["chat", "reasoning"],
            contract: { max_output_tokens: 1_048_576 },
          },
          {
            id: "mistralai/ministral-3b-2512",
            context_length: 8_192,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: 4_096 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0]).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { off: "none", xhigh: "max" },
    });
    // Non-reasoning models must not carry a level map.
    expect(models[1]).not.toHaveProperty("thinkingLevelMap");
    expect(models[1].reasoning).toBe(false);
  });

  it("uses display_name when available", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "google/gemma-4-31b-it",
            display_name: "Gemma 4 31B",
            context_length: 8_192,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: 4_096 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0].name).toBe("Gemma 4 31B");
  });

  it("uses the model id as the name when display_name is absent", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "anonymous/model",
            context_length: 8_192,
            available: true,
            capabilities: ["chat"],
            contract: { max_output_tokens: 4_096 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0].name).toBe("anonymous/model");
  });

  it("uses the lowest advertised provider cache-read price", async () => {
    fetch.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: "cached/model",
            context_length: 131_072,
            available: true,
            capabilities: ["chat"],
            suggested_input_price_per_million: 0.01,
            suggested_output_price_per_million: 0.03,
            providers: [
              { cache_pricing: { read_per_million: 0.05 } },
              { cache_pricing: { read_per_million: 0.005 } },
              { cache_pricing: { read_per_million: null } },
            ],
            contract: { max_output_tokens: 131_072 },
          },
        ],
      }),
    );

    const models = await provider.refreshModels({ signal: new AbortController().signal });

    expect(models[0].cost).toEqual({ input: 0.01, output: 0.03, cacheRead: 0.005, cacheWrite: 0 });
  });

  it("throws on non-ok response", async () => {
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "A valid Bearer key is required.",
            type: "authentication_error",
            code: "invalid_key",
          },
        }),
        {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(provider.refreshModels({ signal: new AbortController().signal })).rejects.toThrow(
      /Failed to fetch Kitani AI models/,
    );
  });

  it("throws when response body lacks data array", async () => {
    fetch.mockResolvedValue(mockResponse({ error: "not found" }));

    await expect(provider.refreshModels({ signal: new AbortController().signal })).rejects.toThrow(
      /Invalid response format/,
    );
  });
});
