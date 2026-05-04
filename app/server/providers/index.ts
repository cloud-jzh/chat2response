import type { ProviderConfig, ProviderName, ChatCompletionRequest } from '../types';

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
      if (req.tools?.length) {
        console.log('[GLM] Removing unsupported tools:', req.tools.length);
      }

      const transformed: ChatCompletionRequest = {
        ...req,
        model: req.model?.startsWith('glm-') ? req.model : 'glm-5',
      };

      delete transformed.tools;
      delete transformed.tool_choice;

      if (transformed.messages) {
        transformed.messages = transformed.messages.map(msg => ({
          role: msg.role,
          content: typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
          ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
        }));
      }

      return transformed;
    },
  },

  kimi: {
    name: 'Kimi',
    ...getEnvConfig('KIMI', {
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'kimi-coding',
      models: ['kimi-coding', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      supportsTools: true,
      supportsStreaming: true,
    }),
    transformRequest: (req: ChatCompletionRequest): ChatCompletionRequest => {
      const transformed: ChatCompletionRequest = { ...req };

      if (process.env.KIMI_CODING_PLAN === 'true') {
        (PROVIDERS.kimi as any).baseUrl = 'https://api.kimi.com/coding/v1';
      } else {
        (PROVIDERS.kimi as any).baseUrl = process.env['KIMI_BASE_URL'] || 'https://api.moonshot.cn/v1';
      }

      if (transformed.tools) {
        transformed.tools = transformed.tools.map(tool => ({
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
      }

      if (!transformed.model?.includes('kimi') && !transformed.model?.includes('moonshot')) {
        transformed.model = 'kimi-coding';
      }

      return transformed;
    },
  },

  deepseek: {
    name: 'DeepSeek',
    ...getEnvConfig('DEEPSEEK', {
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      supportsTools: true,
      supportsStreaming: true,
    }),
    transformRequest: (req: ChatCompletionRequest): ChatCompletionRequest => {
      const transformed: ChatCompletionRequest = { ...req };

      delete (transformed as Record<string, unknown>)['store'];

      if (!transformed.model?.startsWith('deepseek')) {
        transformed.model = 'deepseek-chat';
      }

      return transformed;
    },
  },

  minimax: {
    name: 'MiniMax',
    ...getEnvConfig('MINIMAX', {
      baseUrl: 'https://api.minimax.chat/v1',
      defaultModel: 'minimax-2.7',
      models: ['minimax-2.7'],
      supportsTools: true,
      supportsStreaming: true,
    }),
    transformRequest: (req: ChatCompletionRequest): ChatCompletionRequest => {
      const transformed: ChatCompletionRequest = { ...req };

      if (!transformed.model?.includes('minimax')) {
        transformed.model = 'minimax-2.7';
      }

      if (transformed.messages) {
        transformed.messages = transformed.messages.map(msg => {
          const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);

          return {
            role: msg.role,
            content,
            ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
          };
        });
      }

      return transformed;
    },
  },
};

export function getProvider(name: ProviderName): ProviderConfig {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export function getCurrentProvider(): ProviderConfig {
  const defaultProvider = (process.env.DEFAULT_PROVIDER as ProviderName) || 'deepseek';
  return getProvider(defaultProvider);
}

export function getApiKey(providerName: ProviderName): string {
  const envVar = `${providerName.toUpperCase()}_API_KEY`;
  const apiKey = process.env[envVar];

  if (!apiKey) {
    throw new Error(`Missing API key for ${providerName}. Set ${envVar} environment variable.`);
  }

  return apiKey.trim();
}

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

export function isProviderSupported(name: string): name is ProviderName {
  return name in PROVIDERS;
}

export function detectProviderFromModel(modelId: string): ProviderName | null {
  const modelLower = modelId.toLowerCase();
  if (modelLower.includes('glm')) return 'glm';
  if (modelLower.includes('kimi')) return 'kimi';
  if (modelLower.includes('deepseek')) return 'deepseek';
  if (modelLower.includes('minimax')) return 'minimax';
  return null;
}
