# pi-kitani

[![GitHub Actions](https://github.com/joeljuca/pi-kitani/actions/workflows/checks.yml/badge.svg)](https://github.com/joeljuca/pi-kitani/actions/workflows/checks.yml)
[![npm version](https://img.shields.io/npm/v/pi-kitani.svg?color=red&logo=npm)](https://www.npmjs.com/package/pi-kitani)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?logo=apache)](LICENSE)
[![GitHub](https://img.shields.io/badge/joeljuca/pi--kitani-white?logo=github&logoColor=black)](https://github.com/joeljuca/pi-kitani)
[![Codeberg](https://img.shields.io/badge/joeljuca/pi--kitani-blue?logo=codeberg&logoColor=white)](https://codeberg.org/joeljuca/pi-kitani)
[![Author](https://img.shields.io/badge/joeljuca.com-white?logo=google-chrome)](https://joeljuca.com)

[pi](https://pi.dev) extension for [Kitani AI](https://kitani.ai).

## Set up

With pi installed and ready to use, run:

```
pi install npm:pi-kitani
```

Get an API key in the [Kitani dashboard](https://kitani.ai/dashboard/api-keys), set the environment variable `KITANI_API_KEY` with your key, and you should be ready to go.

```sh
export KITANI_API_KEY='<Your API key here>'
```

You're ready. Run pi normally; the extension loads automatically:

```
pi
```

## Use

Usage is mostly automatic. The extension will make your pi integrate seamlessly with Kitani AI, so you should be able to see their models when you `/model`, the list will be reloaded when you `/reload`, etc.

Here's what the extension will do:

1. It registers `kitani` as a model provider in pi
1. Fetches a fresh list of available models from Kitani AI when you open pi
1. Refresh the list of models when you `/model` or `/reload`
1. **API fetch**: The callback fetches models from the Kitani AI `/v1/models` endpoint

### Configuration

The extension uses the [Chat Completions API](https://kitani.ai/docs#chat) —
Kitani's only supported API. The base URL can be overridden:

| Env var               | Default                    | Description                                                                    |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `KITANI_API_BASE_URL` | `https://api.kitani.ai/v1` | API base URL                                                                   |
| `KITANI_API_KEY`      | —                          | Your API key from the [Kitani dashboard](https://kitani.ai/dashboard/api-keys) |

Or set it from your extension module:

```typescript
import { createKitaniExtension } from "pi-kitani";

// Use a custom base URL
export default createKitaniExtension({ apiBaseUrl: "https://example.com/v1" });
```

Precedence: config param > environment variable > default.

> 💡 Troubleshoot
>
> If something is not working properly, you're not seeing Kitani AI's models when you `/model`, etc., the first place to check is your API key:
>
> ```sh
> echo $KITANI_API_KEY
> ```
>
> Test it against the API:
>
> ```bash
> curl https://api.kitani.ai/v1/models -H "Authorization: Bearer $KITANI_API_KEY"
> ```
>
> Reload pi (while in pi, run `/reload`). Check pi's console output for error messages, you'll most certainly find insights on what's wrong.
>
> If nothing works and you believe it's a bug in the extension itself, open an issue at [https://github.com/joeljuca/pi-kitani/issues](https://github.com/joeljuca/pi-kitani/issues).

## Contribute

See: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[Apache-2.0](LICENSE) © [Joel Jucá](https://joeljuca.com)
