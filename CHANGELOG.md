# Changelog

Based on [Keep a Changelog](https://keepachangelog.com).

<!--
Templates:

    ## [Unreleased]

    ### Added

    ### Changed

    ### Fixed

    ### Removed

    ## [X.Y.Z] - 1970-01-01

    ### Added

    ### Changed

    ### Fixed

    ### Removed
-->

## [Unreleased]

## [0.1.0] - 2026-11-09

### Added

- Registers Kitani AI as a model provider in pi, with model discovery on `/model` and refresh on `/reload`
- Uses the [Chat Completions API](https://kitani.ai/docs#chat) — Kitani's only supported API
- Model discovery from `GET /v1/models`: context window, max output tokens, reasoning capability, input modalities, and pricing come straight from Kitani's payload; models without a context window raise an error instead of registering guessed values
- Thinking-level control for reasoning models, mapped to Kitani's `reasoning_effort` (`none` … `max`), with pi's `off` mapped to `none` and `xhigh` to `max`
- Per-model input modalities read from the payload (image input where advertised); models without advertised modalities are text-only
- API compatibility flags verified against Kitani's live Chat Completions API: strict tool schemas are never sent (rejected with HTTP 400), `reasoning_effort` and `max_tokens` are used as documented
- API key resolved by pi per request from the `$KITANI_API_KEY` environment template
- Configuration via `KITANI_API_KEY` and `KITANI_API_BASE_URL` — precedence: config param > environment > default
- `/login kitani` interception with an API-key notice
- README with setup instructions, configuration reference, and troubleshooting guide

[Unreleased]: https://github.com/joeljuca/pi-kitani/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joeljuca/pi-kitani/releases/tag/v0.1.0
