---
name: "chat2response-provider-sync"
description: "Sync provider changes across src/ and app/ directories in the chat2response project. Invoke when adding, updating, or deleting a provider, or modifying provider config (baseUrl, models, supportsTools, etc.)."
---

# Chat2Response Provider Sync

This skill ensures provider-related changes are consistently applied across all code locations in the chat2response project.

## Project Structure

The chat2response project has **two independent server entry points**, each with their own `dotenv.config()` call and provider module loading:

### 1. Node.js CLI server (`src/`)
```
src/app.ts              → imports src/providers/index.ts
src/providers/index.ts  → has its own `dotenv.config()`
```

### 2. Electron embedded server (`app/`)
```
app/main.js                    → Electron main process
app/server-dist/server-wrapper.js  → Electron server entry (require('./providers'))
app/server-dist/providers/index.js → Compiled from app/server/providers/index.ts
app/server-dist/app.js         → Alternative entry (require('./providers'))
app/server/providers/index.ts  → Source copy (MUST stay in sync with src/)
```

**Critical:** `app/server-dist/server-wrapper.js` does NOT call `dotenv.config()`. It relies on the environment being set up before it loads. The `app/server-dist/app.js` entry point does call `dotenv.config()` at line 11.

## Trigger Conditions

Invoke this skill when:
- Adding a new provider (e.g., `qwen`, `baichuan`)
- Updating existing provider config (`baseUrl`, `defaultModel`, `models`, `supportsTools`, `supportsStreaming`)
- Modifying `getEnvConfig` or environment variable prefixes
- Changing provider `transformRequest` logic
- Removing a provider
- **Modifying `src/types.ts` or `src/converter.ts`** — these affect the API contract and message conversion

## Sync Checklist

### Step 1: Update `src/providers/index.ts`
- Add/modify the provider entry in `PROVIDERS` record
- Ensure `getEnvConfig(prefix, defaults)` is used for configurable fields
- Prefix format: `{PROVIDER_NAME}_BASE_URL`, `{PROVIDER_NAME}_DEFAULT_MODEL`, etc.
- Keep `transformRequest` logic consistent
- **Must include:** `import dotenv from 'dotenv'; dotenv.config();` at the top of the file
- **CRITICAL:** In `transformRequest`, never hardcode fallback values that should be configurable. Always use `process.env['{PREFIX}_DEFAULT_MODEL']` or `process.env['{PREFIX}_BASE_URL']` instead of hardcoded strings. Example:
  ```typescript
  // ❌ BAD: Hardcoded fallback
  transformed.model = 'kimi-coding';
  // ✅ GOOD: Respects env config
  transformed.model = process.env['KIMI_DEFAULT_MODEL'] || 'kimi-coding';
  ```

### Step 2: Mirror changes to `app/server/providers/index.ts`
- This is a **manual copy** of `src/providers/index.ts`
- Must stay byte-for-byte identical (except import paths which are already `../types`)
- **Do NOT skip this step** — Electron app will use stale code otherwise
- **Must include:** `import dotenv from 'dotenv'; dotenv.config();` at the top of the file

### Step 3: Sync `src/types.ts` → `app/server/types.ts`
- If `ChatMessage`, `InputItem`, `OutputItem`, or any shared type changed, mirror to `app/server/types.ts`
- Common additions: `reasoning_content`, new `type` variants, new optional fields

### Step 4: Sync `src/converter.ts` → `app/server/converter.ts`
- If message conversion logic changed (e.g., handling new `InputItem` types like `reasoning`), mirror to `app/server/converter.ts`
- Ensure `convertResponsesToChat` and stream conversion functions stay in sync

### Step 5: Recompile `app/server-dist/`
```bash
cd app && npx tsc
```
- `app/tsconfig.json` has `outDir: "./server-dist"` and `rootDir: "./server"`
- Verify `app/server-dist/providers/index.js` reflects the new `getEnvConfig` calls
- Verify the compiled output includes `dotenv` import and `dotenv.config()` call
- Verify `app/server-dist/converter.js` includes new conversion logic

