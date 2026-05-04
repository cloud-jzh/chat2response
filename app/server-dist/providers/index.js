"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDERS = void 0;
exports.getProvider = getProvider;
exports.getCurrentProvider = getCurrentProvider;
exports.getApiKey = getApiKey;
exports.transformRequest = transformRequest;
exports.isProviderSupported = isProviderSupported;
exports.detectProviderFromModel = detectProviderFromModel;
function getEnvConfig(prefix, defaults) {
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
exports.PROVIDERS = {
    glm: {
        name: 'GLM',
        ...getEnvConfig('GLM', {
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            defaultModel: 'glm-5',
            models: ['glm-5'],
            supportsTools: false,
            supportsStreaming: true,
        }),
        transformRequest: (req) => {
            if (req.tools?.length) {
                console.log('[GLM] Removing unsupported tools:', req.tools.length);
            }
            const transformed = {
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
        transformRequest: (req) => {
            const transformed = { ...req };
            if (process.env.KIMI_CODING_PLAN === 'true') {
                exports.PROVIDERS.kimi.baseUrl = 'https://api.kimi.com/coding/v1';
            }
            else {
                exports.PROVIDERS.kimi.baseUrl = process.env['KIMI_BASE_URL'] || 'https://api.moonshot.cn/v1';
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
        transformRequest: (req) => {
            const transformed = { ...req };
            delete transformed['store'];
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
        transformRequest: (req) => {
            const transformed = { ...req };
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
function getProvider(name) {
    const provider = exports.PROVIDERS[name];
    if (!provider) {
        throw new Error(`Unknown provider: ${name}`);
    }
    return provider;
}
function getCurrentProvider() {
    const defaultProvider = process.env.DEFAULT_PROVIDER || 'deepseek';
    return getProvider(defaultProvider);
}
function getApiKey(providerName) {
    const envVar = `${providerName.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envVar];
    if (!apiKey) {
        throw new Error(`Missing API key for ${providerName}. Set ${envVar} environment variable.`);
    }
    return apiKey.trim();
}
function transformRequest(providerName, request) {
    const provider = getProvider(providerName);
    if (provider.transformRequest) {
        return provider.transformRequest(request);
    }
    return request;
}
function isProviderSupported(name) {
    return name in exports.PROVIDERS;
}
function detectProviderFromModel(modelId) {
    const modelLower = modelId.toLowerCase();
    if (modelLower.includes('glm'))
        return 'glm';
    if (modelLower.includes('kimi'))
        return 'kimi';
    if (modelLower.includes('deepseek'))
        return 'deepseek';
    if (modelLower.includes('minimax'))
        return 'minimax';
    return null;
}
