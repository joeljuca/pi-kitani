/**
 * pi extension for Kitani AI
 *
 * @packageDocumentation
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Debug from "debug";

const debug = Debug("pi-kitani");

interface KitaniConfig {
  apiBaseUrl?: string;
}

export const DEFAULT_CONFIG: Required<KitaniConfig> = {
  apiBaseUrl: "https://api.kitani.ai/v1",
};

interface KitaniProvider {
  id: string;
  name?: string;
  cache_pricing?: {
    read_per_million?: number | null;
  };

  // additional fields
  [key: string]: unknown;
}

interface KitaniModel {
  id: string;
  display_name?: string;
  capabilities?: string[];
  modalities?: string[];
  context_length?: number | null;
  available?: boolean;
  suggested_input_price_per_million?: number | null;
  suggested_output_price_per_million?: number | null;
  providers?: KitaniProvider[];
  contract?: {
    max_output_tokens?: number | null;
  };

  // additional fields
  [key: string]: unknown;
}

interface ModelsResponse {
  data: KitaniModel[];
}

/** pi env-interpolation template resolved by pi at request time. */
const API_KEY_TEMPLATE = "$KITANI_API_KEY";

/**
 * pi thinking levels -> Kitani `reasoning_effort` values.
 *
 * Kitani accepts: none, low, medium, high, max (any other value is HTTP 422).
 * pi levels pass through unchanged except "off" -> "none" and "xhigh" -> "max"
 * (Kitani has no xhigh level; max is the closest).
 *
 * Verified against the live API: any other value is rejected with HTTP 422
 * ("reasoning_effort must be one of none, low, medium, high, or max"), and
 * thinking text arrives in `reasoning_content`.
 *
 * Per-model caveats (https://kitani.ai/docs/reasoning): some reasoning models
 * reject "none" (they always think, e.g. GLM 5.3) and non-thinking model IDs
 * ignore the field entirely. GET /v1/models only advertises the `reasoning`
 * capability, not per-model level support, so this map is best-effort.
 *
 * Do NOT "simplify" this map (e.g. dropping the xhigh entry): pi passes
 * unmapped levels through unchanged, and Kitani rejects `xhigh` with HTTP 422.
 * Verified against the live API — treat as settled.
 */
const THINKING_LEVEL_MAP = {
  off: "none",
  xhigh: "max",
};

/**
 * Compatibility flags for Kitani's Chat Completions API, verified against the
 * live API (https://api.kitani.ai/v1/chat/completions):
 *
 * - supportsStore: false — Kitani accepts and ignores `store` (HTTP 200);
 *   it is not documented, so we don't send it.
 * - supportsLongCacheRetention: false — Kitani accepts and ignores
 *   `prompt_cache_retention` (HTTP 200); prompt caching is automatic prefix
 *   caching (reads reported in usage.prompt_tokens_details.cached_tokens), so
 *   there is no client-side retention parameter to use.
 * - supportsStrictMode: false — REQUIRED: Kitani rejects `strict: true` tool
 *   schemas with HTTP 400 ("Invalid JSON"). Do NOT flip this to true
 *   (e.g. to "match OpenAI"): it breaks every tool-calling request.
 *   Verified against the live API — treat as settled.
 * - supportsReasoningEffort: true — verified: `reasoning_effort` on Chat
 *   Completions, values none/low/medium/high/max; thinking arrives in
 *   `reasoning_content`.
 * - supportsUsageInStreaming: true — verified: set
 *   stream_options.include_usage to receive the final usage chunk.
 * - supportsFinishReason: true — verified: `finish_reason` in stream chunks.
 * - supportsDeveloperRole: true — verified: the `developer` role is accepted
 *   and honored.
 * - maxTokensField: "max_tokens" — the field used in Kitani's docs. (Kitani
 *   also accepts max_completion_tokens, HTTP 200, so either works.)
 */
const KITANI_COMPAT = {
  supportsStore: false,
  supportsLongCacheRetention: false,
  supportsStrictMode: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  supportsFinishReason: true,
  supportsDeveloperRole: true,
  maxTokensField: "max_tokens" as const,
};

type InputModality = "text" | "image";

/** Safe default for models advertising no modalities — text always works. */
const TEXT_ONLY_INPUT: InputModality[] = ["text"];

/**
 * Kitani's catalog mixes chat models with non-chat ones (e.g. the Morgana
 * image-generation model) and lists models that currently have no active
 * deployment. Only register models that can do chat and are available.
 */
function isRegisterable(model: KitaniModel): boolean {
  return model.available !== false && model.capabilities?.includes("chat") === true;
}

