import { getProviderDefinition, type ProviderId } from "../shared/providers";

export interface ProviderDefaults {
  baseUrl: string;
  model: string;
}

export function getProviderDefaults(provider: ProviderId): ProviderDefaults {
  const definition = getProviderDefinition(provider);
  return { baseUrl: definition.baseUrl, model: definition.defaultModel };
}
