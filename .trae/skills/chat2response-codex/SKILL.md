---
name: "chat2response-codex"
description: "Codex CLI integration guide for chat2response bridge. Invoke when configuring Codex to use chat2response, debugging Codex-specific API errors, or adapting Responses API features for Codex compatibility."
---

# Chat2Response Codex Integration

This skill documents how to integrate [Codex CLI](https://github.com/openai/codex) with the chat2response bridge, including all known compatibility issues and their fixes.

## What is Chat2Response

Chat2Response is an OpenAI **Responses API → Chat Completions API** bridge. It allows using any Chat Completions-compatible provider (DeepSeek, GLM, Kimi, MiniMax, etc.) with tools that speak the Responses API — including Codex CLI.

## Codex Configuration

Add to `~/.codex/config.toml`:

```toml
[model_providers.local]
base_url = "http://localhost:3456/v1"
```

Then run Codex with:
```bash
codex --provider local --model deepseek-v4-flash
```

Or set environment variable:
```bash
export CODEX_PROVIDER=local
export CODEX_MODEL=deepseek-v4-flash
codex
```

## Critical Architecture Notes

### 1. Multimodal Image Handling

**Problem**: Codex sends images with internal `<image>` placeholder text:
```json
{
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "你能看到图片吗" },
        { "type": "input_text", "text": "<image>" },
        { "type": "input_image", "image_url": "data:image/png;base64,..." },
        { "type": "input_text", "text": "</image>" }
      ]
    }
  ]
}
```

The `<image>` and `</image>` text parts are Codex internal placeholders. If sent to the model alongside the real `input_image`, the model sees empty `<image>` tags and cannot access the actual image data.

**Fix** in `converter.ts` `extractTextContent()`:
```typescript
const mapped = content.flatMap(part => {
  if (part.type === 'input_image') {
    return [{ type: 'image_url', image_url: { url: part.image_url || '' } }];
  }
  if (part.type === 'input_text') {
    const text = part.text || '';
    // Skip Codex's internal <image> / </image> placeholders
    if (text.trim() === '<image>' || text.trim() === '</image>') {
      return [];
    }
    return [{ type: 'text', text }];
  }
  return [part];
});
```

**Symptom**: Model responds "I cannot see the image" or "<image> tag is empty".

### 2. Module Loading Order (dotenv)

**Problem**: `providers/index.ts` is imported BEFORE `dotenv.config()` runs in `app.ts`, causing env vars to be undefined when provider config is initialized.

**Fix**: Both `src/providers/index.ts` and `app/server/providers/index.ts` MUST include:
```typescript
import dotenv from 'dotenv';
dotenv.config();
```

**Symptom**: 401 Authentication error even with correct API key, because requests go to default URL instead of configured `BASE_URL`.

### 3. Input Array Missing `type` Field

**Problem**: Codex sends `input` array items WITHOUT `type` field:
```json
{
  "input": [
    { "content": "Hello", "role": "user" }
  ]
}
```

But chat2response only handled `type === 'message'` items, so `messages` became empty array.

**Fix** in `converter.ts`:
```typescript
const itemType = item.type || 'message';
if (itemType === 'message') {
  // ...
}
```

**Symptom**: `field messages is required` (500 error from newapi).

### 4. Tools Schema Missing `required` Field

**Problem**: Codex sends tools with `parameters` that lack `required` field:
```json
{
  "parameters": {
    "type": "object",
    "properties": { ... },
    "additionalProperties": false
  }
}
```

NewAPI validates JSON Schema strictly and rejects `null` for `required`.

**Fix** in `converter.ts` `convertTool()`:
```typescript
const params = tool.function.parameters || { type: 'object', properties: {} };
if (!('required' in params)) {
  (params as any).required = [];
}
```

**Symptom**: `Invalid schema for function 'xxx': null is not of type "array"`.

### 5. Model Name Fallback

**Problem**: If model name doesn't start with provider prefix (e.g., `deepseek`), it gets forced to default.

**Fix** in `providers/index.ts`:
```typescript
if (!transformed.model?.startsWith('deepseek')) {
  transformed.model = 'deepseek-chat';
}
```

**Symptom**: 403 "This token has no access to model deepseek-chat" when using custom model names.

## Debugging Checklist

When Codex fails but direct curl works:

1. **Check request.log** (if file logging is enabled):
   ```bash
   tail -f request.log
   ```

2. **Compare input formats**:
   - ccswitch: `input: "string"` or `input: [{type: "message", ...}]`
   - Codex: `input: [{content: "...", role: "user"}]` (no type field)

3. **Check tools presence**:
   - Codex sends many built-in tools (shell, spawn_agent, etc.)
   - ccswitch may not send tools
   - Tools schema issues only appear with Codex

4. **Verify env vars loaded**:
   ```bash
   curl http://localhost:3456/v1/models
   # Should show configured models, not defaults
   ```

## Known Codex-Specific Behaviors

| Feature | Codex Behavior | Handling |
|---------|---------------|----------|
| `input` format | Array without `type` | Default to `message` |
| `instructions` | Very long system prompt | Pass through as `system` role |
| `tools` | Many built-in tools | Convert all, ensure `required` field |
| `tool_choice` | `"auto"` | Pass through |
| `stream` | `true` | Pass through |
| `store` | `false` | Delete before forwarding |
| `reasoning` | `null` | Pass through |
| Content format | `[{type: "input_text", text: "..."}]` | Extract text content |
| Content format (multimodal) | `[{type: "input_text"}, {type: "input_image", image_url: "..."}]` | Map to Chat Completions `image_url` format |
| Image placeholder | `<image>` / `</image>` text parts | Skip placeholders, only send real `input_image` |
| Developer role | `role: "developer"` | Convert to `system` |

## Testing Commands

```bash
# Test basic chat (no tools)
curl -X POST http://localhost:3456/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","input":"Hello"}'

# Test with tools
curl -X POST http://localhost:3456/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "input": "Hello",
    "tools": [{"type": "function", "name": "test", "parameters": {"type": "object", "properties": {}}}]
  }'

# Test Codex-like input format
curl -X POST http://localhost:3456/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "input": [{"role": "user", "content": "Hello"}]
  }'
```

## Common Errors and Fixes

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `401 Authentication Fails` | dotenv not loaded before provider config | Add `dotenv.config()` to `providers/index.ts` |
| `field messages is required` | `input` items missing `type` field | Default `item.type` to `'message'` |
| `null is not of type "array"` | Tool `parameters` missing `required` | Add `required: []` if absent |
| `no access to model xxx` | Model name forced to default | Check `transformRequest` model fallback logic |
| Kimi cannot see image content | Codex sends `<image>` placeholder text alongside `input_image` | Skip `<image>` / `</image>` text parts when real image exists |

## Files to Check When Debugging

- `src/app.ts` — Request routing, provider detection
- `src/converter.ts` — `convertResponsesToChat()`, `convertTool()`
- `src/providers/index.ts` — Provider config, `transformRequest()`
- `src/types.ts` — Type definitions for `InputItem`, `Tool`, etc.
- `request.log` — Runtime request/response log (if enabled)