### Step 6: Verify `app/server-dist/server-wrapper.js`
- This file is **copied as-is** during build (`cp server/server-wrapper.js server-dist/`)
- It does NOT call `dotenv.config()` — environment must be loaded by the caller
- If provider config relies on env vars, ensure the Electron main process sets them before starting the server

### Step 7: Update `.env.example`
- Add new environment variables for the provider:
  - `{PREFIX}_BASE_URL`
  - `{PREFIX}_DEFAULT_MODEL`
  - `{PREFIX}_MODELS`
  - `{PREFIX}_SUPPORTS_TOOLS`
  - `{PREFIX}_SUPPORTS_STREAMING`
- Keep commented by default to show optional configuration

### Step 8: Update documentation
- `README.md`: Provider environment variable config section
- `docs/providers.md`: Environment variable reference section
- Add the new provider to the defaults table

## Common Pitfalls

| Pitfall | Why it happens | Prevention |
|---------|---------------|------------|
| Only changed `src/` but not `app/server/` | Forgetting Electron has its own copy | Always run the sync checklist |
| `app/server-dist/` still has old code | Skipped `npx tsc` step | Compile immediately after copying |
| Environment variable prefix mismatch | Inconsistent naming | Use uppercase provider name as prefix |
| `transformRequest` diverges between copies | Manual copy errors | Copy-paste entire file, then diff |
| `dotenv.config()` missing in provider file | Forgot to include import | Both `src/` and `app/server/` copies must have it |
| Electron env vars not loaded | `server-wrapper.js` doesn't call `dotenv.config()` | Ensure main process loads env before starting server |
| **Hardcoded fallback values in `transformRequest`** | Developer assumed default model/baseUrl never changes | Always read from `process.env['{PREFIX}_DEFAULT_MODEL']` or `process.env['{PREFIX}_BASE_URL']` |
| **`types.ts` or `converter.ts` changes not synced** | Only thinking about provider config, not message format | Add Steps 3 and 4 to checklist for ANY type/converter change |
| **Missing `reasoning_content` in `ChatMessage`** | New reasoning feature not propagated to all type copies | Mirror `src/types.ts` changes to `app/server/types.ts` immediately |

## Quick Verification

After making provider changes, run:

```bash
# 1. Diff the provider TS sources
diff src/providers/index.ts app/server/providers/index.ts
# Should show no meaningful differences (only if any)

# 2. Diff types and converter
diff src/types.ts app/server/types.ts
diff src/converter.ts app/server/converter.ts
# Should show no meaningful differences

# 3. Check dotenv is present in both
grep -n "dotenv" src/providers/index.ts app/server/providers/index.ts
# Both should show: import + dotenv.config()

# 4. Compile and check output
cd app && npx tsc
grep -A5 "getEnvConfig" server-dist/providers/index.js
# Should show the new prefix and defaults

# 5. Verify dotenv in compiled output
grep -n "dotenv" server-dist/providers/index.js
# Should show require("dotenv") and .config() call

# 6. Verify converter changes in compiled output
grep -n "reasoning" server-dist/converter.js
# Should show reasoning_content handling if applicable
```

## Example: Adding a new provider "qwen"

```typescript
// In BOTH src/providers/index.ts AND app/server/providers/index.ts
import type { ProviderConfig, ProviderName, ChatCompletionRequest } from '../types';
import dotenv from 'dotenv';

dotenv.config();

// ... getEnvConfig function ...

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  // ... existing providers ...

  qwen: {
    name: 'Qwen',
    ...getEnvConfig('QWEN', {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      defaultModel: 'qwen-max',
      models: ['qwen-max', 'qwen-plus'],
      supportsTools: true,
      supportsStreaming: true,
    }),
    transformRequest: (req: ChatCompletionRequest): ChatCompletionRequest => {
      const transformed: ChatCompletionRequest = { ...req };
      if (!transformed.model?.includes('qwen')) {
        transformed.model = 'qwen-max';
      }
      return transformed;
    },
  },
};
```

Then update `ProviderName` type in `src/types.ts` and `app/server/types.ts`:
```typescript
export type ProviderName = 'glm' | 'kimi' | 'deepseek' | 'minimax' | 'qwen';
```