/** Lowest advertised cache-read price across the model's providers, if any. */
function cacheReadCost(model: KitaniModel): number {
  const prices = (model.providers ?? [])
    .map((provider) => provider.cache_pricing?.read_per_million)
    .filter((price): price is number => typeof price === "number" && price > 0);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

/**
 * Creates the provider extension
 *
 * @param config - Optional configuration overrides
 * @returns Extension factory function for pi
 *
 * Kitani only supports the Chat Completions API; there is no format choice.
 *
 * Configuration precedence: config param > environment variable > default.
 * Environment variables: KITANI_API_KEY, KITANI_API_BASE_URL.
 *
 * @example
 * ```typescript
 * import { createKitaniExtension } from "pi-kitani";
 *
 * export default createKitaniExtension();
 *
 * // Use a custom base URL
 * export default createKitaniExtension({ apiBaseUrl: "https://example.com/v1" });
 * ```
 */
export function createKitaniExtension(config?: KitaniConfig) {
  // Do NOT merge defaults into `config` first — that would make every field
  // "defined" and hide the env fallback below.
  const apiBaseUrl =
    config?.apiBaseUrl ?? process.env.KITANI_API_BASE_URL ?? DEFAULT_CONFIG.apiBaseUrl;
  const apiKey = API_KEY_TEMPLATE;

  debug("config: apiBaseUrl=%s", apiBaseUrl);

  return function kitaniExtension(pi: ExtensionAPI): void {
    pi.on("input", async (event, ctx) => {
      if (event.text === "/login kitani") {
        debug("`/login kitani` intercepted, showing API key notice");
        ctx.ui.notify(
          "Authentication is API key-only. Set KITANI_API_KEY environment variable.",
          "info",
        );
        return { action: "handled" };
      }
      return { action: "continue" };
    });

    pi.registerProvider("kitani", {
      name: "Kitani AI",
      api: "openai-completions",
      baseUrl: apiBaseUrl,
      authHeader: true,
      apiKey: apiKey,

      async refreshModels(context: {
        signal: AbortSignal;
        credential?: { type: string; key?: string };
      }) {
        const { signal, credential } = context;
        const modelsUrl = `${apiBaseUrl}/models`;
        debug("fetching models from %s", modelsUrl);

        // Prefer pi's stored credential; fall back to the env var at call time
        // (never capture it at factory time — the key may be set later).
        const key =
          (credential?.type === "api_key" ? credential.key : undefined) ??
          process.env.KITANI_API_KEY ??
          "";

        const response = await fetch(modelsUrl, {
          signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${key}`,
          },
        });

        debug("response status: %d", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          debug("error: %s", errorText);
          throw new Error(
            `Failed to fetch Kitani AI models: ${response.status} ${response.statusText}\n${errorText}`,
          );
        }

        const payload = (await response.json()) as ModelsResponse;

        if (!Array.isArray(payload.data)) {
          debug("invalid payload: %o", payload);
          throw new Error("Invalid response format: expected 'data' to be an array");
        }

        debug("received %d models", payload.data.length);

        return payload.data.filter(isRegisterable).map((model) => {
          // Strictly Kitani's own metadata — no invented defaults. pi requires
          // a context window, so a payload change must fail loudly, not
          // silently register a model with a wrong context window.
          const contextWindow = model.context_length;
          if (contextWindow === null || contextWindow === undefined) {
            debug("missing context window for model %s: %o", model.id, model);
            throw new Error(
              `Kitani model "${model.id}" is missing metadata: ` +
                `context_length=${contextWindow ?? "absent"}. ` +
                `The /v1/models payload shape may have changed.`,
            );
          }

          // contract.max_output_tokens is nullable; the context window is the
          // only defensible upper bound when it is absent.
          const maxTokens = model.contract?.max_output_tokens ?? contextWindow;

          const reasoning = model.capabilities?.includes("reasoning") ?? false;

          const input = (model.modalities ?? []).filter(
            (modality): modality is InputModality => modality === "text" || modality === "image",
          );
          if (input.length === 0) {
            debug("model %s advertises no modalities; defaulting to text-only input", model.id);
          }

          return {
            id: model.id,
            name: model.display_name ?? model.id,
            reasoning,
            ...(reasoning ? { thinkingLevelMap: THINKING_LEVEL_MAP } : {}),
            input: input.length > 0 ? input : TEXT_ONLY_INPUT,
            // Costs come from Kitani's suggested per-million-token prices.
            // Kitani estimates usage from request messages and delivered
            // output (not exact model-tokenizer counts), so these are
            // estimates, not exact rates. cacheRead is the lowest advertised
            // per-provider cache-read price; Kitani does not charge for
            // cache writes.
            cost: {
              input: model.suggested_input_price_per_million ?? 0,
              output: model.suggested_output_price_per_million ?? 0,
              cacheRead: cacheReadCost(model),
              cacheWrite: 0,
            },
            contextWindow,
            maxTokens,
            compat: KITANI_COMPAT,
          };
        });
      },
    });
  };
}

export default createKitaniExtension();
