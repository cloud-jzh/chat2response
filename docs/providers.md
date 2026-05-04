# Chat2Response Provider 模块文档

## 1. 项目概述

Chat2Response 是一个**协议转换桥接服务**，核心目标是将 **OpenAI Responses API** 请求转换为各国内大模型厂商支持的 **Chat Completions API** 请求，并将响应重新包装回 Responses API 格式。

### 1.1 架构定位

```
┌─────────────────┐     Responses API      ┌──────────────────┐     Chat Completions API     ┌─────────────────┐
│   Codex CLI     │ ──────────────────────▶ │  Chat2Response   │ ───────────────────────────▶ │  国内模型厂商    │
│  (OpenAI SDK)   │ ◀────────────────────── │   (本服务)        │ ◀─────────────────────────── │  GLM/Kimi/...   │
└─────────────────┘     Responses API       └──────────────────┘     Chat Completions API      └─────────────────┘
```

### 1.2 核心文件结构

```
chat2response/
├── src/
│   ├── types.ts              # 类型定义（Responses API & Chat Completions API）
│   ├── converter.ts          # 协议转换核心（请求/响应/流式转换）
│   ├── providers/
│   │   └── index.ts          # Provider 配置与适配（本文档重点）
│   └── app.ts                # Express 服务入口
├── app/                      # Electron 桌面应用包装
│   ├── server/               # 源码副本（构建用）
│   ├── server-dist/          # 编译后的 JS
│   ├── renderer/             # 前端界面
│   ├── main.js               # Electron 主进程
│   └── preload.js            # 预加载脚本
├── package.json
├── .env.example
└── README.md
```

---

## 2. Provider 模块详解

Provider 模块位于 `src/providers/index.ts`，是整个项目的**适配器层**，负责管理不同模型厂商的配置、请求转换和 API 密钥获取。

### 2.1 核心类型定义

```typescript
// src/types.ts
export type ProviderName = 'glm' | 'kimi' | 'deepseek' | 'minimax';

export interface ProviderConfig {
  name: string;                          // 显示名称
  baseUrl: string;                       // API 基础地址
  defaultModel: string;                  // 默认模型
  models: string[];                      // 支持的模型列表
  supportsTools: boolean;                // 是否支持工具调用
  supportsStreaming: boolean;            // 是否支持流式输出
  transformRequest?: (req: ChatCompletionRequest) => ChatCompletionRequest;  // 请求转换函数
  transformResponse?: (res: unknown) => unknown;                              // 响应转换函数（预留）
}
```

### 2.2 Provider 注册表

所有 Provider 集中定义在 `PROVIDERS` 对象中：

```typescript
export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  glm:      { /* GLM 配置 */ },
  kimi:     { /* Kimi 配置 */ },
  deepseek: { /* DeepSeek 配置 */ },
  minimax:  { /* MiniMax 配置 */ },
};
```

---

## 3. 各 Provider 详细配置

### 3.1 GLM（智谱清言）

| 属性 | 值 |
|------|-----|
| 名称 | GLM |
| API 地址 | `https://open.bigmodel.cn/api/paas/v4` |
| 默认模型 | `glm-5` |
| 支持模型 | `glm-5` |
| 工具调用 | ❌ 不支持 |
| 流式输出 | ✅ 支持 |

**请求转换逻辑：**

```typescript
transformRequest: (req) => {
  // 1. 自动移除 tools（GLM 不支持）
  delete transformed.tools;
  delete transformed.tool_choice;

  // 2. 模型名称归一化
  model: req.model?.startsWith('glm-') ? req.model : 'glm-5';

  // 3. 消息内容扁平化为字符串
  messages = messages.map(msg => ({
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
  }));
}
```

**关键适配点：**
- GLM 对 Function Calling 支持不佳，因此**强制移除**所有 `tools` 和 `tool_choice`
- 消息 `content` 必须转为字符串（不支持数组格式）
- 保留 `tool_call_id` 以支持多轮对话中的工具结果回传

---

### 3.2 Kimi（月之暗面）

| 属性 | 值 |
|------|-----|
| 名称 | Kimi |
| API 地址 | `https://api.moonshot.cn/v1`（默认）<br>`https://api.kimi.com/coding/v1`（Coding Plan 模式） |
| 默认模型 | `kimi-coding` |
| 支持模型 | `kimi-coding`, `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k` |
| 工具调用 | ✅ 支持 |
| 流式输出 | ✅ 支持 |

