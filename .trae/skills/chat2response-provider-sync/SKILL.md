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

## Sync Checklist

### Step 1: Update `src/providers/index.ts`
- Add/modify the provider entry in `PROVIDERS` record
- Ensure `getEnvConfig(prefix, defaults)` is used for configurable fields
- Prefix format: `{PROVIDER_NAME}_BASE_URL`, `{PROVIDER_NAME}_DEFAULT_MODEL`, etc.
- Keep `transformRequest` logic consistent
- **Must include:** `import dotenv from 'dotenv'; dotenv.config();` at the top of the file

### Step 2: Mirror changes to `app/server/providers/index.ts`
- This is a **manual copy** of `src/providers/index.ts`
- Must stay byte-for-byte identical (except import paths which are already `../types`)
- **Do NOT skip this step** — Electron app will use stale code otherwise
- **Must include:** `import dotenv from 'dotenv'; dotenv.config();` at the top of the file

### Step 3: Recompile `app/server-dist/`
```bash
cd app && npx tsc
```
- `app/tsconfig.json` has `outDir: "./server-dist"` and `rootDir: "./server"`
- Verify `app/server-dist/providers/index.js` reflects the new `getEnvConfig` calls
- Verify the compiled output includes `dotenv` import and `dotenv.config()` call

### Step 4: Verify `app/server-dist/server-wrapper.js`
- This file is **copied as-is** during build (`cp server/server-wrapper.js server-dist/`)
- It does NOT call `dotenv.config()` — environment must be loaded by the caller
- If provider config relies on env vars, ensure the Electron main process sets them before starting the server

### Step 5: Update `.env.example`
- Add new environment variables for the provider:
  - `{PREFIX}_BASE_URL`
  - `{PREFIX}_DEFAULT_MODEL`
  - `{PREFIX}_MODELS`
  - `{PREFIX}_SUPPORTS_TOOLS`
  - `{PREFIX}_SUPPORTS_STREAMING`
- Keep commented by default to show optional configuration

### Step 6: Update documentation
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

## Quick Verification

After making provider changes, run:

```bash
# 1. Diff the two TS sources
diff src/providers/index.ts app/server/providers/index.ts
# Should show no meaningful differences (only if any)

# 2. Check dotenv is present in both
grep -n "dotenv" src/providers/index.ts app/server/providers/index.ts
# Both should show: import + dotenv.config()

# 3. Compile and check output
cd app && npx tsc
grep -A5 "getEnvConfig" server-dist/providers/index.js
# Should show the new prefix and defaults

# 4. Verify dotenv in compiled output
grep -n "dotenv" server-dist/providers/index.js
# Should show require("dotenv") and .config() call
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
