import { BackendError } from '@banh/dsl';
import type { SystemOneBackend } from '@banh/runtime';
import type { LayaBackendOptions } from '@banh/laya';
import type { TypeSafeHttpBackendOptions } from '@banh/typesafe';

export type HttpModel = 'laya' | 'kev' | 'jev';
export type HttpProviderOptions = Omit<TypeSafeHttpBackendOptions, 'baseUrl'> & { baseUrl?: string };
export type ProviderOptions =
  | { provider: 'native'; model: 'laya'; options?: LayaBackendOptions }
  | { provider: 'http'; model: HttpModel; options: HttpProviderOptions };

const httpDefaults: Record<HttpModel, { baseUrl?: string; modelId?: string }> = {
  laya: {},
  kev: { modelId: 'kev-latest' },
  jev: { baseUrl: 'https://api.typesafe.ai', modelId: 'jev-latest' },
};

/** Model presets configure one shared HTTP implementation; native execution stays separate. */
export async function createProvider(config: ProviderOptions = { provider: 'native', model: 'laya' }): Promise<SystemOneBackend> {
  if (!Object.hasOwn(httpDefaults, config.model)) throw new BackendError('Unsupported model; use laya, kev, or jev');
  switch (config.provider) {
    case 'native': {
      if (config.model !== 'laya') throw new BackendError('Native execution supports only laya; use the http provider for kev or jev');
      const { LayaBackend } = await import('@banh/laya');
      return LayaBackend.create(config.options);
    }
    case 'http': {
      const defaults = httpDefaults[config.model];
      const baseUrl = config.options.baseUrl ?? defaults.baseUrl;
      if (!baseUrl) throw new BackendError('HTTP provider requires --base-url or BANH_INFERENCE_BASE_URL for ' + config.model);
      if (config.model === 'jev' && !config.options.token) throw new BackendError('Jev requires an inference bearer token (BANH_INFERENCE_TOKEN)');
      const modelId = config.options.modelId ?? defaults.modelId;
      const { TypeSafeHttpBackend } = await import('@banh/typesafe');
      return new TypeSafeHttpBackend({
        ...config.options, baseUrl,
        ...(modelId === undefined ? {} : { modelId }),
      });
    }
    default: throw new BackendError('Unsupported provider; use native or http');
  }
}