**请求转换逻辑：**

```typescript
transformRequest: (req) => {
  // 1. 动态切换 API 端点（Coding Plan 模式）
  if (process.env.KIMI_CODING_PLAN === 'true') {
    baseUrl = 'https://api.kimi.com/coding/v1';
  } else {
    baseUrl = 'https://api.moonshot.cn/v1';
  }

  // 2. 工具参数规范化（确保有默认结构）
  tools = tools.map(tool => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        ...tool.function.parameters,
      },
    },
  }));

  // 3. 模型名称校验
  if (!model.includes('kimi') && !model.includes('moonshot')) {
    model = 'kimi-coding';
  }
}
```

**关键适配点：**
- 支持通过环境变量 `KIMI_CODING_PLAN` 切换 Coding 专用端点
- 工具参数强制补充 `type: 'object'`、`properties: {}`、`required: []`，避免 Kimi 端校验失败
- 模型名称自动 fallback 到 `kimi-coding`

---

### 3.3 DeepSeek

| 属性 | 值 |
|------|-----|
| 名称 | DeepSeek |
| API 地址 | `https://api.deepseek.com/v1` |
| 默认模型 | `deepseek-chat` |
| 支持模型 | `deepseek-chat`, `deepseek-reasoner` |
| 工具调用 | ✅ 支持 |
| 流式输出 | ✅ 支持 |

**请求转换逻辑：**

```typescript
transformRequest: (req) => {
  // 1. 移除 OpenAI 特有参数
  delete transformed['store'];

  // 2. 模型名称归一化
  if (!model.startsWith('deepseek')) {
    model = 'deepseek-chat';
  }
}
```

**关键适配点：**
- DeepSeek API 与 OpenAI 格式高度兼容，转换逻辑**最轻量**
- 仅移除 `store` 参数（OpenAI 特有）
- 推荐作为**默认 Provider** 使用

---

### 3.4 MiniMax

| 属性 | 值 |
|------|-----|
| 名称 | MiniMax |
| API 地址 | `https://api.minimax.chat/v1` |
| 默认模型 | `minimax-2.7` |
| 支持模型 | `minimax-2.7` |
| 工具调用 | ✅ 支持 |
| 流式输出 | ✅ 支持 |

**请求转换逻辑：**

```typescript
transformRequest: (req) => {
  // 1. 模型名称归一化
  if (!model.includes('minimax')) {
    model = 'minimax-2.7';
  }

  // 2. 消息内容扁平化为字符串
  messages = messages.map(msg => ({
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
  }));
}
```

**关键适配点：**
- 与 GLM 类似，要求消息 `content` 为字符串格式
- 保留 `tool_call_id` 支持多轮工具调用

---

## 4. Provider 工具函数

### 4.1 `getProvider(name)`

根据名称获取 Provider 配置。

```typescript
export function getProvider(name: ProviderName): ProviderConfig {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}
```

### 4.2 `getCurrentProvider()`

获取当前默认 Provider（从环境变量 `DEFAULT_PROVIDER` 读取，默认 `deepseek`）。

```typescript
export function getCurrentProvider(): ProviderConfig {
  const defaultProvider = (process.env.DEFAULT_PROVIDER as ProviderName) || 'deepseek';
  return getProvider(defaultProvider);
}
```

### 4.3 `getApiKey(providerName)`

获取指定 Provider 的 API Key，环境变量命名规则为 `{PROVIDER_NAME}_API_KEY`。

```typescript
export function getApiKey(providerName: ProviderName): string {
  const envVar = `${providerName.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`Missing API key for ${providerName}. Set ${envVar} environment variable.`);
  }
  return apiKey.trim();
}
```

**环境变量对应表：**

| Provider | 环境变量 |
|----------|----------|
| GLM | `GLM_API_KEY` |
| Kimi | `KIMI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |

### 4.4 `transformRequest(providerName, request)`

执行 Provider 特定的请求转换。

```typescript
export function transformRequest(
  providerName: ProviderName,
  request: ChatCompletionRequest
): ChatCompletionRequest {
  const provider = getProvider(providerName);
  if (provider.transformRequest) {
    return provider.transformRequest(request);
  }
  return request;
}
```

### 4.5 `isProviderSupported(name)`

检查名称是否为支持的 Provider。

```typescript
export function isProviderSupported(name: string): name is ProviderName {
  return name in PROVIDERS;
}
```

### 4.6 `detectProviderFromModel(modelId)`

