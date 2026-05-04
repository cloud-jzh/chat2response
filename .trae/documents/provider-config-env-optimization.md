# Provider 配置外部化优化方案

## 背景

当前 `src/providers/index.ts` 中所有 Provider 的配置（baseUrl、defaultModel、models 等）均为硬编码，用户无法在不修改源码的情况下自定义这些配置。本方案旨在将所有可配置项迁移至 `.env` 环境变量，同时保持向后兼容和代码简洁性。

---

## 目标

1. **零源码修改配置**：用户仅需修改 `.env` 即可调整 Provider 配置
2. **向后兼容**：未设置环境变量时，使用当前硬编码值作为默认值
3. **保持简洁**：不引入重型配置框架，利用现有 `dotenv`
4. **支持动态扩展**：允许用户添加新的自定义 Provider

---

## 方案设计

### 环境变量命名规范

采用 `{PROVIDER}_{PROPERTY}` 的命名模式：

| 属性 | 环境变量示例 | 说明 |
|------|-------------|------|
| baseUrl | `GLM_BASE_URL` | API 基础地址 |
| defaultModel | `GLM_DEFAULT_MODEL` | 默认模型 |
| models | `GLM_MODELS` | 支持的模型列表，逗号分隔 |
| supportsTools | `GLM_SUPPORTS_TOOLS` | 是否支持工具调用 |
| supportsStreaming | `GLM_SUPPORTS_STREAMING` | 是否支持流式输出 |

### 特殊配置

| 环境变量 | 说明 |
|----------|------|
| `KIMI_CODING_PLAN` | 是否启用 Kimi Coding 端点（已有） |
| `DEFAULT_PROVIDER` | 默认 Provider（已有） |
| `{PROVIDER}_API_KEY` | API Key（已有） |

---

## 实施步骤

### Step 1: 重构 PROVIDERS 为工厂函数

将硬编码的 `PROVIDERS` 对象重构为 `createProviders()` 工厂函数，从环境变量读取配置，未设置时使用默认值。

**修改文件**: `src/providers/index.ts`

```typescript
// 新增：从环境变量读取 Provider 配置的辅助函数
function getEnvConfig(
  prefix: string,
  defaults: {
    baseUrl: string;
    defaultModel: string;
    models: string[];
    supportsTools: boolean;
    supportsStreaming: boolean;
  }
): Pick<ProviderConfig, 'baseUrl' | 'defaultModel' | 'models' | 'supportsTools' | 'supportsStreaming'> {
  const modelsEnv = process.env[`${prefix}_MODELS`];
  return {
    baseUrl: process.env[`${prefix}_BASE_URL`] || defaults.baseUrl,
    defaultModel: process.env[`${prefix}_DEFAULT_MODEL`] || defaults.defaultModel,
    models: modelsEnv ? modelsEnv.split(',').map(m => m.trim()) : defaults.models,
    supportsTools: process.env[`${prefix}_SUPPORTS_TOOLS`] !== undefined
      ? process.env[`${prefix}_SUPPORTS_TOOLS`] === 'true'
      : defaults.supportsTools,
    supportsStreaming: process.env[`${prefix}_SUPPORTS_STREAMING`] !== undefined
      ? process.env[`${prefix}_SUPPORTS_STREAMING`] === 'true'
      : defaults.supportsStreaming,
  };
}
```

### Step 2: 重写 PROVIDERS 定义

```typescript
export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  glm: {
    name: 'GLM',
    ...getEnvConfig('GLM', {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-5',
      models: ['glm-5'],
      supportsTools: false,
      supportsStreaming: true,
    }),
    transformRequest: (req: ChatCompletionRequest): ChatCompletionRequest => {
      // ... 保持现有转换逻辑不变
    },
  },
  // ... 其他 Provider 同理
};
```

### Step 3: 更新 `.env.example`

添加所有新的环境变量，并注释说明：

```bash
# ============================================
# GLM Configuration
# ============================================
GLM_API_KEY=your_glm_api_key_here
# GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
# GLM_DEFAULT_MODEL=glm-5
# GLM_MODELS=glm-5
# GLM_SUPPORTS_TOOLS=false
# GLM_SUPPORTS_STREAMING=true

# ============================================
# Kimi Configuration
# ============================================
KIMI_API_KEY=your_kimi_api_key_here
# KIMI_BASE_URL=https://api.moonshot.cn/v1
# KIMI_DEFAULT_MODEL=kimi-coding
# KIMI_MODELS=kimi-coding,moonshot-v1-8k,moonshot-v1-32k,moonshot-v1-128k
# KIMI_SUPPORTS_TOOLS=true
# KIMI_SUPPORTS_STREAMING=true
# KIMI_CODING_PLAN=false

# ============================================
# DeepSeek Configuration
# ============================================
DEEPSEEK_API_KEY=your_deepseek_api_key_here
# DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
# DEEPSEEK_DEFAULT_MODEL=deepseek-chat
# DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner
# DEEPSEEK_SUPPORTS_TOOLS=true
# DEEPSEEK_SUPPORTS_STREAMING=true

# ============================================
# MiniMax Configuration
# ============================================
MINIMAX_API_KEY=your_minimax_api_key_here
# MINIMAX_BASE_URL=https://api.minimax.chat/v1
# MINIMAX_DEFAULT_MODEL=minimax-2.7
# MINIMAX_MODELS=minimax-2.7
# MINIMAX_SUPPORTS_TOOLS=true
# MINIMAX_SUPPORTS_STREAMING=true

# ============================================
# Global Settings
# ============================================
DEFAULT_PROVIDER=deepseek
PORT=3456
DEBUG=false
```

### Step 4: 更新 `README.md`

在 Provider 配置章节添加环境变量说明，告知用户所有配置项均可通过 `.env` 自定义。

### Step 5: 验证

1. 不设置任何新环境变量 → 服务正常启动，使用默认值
2. 设置部分环境变量 → 覆盖对应配置，其余使用默认值
3. 设置全部环境变量 → 完全使用自定义配置

---

## 变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/providers/index.ts` | 修改 | 添加 `getEnvConfig` 工厂函数，重写 PROVIDERS 定义 |
| `.env.example` | 修改 | 添加所有可配置项的环境变量示例 |
| `README.md` | 修改 | 更新 Provider 配置文档 |
| `docs/providers.md` | 修改 | 更新 Provider 文档中的配置说明 |

---

## 向后兼容性

- 未设置新环境变量的用户：行为与当前完全一致
- 已设置 `KIMI_CODING_PLAN` 的用户：继续生效
- 已设置 `{PROVIDER}_API_KEY` 的用户：继续生效

---

## 扩展性

未来如需添加新 Provider，只需：
1. 在 `ProviderName` 类型中添加新名称
2. 在 `PROVIDERS` 中添加新条目，使用 `getEnvConfig` 读取配置
3. 在 `.env.example` 中添加对应示例