根据模型 ID 自动推断 Provider。

```typescript
export function detectProviderFromModel(modelId: string): ProviderName | null {
  const modelLower = modelId.toLowerCase();
  if (modelLower.includes('glm')) return 'glm';
  if (modelLower.includes('kimi')) return 'kimi';
  if (modelLower.includes('deepseek')) return 'deepseek';
  if (modelLower.includes('minimax')) return 'minimax';
  return null;
}
```

---

## 5. Provider 选择策略

在 `app.ts` 中，Provider 的选择遵循以下优先级：

```
1. 请求头 X-Provider（最高优先级）
   → 2. 从 model 字段推断（model 包含 provider 名称）
     → 3. 环境变量 DEFAULT_PROVIDER
       → 4. 硬编码默认值 'deepseek'（最低优先级）
```

**代码实现：**

```typescript
const providerHeader = req.headers['x-provider'] as string;
const providerFromModel = detectProviderFromModel(body.model);

const providerName: ProviderName = 
  (isProviderSupported(providerHeader) ? providerHeader : null) ||
  providerFromModel ||
  (process.env.DEFAULT_PROVIDER as ProviderName) || 
  'deepseek';
```

---

## 6. 请求处理流水线

完整的请求处理流程如下：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         请求处理流水线                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 接收 Responses API 请求                                                 │
│     POST /v1/responses                                                      │
│     Headers: X-Provider: deepseek                                           │
│                                                                             │
│  2. Provider 解析                                                            │
│     → 读取 X-Provider 头 / model 字段 / DEFAULT_PROVIDER                    │
│                                                                             │
│  3. 协议转换 (converter.ts)                                                  │
│     → ResponsesRequest → ChatCompletionRequest                              │
│     → input[] → messages[]                                                  │
│     → instructions → system message                                         │
│     → tools → ChatTool[]                                                    │
│                                                                             │
│  4. Provider 请求转换 (providers/index.ts)                                   │
│     → 移除不支持的参数（如 GLM 的 tools）                                    │
│     → 规范化工具参数（如 Kimi 的 parameters）                                │
│     → 模型名称归一化                                                        │
│     → 消息格式扁平化                                                        │
│                                                                             │
│  5. 转发到上游 Provider                                                      │
│     → POST {provider.baseUrl}/chat/completions                              │
│     → Authorization: Bearer {API_KEY}                                       │
│                                                                             │
│  6. 响应转换 (converter.ts)                                                  │
│     → Chat Completions → Responses API                                      │
│     → 流式：生成 SSE 事件序列                                                │
│     → 非流式：包装为 ResponseObject                                         │
│                                                                             │
│  7. 返回客户端                                                               │
│     → Streaming: text/event-stream                                          │
│     → Non-streaming: application/json                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Provider 对比总览

| 特性 | GLM | Kimi | DeepSeek | MiniMax |
|------|-----|------|----------|---------|
| API 地址 | `open.bigmodel.cn` | `api.moonshot.cn` | `api.deepseek.com` | `api.minimax.chat` |
| 默认模型 | `glm-5` | `kimi-coding` | `deepseek-chat` | `minimax-2.7` |
| 工具调用 | ❌ | ✅ | ✅ | ✅ |
| 流式输出 | ✅ | ✅ | ✅ | ✅ |
| 消息扁平化 | ✅ | ❌ | ❌ | ✅ |
| 工具参数补全 | - | ✅ | ❌ | ❌ |
| 模型 fallback | ✅ | ✅ | ✅ | ✅ |
| 动态端点切换 | ❌ | ✅ | ❌ | ❌ |
| 特殊参数移除 | - | - | `store` | - |

---

## 8. 扩展新 Provider 指南

如需添加新的模型厂商，按以下步骤操作：

### 8.1 更新类型定义

```typescript
// src/types.ts
export type ProviderName = 'glm' | 'kimi' | 'deepseek' | 'minimax' | 'newprovider';
```

### 8.2 添加 Provider 配置

```typescript
// src/providers/index.ts
export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  // ... 现有 providers

  newprovider: {
    name: 'NewProvider',
    baseUrl: 'https://api.newprovider.com/v1',
    defaultModel: 'new-model',
    models: ['new-model', 'new-model-pro'],
    supportsTools: true,
    supportsStreaming: true,
    transformRequest: (req: ChatCompletionRequest): ChatCompletionRequest => {
      const transformed = { ...req };
      // 自定义转换逻辑
      if (!transformed.model?.includes('new')) {
        transformed.model = 'new-model';
      }
      return transformed;
    },
  },
};
```

### 8.3 添加 API Key 环境变量

```bash
# .env
NEWPROVIDER_API_KEY=your_key_here
```

### 8.4 更新文档

- 在 `README.md` 的 Provider 支持表中添加新行
- 更新 `.env.example` 添加新变量

---

## 9. 环境变量配置参考

所有 Provider 配置项均支持通过 `.env` 文件自定义，无需修改源码。未设置的环境变量将使用内置默认值。

### 9.1 通用配置项

每个 Provider 支持以下环境变量（以 `{PROVIDER}` 为前缀）：

| 环境变量 | 说明 | 示例 |
|----------|------|------|
| `{PROVIDER}_API_KEY` | API 密钥 | `DEEPSEEK_API_KEY=sk-xxx` |
| `{PROVIDER}_BASE_URL` | API 基础地址 | `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1` |
| `{PROVIDER}_DEFAULT_MODEL` | 默认模型 | `DEEPSEEK_DEFAULT_MODEL=deepseek-chat` |
| `{PROVIDER}_MODELS` | 支持的模型列表（逗号分隔） | `DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner` |
| `{PROVIDER}_SUPPORTS_TOOLS` | 是否支持工具调用 | `DEEPSEEK_SUPPORTS_TOOLS=true` |
| `{PROVIDER}_SUPPORTS_STREAMING` | 是否支持流式输出 | `DEEPSEEK_SUPPORTS_STREAMING=true` |

### 9.2 各 Provider 默认值

| Provider | BASE_URL | DEFAULT_MODEL | MODELS | SUPPORTS_TOOLS | SUPPORTS_STREAMING |
|----------|----------|---------------|--------|----------------|-------------------|
| GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5` | `glm-5` | `false` | `true` |
| Kimi | `https://api.moonshot.cn/v1` | `kimi-coding` | `kimi-coding,moonshot-v1-8k,moonshot-v1-32k,moonshot-v1-128k` | `true` | `true` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | `deepseek-chat,deepseek-reasoner` | `true` | `true` |
| MiniMax | `https://api.minimax.chat/v1` | `minimax-2.7` | `minimax-2.7` | `true` | `true` |

### 9.3 特殊配置

| 环境变量 | 说明 |
|----------|------|
| `KIMI_CODING_PLAN` | 设为 `true` 时切换至 Kimi Coding 专用端点 `https://api.kimi.com/coding/v1` |
| `DEFAULT_PROVIDER` | 全局默认 Provider（`glm` / `kimi` / `deepseek` / `minimax`） |
| `PORT` | 服务端口，默认 `3456` |
| `DEBUG` | 调试模式，设为 `true` 输出详细日志 |

### 9.4 配置示例

```bash
# 使用自定义 DeepSeek 端点（如代理地址）
DEEPSEEK_BASE_URL=https://my-proxy.example.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-chat

# 禁用 GLM 的流式输出
GLM_SUPPORTS_STREAMING=false

# 添加自定义模型到 Kimi
KIMI_MODELS=kimi-coding,moonshot-v1-8k,my-custom-model

# 完整 .env 示例
GLM_API_KEY=your_glm_api_key
KIMI_API_KEY=your_kimi_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
MINIMAX_API_KEY=your_minimax_api_key
DEFAULT_PROVIDER=deepseek
PORT=3456
DEBUG=false
```

---

## 10. 常见问题

### Q1: 为什么 GLM 不支持工具调用？

GLM 的 Function Calling 实现与 OpenAI 格式差异较大，且稳定性不足。为避免兼容性问题，Provider 配置中明确禁用并自动移除工具相关字段。

### Q2: 如何强制使用特定 Provider？

通过请求头指定：
```bash
curl -X POST http://localhost:3456/v1/responses \
  -H "X-Provider: kimi" \
  -d '{"model":"any-model","input":"Hello"}'
```

### Q3: 模型名称不匹配会怎样？

每个 Provider 的 `transformRequest` 都会检查模型名称，如果不符合该厂商的命名规范，会自动 fallback 到 `defaultModel`。

### Q4: 如何添加自定义模型映射？

在对应 Provider 的 `transformRequest` 中添加模型名称映射逻辑，例如：
```typescript
const modelMap: Record<string, string> = {
  'custom-name': 'official-model-name',
};
transformed.model = modelMap[req.model] || req.model || 'default-model';
```
