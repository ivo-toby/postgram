import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import type { AppConfig } from '../config.js';
import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';
import {
  getRuntimeSecretMetadata,
  getRuntimeSecretPlaintext,
  getRuntimeSetting,
  saveRuntimeSecret,
  saveRuntimeSetting,
  updateRuntimeSettingValidation,
  type JsonValue,
  type RuntimeSecretMetadata,
  type RuntimeSettingClassification,
  type RuntimeSettingRecord,
  type RuntimeValidationInput,
  type RuntimeValidationStatus
} from './admin-settings-service.js';
import {
  assertEmbeddingDimensionAgreement,
  type ConfiguredEmbeddingIdentity
} from './embeddings/admin.js';
import { resolveEmbeddingDefaults } from './embeddings/providers.js';

export type ProviderConfigSettingKey =
  | 'EXTRACTION_ENABLED'
  | 'EXTRACTION_PROVIDER'
  | 'EXTRACTION_MODEL'
  | 'EXTRACTION_BASE_URL'
  | 'OLLAMA_BASE_URL'
  | 'EMBEDDING_PROVIDER'
  | 'EMBEDDING_MODEL'
  | 'EMBEDDING_DIMENSIONS'
  | 'EMBEDDING_BASE_URL';

export type ProviderSecretName =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'OLLAMA_API_KEY'
  | 'EXTRACTION_API_KEY'
  | 'EMBEDDING_API_KEY';

export type ProviderConfigDnsLookup = (
  hostname: string
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export type ProviderConfigFetch = (
  input: string,
  init: RequestInit
) => Promise<Response>;

type ProviderUrlFailureReason =
  | 'invalid_url'
  | 'credentials_not_allowed'
  | 'scheme_not_allowed'
  | 'http_requires_local_provider_exception'
  | 'blocked_hostname'
  | 'blocked_ip_range'
  | 'dns_lookup_failed';

export type ProviderConfigSettingSnapshot = {
  key: ProviderConfigSettingKey;
  value: JsonValue | undefined;
  source: 'database' | 'env' | 'unset';
  classification: RuntimeSettingClassification;
  state: 'pending' | 'applied';
  validation: RuntimeSettingRecord['validation'];
  restartRequired: boolean;
  reembedRequired: boolean;
  appliedAt: string | null;
  updatedByAdminUserId: string | null;
  updatedAt: string | null;
};

export type ProviderConfigurationSnapshot = {
  settings: Record<ProviderConfigSettingKey, ProviderConfigSettingSnapshot>;
  secrets: Record<ProviderSecretName, RuntimeSecretMetadata | null>;
  envSecrets: Record<ProviderSecretName, boolean>;
  restartRequired: boolean;
  reembedRequired: boolean;
  egressPolicy: {
    id: 'provider-base-url-v1';
    httpsRequiredForRemoteProviders: true;
    redirects: 'blocked';
    localProviderHttpHosts: string[];
  };
};

export type ProviderUrlValidationResult =
  | {
      safe: true;
      normalizedUrl: string;
      localProviderException: boolean;
      metadata: {
        scheme: 'http:' | 'https:';
        hostType: 'local_provider_exception' | 'public';
      };
    }
  | {
      safe: false;
      reason: ProviderUrlFailureReason;
      message: string;
      metadata: {
        scheme?: string | undefined;
        hostType?: 'blocked' | 'unknown' | undefined;
      };
    };

export type ProviderConnectionResult = {
  status: RuntimeValidationStatus;
  message: string;
  metadata: Record<string, JsonValue>;
};

export type ProviderValidationResult = {
  status: 'valid' | 'invalid' | 'error' | 'requires_reembedding';
  restartRequired: boolean;
  reembedRequired: boolean;
  connectionTests: Partial<
    Record<ProviderConfigSettingKey, ProviderConnectionResult>
  >;
  runtime: {
    constructible: boolean;
    errors: Array<{
      field: string;
      message: string;
    }>;
  };
  embedding: {
    current: ConfiguredEmbeddingIdentity | null;
    target: ConfiguredEmbeddingIdentity | null;
  };
};

export type ProviderApplyResult = {
  applied: true;
  restartRequired: boolean;
  reembedRequired: boolean;
  reload: {
    extraction: 'restart_required' | 'unchanged';
    embedding: 'restart_required' | 'unchanged';
  };
  appliedSettings: ProviderConfigSettingKey[];
};

type ProviderSettingDefinition = {
  classification: RuntimeSettingClassification;
  restartRequired: boolean;
  reembedRequired: boolean;
};

const PROVIDER_SETTING_KEYS = [
  'EXTRACTION_ENABLED',
  'EXTRACTION_PROVIDER',
  'EXTRACTION_MODEL',
  'EXTRACTION_BASE_URL',
  'OLLAMA_BASE_URL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'EMBEDDING_BASE_URL'
] as const satisfies readonly ProviderConfigSettingKey[];

const PROVIDER_SECRET_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OLLAMA_API_KEY',
  'EXTRACTION_API_KEY',
  'EMBEDDING_API_KEY'
] as const satisfies readonly ProviderSecretName[];

const PROVIDER_SETTING_DEFINITIONS: Record<
  ProviderConfigSettingKey,
  ProviderSettingDefinition
> = {
  EXTRACTION_ENABLED: {
    classification: 'restart_required',
    restartRequired: true,
    reembedRequired: false
  },
  EXTRACTION_PROVIDER: {
    classification: 'restart_required',
    restartRequired: true,
    reembedRequired: false
  },
  EXTRACTION_MODEL: {
    classification: 'restart_required',
    restartRequired: true,
    reembedRequired: false
  },
  EXTRACTION_BASE_URL: {
    classification: 'restart_required',
    restartRequired: true,
    reembedRequired: false
  },
  OLLAMA_BASE_URL: {
    classification: 'restart_required',
    restartRequired: true,
    reembedRequired: false
  },
  EMBEDDING_PROVIDER: {
    classification: 'dangerous_migration',
    restartRequired: true,
    reembedRequired: true
  },
  EMBEDDING_MODEL: {
    classification: 'dangerous_migration',
    restartRequired: true,
    reembedRequired: true
  },
  EMBEDDING_DIMENSIONS: {
    classification: 'dangerous_migration',
    restartRequired: true,
    reembedRequired: true
  },
  EMBEDDING_BASE_URL: {
    classification: 'restart_required',
    restartRequired: true,
    reembedRequired: false
  }
};

const PROVIDER_SECRET_DEFINITIONS: Record<
  ProviderSecretName,
  {
    provider: string;
    purpose: 'embedding' | 'extraction' | 'provider';
  }
> = {
  OPENAI_API_KEY: { provider: 'openai', purpose: 'provider' },
  ANTHROPIC_API_KEY: { provider: 'anthropic', purpose: 'extraction' },
  OLLAMA_API_KEY: { provider: 'ollama', purpose: 'provider' },
  EXTRACTION_API_KEY: {
    provider: 'openai-compatible',
    purpose: 'extraction'
  },
  EMBEDDING_API_KEY: { provider: 'ollama', purpose: 'embedding' }
};

const PROVIDER_URL_KEYS = new Set<ProviderConfigSettingKey>([
  'EXTRACTION_BASE_URL',
  'OLLAMA_BASE_URL',
  'EMBEDDING_BASE_URL'
]);
const PROVIDER_CONNECTION_TIMEOUT_MS = 10_000;
const PROCESS_STARTED_AT_MS = Date.now();

const EMBEDDING_IDENTITY_KEYS = new Set<ProviderConfigSettingKey>([
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS'
]);

function envSecretConfigured(
  envConfig: AppConfig | undefined,
  name: ProviderSecretName
): boolean {
  return Boolean(envConfig?.[name]);
}

function envSecretAvailability(
  envConfig: AppConfig | undefined
): Record<ProviderSecretName, boolean> {
  return Object.fromEntries(
    PROVIDER_SECRET_NAMES.map((name) => [
      name,
      envSecretConfigured(envConfig, name)
    ])
  ) as Record<ProviderSecretName, boolean>;
}

const LOCAL_PROVIDER_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'host.docker.internal',
  'host.containers.internal',
  'ollama'
]);

const EGRESS_POLICY = {
  id: 'provider-base-url-v1',
  httpsRequiredForRemoteProviders: true,
  redirects: 'blocked',
  localProviderHttpHosts: Array.from(LOCAL_PROVIDER_HOSTNAMES).sort()
} as const;

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

function validationError(
  message: string,
  details: Record<string, unknown>
): AppError {
  return new AppError(ErrorCode.VALIDATION, message, details);
}

function requireProviderSettingKey(key: string): ProviderConfigSettingKey {
  if (!(PROVIDER_SETTING_KEYS as readonly string[]).includes(key)) {
    throw validationError('Unsupported provider setting', { field: key });
  }

  return key as ProviderConfigSettingKey;
}

function requireProviderSecretName(name: string): ProviderSecretName {
  if (!(PROVIDER_SECRET_NAMES as readonly string[]).includes(name)) {
    throw validationError('Unsupported provider secret', { field: 'name' });
  }

  return name as ProviderSecretName;
}

function normalizeProviderStringSetting(
  key: ProviderConfigSettingKey,
  value: unknown
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError('Provider setting must be a non-empty string', {
      field: key
    });
  }

  return value.trim();
}

function normalizeProviderBaseUrlSetting(
  key: ProviderConfigSettingKey,
  value: unknown
): string {
  const trimmed = normalizeProviderStringSetting(key, value);

  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw validationError(
      'Provider base URL must not contain query strings or fragments',
      {
        field: key
      }
    );
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      throw validationError('Provider base URL must not contain credentials', {
        field: key
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
  }

  return trimmed;
}

function normalizeProviderSettingValue(
  key: ProviderConfigSettingKey,
  value: unknown
): JsonValue {
  switch (key) {
    case 'EXTRACTION_ENABLED': {
      if (typeof value !== 'boolean') {
        throw validationError('Provider setting must be a boolean', {
          field: key
        });
      }
      return value;
    }
    case 'EXTRACTION_PROVIDER': {
      if (
        value !== 'openai' &&
        value !== 'anthropic' &&
        value !== 'ollama' &&
        value !== 'openai-compatible'
      ) {
        throw validationError('Invalid extraction provider', { field: key });
      }
      return value;
    }
    case 'EMBEDDING_PROVIDER': {
      if (value !== 'openai' && value !== 'ollama') {
        throw validationError('Invalid embedding provider', { field: key });
      }
      return value;
    }
    case 'EMBEDDING_DIMENSIONS': {
      if (!Number.isSafeInteger(value) || Number(value) <= 0) {
        throw validationError(
          'Embedding dimensions must be a positive integer',
          {
            field: key
          }
        );
      }
      return Number(value);
    }
    case 'EXTRACTION_MODEL':
    case 'EMBEDDING_MODEL': {
      return normalizeProviderStringSetting(key, value);
    }
    case 'EXTRACTION_BASE_URL':
    case 'OLLAMA_BASE_URL':
    case 'EMBEDDING_BASE_URL': {
      return normalizeProviderBaseUrlSetting(key, value);
    }
  }
}

function normalizeProviderHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/u, '$1');
}

function normalizeBaseUrl(url: URL): string {
  return url.toString().replace(/\/+$/u, '');
}

function isLocalProviderCapable(provider: string): boolean {
  return provider === 'ollama' || provider === 'openai-compatible';
}

function isLocalProviderHostname(hostname: string): boolean {
  return LOCAL_PROVIDER_HOSTNAMES.has(normalizeProviderHostname(hostname));
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let output = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value < 0 || value > 255) {
      return null;
    }
    output = (output << 8) + value;
  }

  return output >>> 0;
}

function ipv4InRange(address: string, base: string, maskBits: number): boolean {
  const value = ipv4ToNumber(address);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) {
    return false;
  }
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isBlockedIPv4(address: string): boolean {
  return (
    ipv4InRange(address, '0.0.0.0', 8) ||
    ipv4InRange(address, '10.0.0.0', 8) ||
    ipv4InRange(address, '100.64.0.0', 10) ||
    ipv4InRange(address, '127.0.0.0', 8) ||
    ipv4InRange(address, '169.254.0.0', 16) ||
    ipv4InRange(address, '172.16.0.0', 12) ||
    ipv4InRange(address, '192.168.0.0', 16) ||
    ipv4InRange(address, '224.0.0.0', 4) ||
    ipv4InRange(address, '240.0.0.0', 4)
  );
}

function parseIPv4MappedIPv6(address: string): string | null {
  const normalized = normalizeProviderHostname(address);
  const mappedPrefix = '::ffff:';
  if (!normalized.startsWith(mappedPrefix)) {
    return null;
  }

  const mapped = normalized.slice(mappedPrefix.length);
  if (ipv4ToNumber(mapped) !== null) {
    return mapped;
  }

  const groups = mapped.split(':');
  if (groups.length !== 2) {
    return null;
  }

  const values = groups.map((group) => Number.parseInt(group, 16));
  if (
    values.some(
      (value, index) =>
        !/^[0-9a-f]{1,4}$/iu.test(groups[index] ?? '') ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 0xffff
    )
  ) {
    return null;
  }

  const [high, low] = values as [number, number];
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(
    '.'
  );
}

function expandIPv6Segments(address: string): number[] | null {
  const normalized = normalizeProviderHostname(address);
  const parts = normalized.split('::');
  if (parts.length > 2) {
    return null;
  }

  const parseSide = (side: string): number[] | null => {
    if (!side) {
      return [];
    }
    const rawGroups = side.split(':');
    const groups: number[] = [];
    for (const [index, rawGroup] of rawGroups.entries()) {
      if (!rawGroup) {
        return null;
      }
      if (rawGroup.includes('.')) {
        if (index !== rawGroups.length - 1) {
          return null;
        }
        const ipv4 = ipv4ToNumber(rawGroup);
        if (ipv4 === null) {
          return null;
        }
        groups.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/iu.test(rawGroup)) {
        return null;
      }
      groups.push(Number.parseInt(rawGroup, 16));
    }
    return groups;
  };

  const head = parseSide(parts[0] ?? '');
  const tail = parseSide(parts[1] ?? '');
  if (!head || !tail) {
    return null;
  }

  if (parts.length === 1) {
    return head.length === 8 ? head : null;
  }

  const zeroCount = 8 - head.length - tail.length;
  if (zeroCount < 1) {
    return null;
  }

  return [...head, ...Array.from({ length: zeroCount }, () => 0), ...tail];
}

function ipv4FromSegments(groups: number[], start: number): string {
  const high = groups[start] ?? 0;
  const low = groups[start + 1] ?? 0;
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(
    '.'
  );
}

function translatedIPv4Address(address: string): string | null {
  const mapped = parseIPv4MappedIPv6(address);
  if (mapped) {
    return mapped;
  }

  const groups = expandIPv6Segments(address);
  if (!groups) {
    return null;
  }

  const firstSixZero = groups.slice(0, 6).every((segment) => segment === 0);
  if (firstSixZero) {
    return ipv4FromSegments(groups, 6);
  }

  const nat64WellKnown =
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((segment) => segment === 0);
  if (nat64WellKnown) {
    return ipv4FromSegments(groups, 6);
  }

  return null;
}

function firstIpv6Segment(address: string): number | null {
  const first = normalizeProviderHostname(address).split(':')[0];
  if (!first || !/^[0-9a-f]{1,4}$/iu.test(first)) {
    return null;
  }

  const value = Number.parseInt(first, 16);
  return Number.isInteger(value) ? value : null;
}

function secondIpv6Segment(address: string): number | null {
  const second = normalizeProviderHostname(address).split(':')[1];
  if (!second || !/^[0-9a-f]{1,4}$/iu.test(second)) {
    return null;
  }

  const value = Number.parseInt(second, 16);
  return Number.isInteger(value) ? value : null;
}

function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const translatedIPv4 = translatedIPv4Address(normalized);
  if (translatedIPv4 && isBlockedIPv4(translatedIPv4)) {
    return true;
  }

  const firstSegment = firstIpv6Segment(normalized);
  const secondSegment = secondIpv6Segment(normalized);
  if (
    normalized === '::' ||
    normalized === '::1' ||
    firstSegment === 0x0100 ||
    firstSegment === 0x2002 ||
    (firstSegment === 0x2001 && secondSegment === 0x0db8) ||
    (firstSegment === 0x2001 && secondSegment === 0x0002) ||
    (firstSegment === 0x2001 &&
      secondSegment !== null &&
      secondSegment >= 0x0010 &&
      secondSegment <= 0x001f) ||
    (firstSegment !== null && (firstSegment & 0xffc0) === 0xfe80) ||
    (firstSegment !== null && (firstSegment & 0xffc0) === 0xfec0) ||
    (firstSegment !== null && (firstSegment & 0xfe00) === 0xfc00) ||
    (firstSegment !== null && (firstSegment & 0xff00) === 0xff00)
  ) {
    return true;
  }

  return false;
}

function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isBlockedIPv4(address);
  }
  if (family === 6) {
    return isBlockedIPv6(address);
  }
  return false;
}

function toUrlValidationFailure(
  reason: ProviderUrlFailureReason,
  message: string,
  metadata: { scheme?: string; hostType?: 'blocked' | 'unknown' } = {}
): ProviderUrlValidationResult {
  return {
    safe: false,
    reason,
    message,
    metadata
  };
}

async function defaultDnsLookup(hostname: string) {
  const results = await dnsLookup(hostname, {
    all: true,
    verbatim: true
  });
  return results.map((result) => ({
    address: result.address,
    family: result.family as 4 | 6
  }));
}

export async function validateProviderBaseUrl(input: {
  settingKey: ProviderConfigSettingKey;
  provider: string;
  baseUrl: string;
  dnsLookup?: ProviderConfigDnsLookup | undefined;
}): Promise<ProviderUrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(input.baseUrl);
  } catch {
    return toUrlValidationFailure(
      'invalid_url',
      'Provider base URL is invalid',
      {
        hostType: 'unknown'
      }
    );
  }

  if (parsed.username || parsed.password) {
    return toUrlValidationFailure(
      'credentials_not_allowed',
      'Provider base URL must not contain credentials',
      { scheme: parsed.protocol, hostType: 'blocked' }
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return toUrlValidationFailure(
      'scheme_not_allowed',
      'Provider base URL scheme is not allowed',
      { scheme: parsed.protocol, hostType: 'blocked' }
    );
  }

  const hostname = normalizeProviderHostname(parsed.hostname);
  const localProviderException =
    isLocalProviderCapable(input.provider) && isLocalProviderHostname(hostname);
  const directIpFamily = isIP(hostname);

  if (
    !localProviderException &&
    directIpFamily !== 0 &&
    isBlockedIp(hostname)
  ) {
    return toUrlValidationFailure(
      'blocked_ip_range',
      'Provider base URL resolves to a blocked network range',
      { scheme: parsed.protocol, hostType: 'blocked' }
    );
  }

  if (parsed.protocol === 'http:' && !localProviderException) {
    return toUrlValidationFailure(
      'http_requires_local_provider_exception',
      'HTTP provider URLs are allowed only for explicit local provider hosts',
      { scheme: parsed.protocol, hostType: 'blocked' }
    );
  }

  if (localProviderException) {
    return {
      safe: true,
      normalizedUrl: normalizeBaseUrl(parsed),
      localProviderException: true,
      metadata: {
        scheme: parsed.protocol,
        hostType: 'local_provider_exception'
      }
    };
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return toUrlValidationFailure(
      'blocked_hostname',
      'Provider base URL host is not allowed',
      { scheme: parsed.protocol, hostType: 'blocked' }
    );
  }

  const addresses =
    directIpFamily === 0
      ? await (async () => {
          try {
            return await (input.dnsLookup ?? defaultDnsLookup)(hostname);
          } catch {
            return null;
          }
        })()
      : [{ address: hostname, family: directIpFamily as 4 | 6 }];

  if (!addresses || addresses.length === 0) {
    return toUrlValidationFailure(
      'dns_lookup_failed',
      'Provider base URL host could not be resolved safely',
      { scheme: parsed.protocol, hostType: 'unknown' }
    );
  }

  if (addresses.some((address) => isBlockedIp(address.address))) {
    return toUrlValidationFailure(
      'blocked_ip_range',
      'Provider base URL resolves to a blocked network range',
      { scheme: parsed.protocol, hostType: 'blocked' }
    );
  }

  return {
    safe: true,
    normalizedUrl: normalizeBaseUrl(parsed),
    localProviderException: false,
    metadata: {
      scheme: parsed.protocol,
      hostType: 'public'
    }
  };
}

function providerEndpoint(baseUrl: string, provider: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  return provider === 'ollama' ? `${trimmed}/api/tags` : `${trimmed}/models`;
}

function headersFromInit(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  const output: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      output[key] = value;
    }
    return output;
  }
  return { ...headers };
}

function responseHeadersFromNode(
  headers: Record<string, string | string[] | undefined>
): Headers {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        output.append(key, item);
      }
      continue;
    }
    if (value !== undefined) {
      output.set(key, value);
    }
  }
  return output;
}

async function pinnedAddressForFetch(input: {
  urlValidation: Extract<ProviderUrlValidationResult, { safe: true }>;
  dnsLookup?: ProviderConfigDnsLookup | undefined;
}): Promise<
  | { address: string; family: 4 | 6 }
  | { status: 'invalid'; reason: ProviderUrlFailureReason; message: string }
  | null
> {
  if (input.urlValidation.localProviderException) {
    return null;
  }

  const hostname = normalizeProviderHostname(
    new URL(input.urlValidation.normalizedUrl).hostname
  );
  const family = isIP(hostname);
  if (family !== 0) {
    return null;
  }

  let addresses: Array<{ address: string; family: 4 | 6 }>;
  try {
    addresses = await (input.dnsLookup ?? defaultDnsLookup)(hostname);
  } catch {
    return {
      status: 'invalid',
      reason: 'dns_lookup_failed',
      message: 'Provider base URL host could not be resolved safely'
    };
  }

  if (addresses.length === 0) {
    return {
      status: 'invalid',
      reason: 'dns_lookup_failed',
      message: 'Provider base URL host could not be resolved safely'
    };
  }

  const safe = addresses.filter((address) => !isBlockedIp(address.address));
  if (safe.length !== addresses.length || safe.length === 0) {
    return {
      status: 'invalid',
      reason: 'blocked_ip_range',
      message: 'Provider base URL resolves to a blocked network range'
    };
  }

  return safe[0] ?? null;
}

async function fetchWithPinnedAddress(
  requestUrl: string,
  init: RequestInit,
  pinnedAddress: { address: string; family: 4 | 6 } | null,
  timeoutMs?: number
): Promise<Response> {
  if (!pinnedAddress) {
    return fetchWithProviderTimeout(requestUrl, init, timeoutMs);
  }

  const parsed = new URL(requestUrl);
  const requester = parsed.protocol === 'http:' ? httpRequest : httpsRequest;

  return await new Promise<Response>((resolve, reject) => {
    const req = requester(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? 'GET',
        headers: headersFromInit(init.headers),
        lookup: (_hostname, _options, callback) => {
          callback(null, pinnedAddress.address, pinnedAddress.family);
        },
        servername: parsed.hostname
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const status = res.statusCode ?? 502;
          resolve(
            new Response(
              status === 204 || status === 304 ? null : Buffer.concat(chunks),
              {
                status,
                ...(res.statusMessage ? { statusText: res.statusMessage } : {}),
                headers: responseHeadersFromNode(res.headers)
              }
            )
          );
        });
        res.on('error', reject);
      }
    );

    const abort = () => {
      req.destroy(new Error('Provider connection aborted'));
    };
    if (init.signal) {
      if (init.signal.aborted) {
        abort();
      } else {
        init.signal.addEventListener('abort', abort, { once: true });
      }
    }

    if (timeoutMs !== undefined) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Provider connection timed out'));
      });
    }
    req.on('error', reject);
    if (typeof init.body === 'string' || Buffer.isBuffer(init.body)) {
      req.end(init.body);
      return;
    }
    if (init.body instanceof Uint8Array) {
      req.end(Buffer.from(init.body));
      return;
    }
    if (init.body instanceof ArrayBuffer) {
      req.end(Buffer.from(init.body));
      return;
    }
    if (init.body === undefined || init.body === null) {
      req.end();
      return;
    }
    reject(new Error('Unsupported provider request body'));
  });
}

async function fetchWithProviderTimeout(
  requestUrl: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  if (timeoutMs === undefined) {
    return await fetch(requestUrl, init);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) {
      abort();
    } else {
      init.signal.addEventListener('abort', abort, { once: true });
    }
  }

  try {
    return await fetch(requestUrl, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

function isRequestWithinBaseUrl(
  normalizedBaseUrl: string,
  requestUrl: string
): boolean {
  let base: URL;
  let request: URL;
  try {
    base = new URL(`${normalizedBaseUrl}/`);
    request = new URL(requestUrl);
  } catch {
    return false;
  }

  if (base.origin !== request.origin) {
    return false;
  }

  return request.pathname.startsWith(base.pathname);
}

export function createProviderPolicyFetch(input: {
  settingKey: ProviderConfigSettingKey;
  provider: string;
  baseUrl: string;
  dnsLookup?: ProviderConfigDnsLookup | undefined;
  fetchImpl?: ProviderConfigFetch | undefined;
  timeoutMs?: number | undefined;
}): ProviderConfigFetch {
  return async (requestUrl, init) => {
    const urlValidation = await validateProviderBaseUrl({
      settingKey: input.settingKey,
      provider: input.provider,
      baseUrl: input.baseUrl,
      dnsLookup: input.dnsLookup
    });
    if (!urlValidation.safe) {
      throw validationError(urlValidation.message, {
        field: input.settingKey,
        reason: urlValidation.reason
      });
    }

    if (!isRequestWithinBaseUrl(urlValidation.normalizedUrl, requestUrl)) {
      throw validationError('Provider request URL is outside validated base URL', {
        field: input.settingKey
      });
    }

    const pinnedAddress = input.fetchImpl
      ? null
      : await pinnedAddressForFetch({
          urlValidation,
          dnsLookup: input.dnsLookup
        });
    if (pinnedAddress && 'status' in pinnedAddress) {
      throw validationError(pinnedAddress.message, {
        field: input.settingKey,
        reason: pinnedAddress.reason
      });
    }

    const guardedInit = {
      ...init,
      redirect: 'manual'
    } satisfies RequestInit;
    const response = input.fetchImpl
      ? await input.fetchImpl(requestUrl, guardedInit)
      : await fetchWithPinnedAddress(
          requestUrl,
          guardedInit,
          pinnedAddress,
          input.timeoutMs
        );

    if (response.status >= 300 && response.status < 400) {
      throw validationError('Provider redirects are not followed', {
        field: input.settingKey,
        status: response.status
      });
    }

    return response;
  };
}

export async function testProviderConnection(input: {
  settingKey: ProviderConfigSettingKey;
  provider: string;
  baseUrl: string;
  apiKey?: string | undefined;
  dnsLookup?: ProviderConfigDnsLookup | undefined;
  fetchImpl?: ProviderConfigFetch | undefined;
}): Promise<ProviderConnectionResult> {
  const urlValidation = await validateProviderBaseUrl({
    settingKey: input.settingKey,
    provider: input.provider,
    baseUrl: input.baseUrl,
    dnsLookup: input.dnsLookup
  });

  if (!urlValidation.safe) {
    return {
      status: 'invalid',
      message: urlValidation.message,
      metadata: {
        egressPolicy: EGRESS_POLICY.id,
        reason: urlValidation.reason
      }
    };
  }

  const pinnedAddress = input.fetchImpl
    ? null
    : await pinnedAddressForFetch({
        urlValidation,
        dnsLookup: input.dnsLookup
      });
  if (pinnedAddress && 'status' in pinnedAddress) {
    return {
      status: pinnedAddress.status,
      message: pinnedAddress.message,
      metadata: {
        egressPolicy: EGRESS_POLICY.id,
        reason: pinnedAddress.reason
      }
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (input.apiKey) {
    headers['Authorization'] = `Bearer ${input.apiKey}`;
  }

  try {
    const endpoint = providerEndpoint(urlValidation.normalizedUrl, input.provider);
    const requestInit = {
      method: 'GET',
      headers,
      redirect: 'manual'
    } satisfies RequestInit;
    const response = input.fetchImpl
      ? await input.fetchImpl(endpoint, requestInit)
      : await fetchWithPinnedAddress(
          endpoint,
          requestInit,
          pinnedAddress,
          PROVIDER_CONNECTION_TIMEOUT_MS
        );

    if (response.status >= 300 && response.status < 400) {
      return {
        status: 'invalid',
        message: 'Provider redirects are not followed',
        metadata: {
          egressPolicy: EGRESS_POLICY.id,
          status: response.status
        }
      };
    }

    if (!response.ok) {
      return {
        status: 'error',
        message: `Provider connection failed with status ${response.status}`,
        metadata: {
          egressPolicy: EGRESS_POLICY.id,
          status: response.status
        }
      };
    }

    return {
      status: 'valid',
      message: 'Provider connection validated',
      metadata: {
        egressPolicy: EGRESS_POLICY.id,
        status: response.status
      }
    };
  } catch {
    return {
      status: 'error',
      message: 'Provider connection failed',
      metadata: {
        egressPolicy: EGRESS_POLICY.id,
        reason: 'request_failed'
      }
    };
  }
}

export function saveProviderConfiguration(
  pool: Pool,
  input: {
    settings: Record<string, unknown>;
    actorAdminUserId?: string | undefined;
    envConfig?: AppConfig | undefined;
  }
): ServiceResult<ProviderConfigurationSnapshot> {
  return ResultAsync.fromPromise(
    (async () => {
      const normalizedSettings = Object.entries(input.settings).map(
        ([rawKey, rawValue]) => {
          const key = requireProviderSettingKey(rawKey);
          return {
            key,
            definition: PROVIDER_SETTING_DEFINITIONS[key],
            value: normalizeProviderSettingValue(key, rawValue)
          };
        }
      );

      for (const { key, definition, value } of normalizedSettings) {
        const saved = await saveRuntimeSetting(pool, {
          key,
          value,
          classification: definition.classification,
          state: 'pending',
          actorAdminUserId: input.actorAdminUserId,
          validation: {
            status: 'unvalidated'
          }
        });

        if (saved.isErr()) {
          throw saved.error;
        }
      }

      const snapshot = await readProviderConfiguration(pool, {
        envConfig: input.envConfig
      });
      if (snapshot.isErr()) {
        throw snapshot.error;
      }
      return snapshot.value;
    })(),
    (error) => toAppError(error, 'Failed to save provider configuration')
  );
}

export function saveProviderSecret(
  pool: Pool,
  input: {
    name: string;
    plaintext: string;
    encryptionKey: string;
    actorAdminUserId?: string | undefined;
    validation?: RuntimeValidationInput | undefined;
  }
): ServiceResult<RuntimeSecretMetadata> {
  return ResultAsync.fromPromise(
    (async () => {
      const name = requireProviderSecretName(input.name);
      const definition = PROVIDER_SECRET_DEFINITIONS[name];
      const saved = await saveRuntimeSecret(pool, {
        name,
        plaintext: input.plaintext,
        provider: definition.provider,
        purpose: definition.purpose,
        encryptionKey: input.encryptionKey,
        actorAdminUserId: input.actorAdminUserId,
        validation: input.validation
      });

      if (saved.isErr()) {
        throw saved.error;
      }

      await invalidateConnectionValidationForSecret(pool, {
        name,
        actorAdminUserId: input.actorAdminUserId
      });

      return saved.value;
    })(),
    (error) => toAppError(error, 'Failed to save provider secret')
  );
}

async function invalidateConnectionValidationForSecret(
  pool: Pool,
  input: {
    name: ProviderSecretName;
    actorAdminUserId?: string | undefined;
  }
): Promise<void> {
  const affectedSettings: ProviderConfigSettingKey[] =
    input.name === 'EXTRACTION_API_KEY'
      ? ['EXTRACTION_BASE_URL']
      : input.name === 'OLLAMA_API_KEY'
        ? ['OLLAMA_BASE_URL']
        : input.name === 'EMBEDDING_API_KEY'
          ? ['EMBEDDING_BASE_URL', 'OLLAMA_BASE_URL']
          : [];

  for (const key of affectedSettings) {
    const existing = await getRuntimeSetting(pool, key);
    if (existing.isErr()) {
      throw existing.error;
    }
    if (!existing.value) {
      continue;
    }

    const updated = await updateRuntimeSettingValidation(pool, {
      key,
      status: 'unvalidated',
      message: 'Provider secret changed; run connection validation before apply',
      metadata: {
        egressPolicy: EGRESS_POLICY.id,
        reason: 'secret_changed',
        secret: input.name
      },
      actorAdminUserId: input.actorAdminUserId
    });
    if (updated.isErr()) {
      throw updated.error;
    }
  }
}

function emptyValidation(): RuntimeSettingRecord['validation'] {
  return {
    status: 'unvalidated',
    message: null,
    metadata: {},
    validatedAt: null
  };
}

function appliedAfterProcessStart(appliedAt: string | null): boolean {
  if (!appliedAt) {
    return false;
  }

  const appliedAtMs = Date.parse(appliedAt);
  return Number.isFinite(appliedAtMs) && appliedAtMs > PROCESS_STARTED_AT_MS;
}

function settingNeedsCurrentProcessRestart(
  setting: ProviderConfigSettingSnapshot
): boolean {
  return (
    setting.source === 'database' &&
    setting.restartRequired &&
    (setting.state === 'pending' ||
      (setting.state === 'applied' && appliedAfterProcessStart(setting.appliedAt)))
  );
}

function secretNeedsCurrentProcessRestart(
  secret: RuntimeSecretMetadata | null,
  activeSecretNames: ReadonlySet<ProviderSecretName>
): boolean {
  if (!secret || !activeSecretNames.has(secret.name as ProviderSecretName)) {
    return false;
  }

  const updatedAtMs = Date.parse(secret.updatedAt);
  return Number.isFinite(updatedAtMs) && updatedAtMs > PROCESS_STARTED_AT_MS;
}

function envValue(
  envConfig: AppConfig | undefined,
  key: ProviderConfigSettingKey
): JsonValue | undefined {
  if (!envConfig) {
    return undefined;
  }

  const value = envConfig[key as keyof AppConfig];
  return value === undefined ? undefined : (value as JsonValue);
}

export function readProviderConfiguration(
  pool: Pool,
  input: {
    envConfig?: AppConfig | undefined;
  }
): ServiceResult<ProviderConfigurationSnapshot> {
  return ResultAsync.fromPromise(
    (async () => {
      const settings = {} as Record<
        ProviderConfigSettingKey,
        ProviderConfigSettingSnapshot
      >;

      for (const key of PROVIDER_SETTING_KEYS) {
        const definition = PROVIDER_SETTING_DEFINITIONS[key];
        const found = await getRuntimeSetting(pool, key);
        if (found.isErr()) {
          throw found.error;
        }

        const row = found.value;
        if (row) {
          settings[key] = {
            key,
            value: row.value,
            source: 'database',
            classification: row.classification,
            state: row.state,
            validation: row.validation,
            restartRequired: definition.restartRequired,
            reembedRequired: definition.reembedRequired,
            appliedAt: row.appliedAt,
            updatedByAdminUserId: row.updatedByAdminUserId,
            updatedAt: row.updatedAt
          };
          continue;
        }

        const value = envValue(input.envConfig, key);
        settings[key] = {
          key,
          value,
          source: value === undefined ? 'unset' : 'env',
          classification: definition.classification,
          state: 'applied',
          validation: emptyValidation(),
          restartRequired: definition.restartRequired,
          reembedRequired: definition.reembedRequired,
          appliedAt: null,
          updatedByAdminUserId: null,
          updatedAt: null
        };
      }

      const secrets = {} as Record<
        ProviderSecretName,
        RuntimeSecretMetadata | null
      >;
      for (const name of PROVIDER_SECRET_NAMES) {
        const found = await getRuntimeSecretMetadata(pool, name);
        if (found.isErr()) {
          throw found.error;
        }
        secrets[name] = found.value;
      }

      const settingsNeedingRestart = Object.values(settings).filter(
        settingNeedsCurrentProcessRestart
      );

      const migrationRelevantSettings = Object.values(settings).filter(
        (setting) =>
          setting.reembedRequired &&
          setting.source === 'database' &&
          (setting.state === 'pending' ||
            (setting.state === 'applied' &&
              appliedAfterProcessStart(setting.appliedAt)))
      );
      const snapshotForRuntime = {
        settings,
        secrets,
        envSecrets: envSecretAvailability(input.envConfig),
        restartRequired: settingsNeedingRestart.length > 0,
        reembedRequired: false,
        egressPolicy: EGRESS_POLICY
      };
      if (migrationRelevantSettings.length > 0) {
        const targetEmbedding = targetEmbeddingIdentity(snapshotForRuntime);
        const currentEmbedding = await currentEmbeddingIdentity(pool);
        snapshotForRuntime.reembedRequired =
          currentEmbedding === null ||
          currentEmbedding.provider !== targetEmbedding.provider ||
          currentEmbedding.model !== targetEmbedding.model ||
          currentEmbedding.dimensions !== targetEmbedding.dimensions;
      }
      const target = targetRuntimeConfig(snapshotForRuntime, input.envConfig);
      const activeSecretNames = new Set(
        target ? providerSecretUsage(target).map((usage) => usage.name) : []
      );

      return {
        ...snapshotForRuntime,
        restartRequired:
          snapshotForRuntime.restartRequired ||
          Object.values(secrets).some((secret) =>
            secretNeedsCurrentProcessRestart(secret, activeSecretNames)
          )
      };
    })(),
    (error) => toAppError(error, 'Failed to read provider configuration')
  );
}

function settingString(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey
): string | undefined {
  const value = snapshot.settings[key].value;
  return typeof value === 'string' ? value : undefined;
}

function settingNumber(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey
): number | undefined {
  const value = snapshot.settings[key].value;
  return typeof value === 'number' ? value : undefined;
}

function settingBoolean(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey
): boolean | undefined {
  const value = snapshot.settings[key].value;
  return typeof value === 'boolean' ? value : undefined;
}

function hasPendingDatabaseSetting(
  snapshot: ProviderConfigurationSnapshot,
  keys: Set<ProviderConfigSettingKey>
): boolean {
  return Object.values(snapshot.settings).some(
    (setting) =>
      keys.has(setting.key) &&
      setting.source === 'database' &&
      setting.state === 'pending'
  );
}

async function currentEmbeddingIdentity(
  pool: Pool
): Promise<ConfiguredEmbeddingIdentity | null> {
  const result = await pool.query<{
    name: string;
    provider: string;
    dimensions: number;
  }>(
    `
      SELECT name, provider, dimensions
      FROM embedding_models
      WHERE is_active = true
      LIMIT 1
    `
  );

  const row = result.rows[0];
  return row
    ? {
        provider: row.provider,
        model: row.name,
        dimensions: row.dimensions
      }
    : null;
}

function targetEmbeddingIdentity(
  snapshot: ProviderConfigurationSnapshot
): ConfiguredEmbeddingIdentity {
  const provider = settingString(snapshot, 'EMBEDDING_PROVIDER') ?? 'openai';
  if (provider !== 'openai' && provider !== 'ollama') {
    throw validationError('Invalid embedding provider', {
      field: 'EMBEDDING_PROVIDER'
    });
  }

  const defaults = resolveEmbeddingDefaults(
    provider,
    settingString(snapshot, 'EMBEDDING_MODEL'),
    settingNumber(snapshot, 'EMBEDDING_DIMENSIONS')
  );

  return {
    provider,
    model: defaults.model,
    dimensions: defaults.dimensions
  };
}

async function embeddingIdentityAfterApply(
  pool: Pool,
  input: {
    envConfig?: AppConfig | undefined;
    settingsToApply: ReadonlyArray<{
      key: ProviderConfigSettingKey;
      value: JsonValue;
    }>;
  }
): Promise<ConfiguredEmbeddingIdentity> {
  const values = Object.fromEntries(
    Array.from(EMBEDDING_IDENTITY_KEYS).map((key) => [
      key,
      envValue(input.envConfig, key)
    ])
  ) as Partial<Record<ProviderConfigSettingKey, JsonValue>>;
  const applied = await pool.query<{
    key: ProviderConfigSettingKey;
    value: JsonValue;
  }>(
    `
      SELECT
        key,
        CASE
          WHEN state = 'applied' THEN value
          ELSE applied_value
        END AS value
      FROM admin_runtime_settings
      WHERE key = ANY($1::text[])
        AND (
          state = 'applied'
          OR applied_version > 0
          OR applied_value IS NOT NULL
        )
    `,
    [Array.from(EMBEDDING_IDENTITY_KEYS)]
  );

  for (const row of applied.rows) {
    values[row.key] = row.value;
  }
  for (const setting of input.settingsToApply) {
    if (EMBEDDING_IDENTITY_KEYS.has(setting.key)) {
      values[setting.key] = setting.value;
    }
  }

  const provider = values.EMBEDDING_PROVIDER ?? 'openai';
  if (provider !== 'openai' && provider !== 'ollama') {
    throw validationError('Invalid embedding provider', {
      field: 'EMBEDDING_PROVIDER'
    });
  }
  const model = values.EMBEDDING_MODEL;
  const dimensions = values.EMBEDDING_DIMENSIONS;
  const defaults = resolveEmbeddingDefaults(
    provider,
    typeof model === 'string' ? model : undefined,
    typeof dimensions === 'number' ? dimensions : undefined
  );

  return {
    provider,
    model: defaults.model,
    dimensions: defaults.dimensions
  };
}

function providerForUrlKey(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey
): string {
  if (key === 'EXTRACTION_BASE_URL') {
    return (
      settingString(snapshot, 'EXTRACTION_PROVIDER') ?? 'openai-compatible'
    );
  }
  return 'ollama';
}

function targetExtractionProvider(
  snapshot: ProviderConfigurationSnapshot
): string {
  return settingString(snapshot, 'EXTRACTION_PROVIDER') ?? 'openai';
}

function targetEmbeddingProvider(
  snapshot: ProviderConfigurationSnapshot
): string {
  return settingString(snapshot, 'EMBEDDING_PROVIDER') ?? 'openai';
}

function isProviderUrlRelevant(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey
): boolean {
  const extractionEnabled = settingBoolean(snapshot, 'EXTRACTION_ENABLED') ?? false;
  const extractionProvider = targetExtractionProvider(snapshot);
  const embeddingProvider = targetEmbeddingProvider(snapshot);

  switch (key) {
    case 'EXTRACTION_BASE_URL':
      return extractionEnabled && extractionProvider === 'openai-compatible';
    case 'OLLAMA_BASE_URL':
      return (
        (extractionEnabled && extractionProvider === 'ollama') ||
        (embeddingProvider === 'ollama' &&
          !settingString(snapshot, 'EMBEDDING_BASE_URL'))
      );
    case 'EMBEDDING_BASE_URL':
      return embeddingProvider === 'ollama';
    default:
      return false;
  }
}

function connectionValidationStatus(
  setting: { validation: RuntimeSettingRecord['validation'] }
): RuntimeValidationStatus | null {
  const metadata = setting.validation.metadata;
  const fromConnectionTest =
    metadata.connectionTest === true ||
    typeof metadata.connectionStatus === 'number';

  return fromConnectionTest ? setting.validation.status : null;
}

function sortedConnectionSecretNames(input: {
  snapshot: ProviderConfigurationSnapshot;
  settingKey: ProviderConfigSettingKey;
  provider: string;
}): ProviderSecretName[] {
  return connectionSecretNames(input).sort((left, right) =>
    left.localeCompare(right)
  );
}

function metadataStringArray(value: JsonValue | undefined): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length
    ? strings.sort((left, right) => left.localeCompare(right))
    : null;
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function metadataStringNullRecord(
  value: JsonValue | undefined
): Record<string, string | null> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const output: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' && item !== null) {
      return null;
    }
    output[key] = item;
  }
  return output;
}

function stringNullRecordsEqual(
  left: Record<string, string | null>,
  right: Record<string, string | null>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    stringArraysEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function connectionSecretRevisions(
  snapshot: ProviderConfigurationSnapshot,
  secretNames: readonly ProviderSecretName[]
): Record<string, string | null> {
  const revisions: Record<string, string | null> = {};
  for (const name of secretNames) {
    revisions[name] = snapshot.secrets[name]?.updatedAt ?? null;
  }
  return revisions;
}

function normalizedRuntimeUrlValue(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return normalizeBaseUrl(new URL(value));
  } catch {
    return null;
  }
}

function runtimeConnectionValidationStatus(
  setting: RuntimeSettingRecord,
  input: {
    runtimeValue: JsonValue | undefined;
    secretName: ProviderSecretName;
    secret: RuntimeSecretMetadata | null;
  }
): RuntimeValidationStatus | null {
  const status = connectionValidationStatus(setting);
  if (status === null) {
    return null;
  }

  const metadata = setting.validation.metadata;
  if (metadata.egressPolicy !== EGRESS_POLICY.id) {
    return null;
  }

  const runtimeNormalizedUrl = normalizedRuntimeUrlValue(input.runtimeValue);
  if (
    typeof metadata.connectionNormalizedUrl === 'string' &&
    metadata.connectionNormalizedUrl !== runtimeNormalizedUrl
  ) {
    return null;
  }

  const storedSecretRevisions = metadataStringNullRecord(
    metadata.connectionSecretRevisions
  );
  if (
    input.secret &&
    storedSecretRevisions &&
    storedSecretRevisions[input.secretName] !== input.secret.updatedAt
  ) {
    return null;
  }

  return status;
}

function secretUpdatedAfterSettingApplied(
  secret: RuntimeSecretMetadata | null,
  appliedAt: string | null
): boolean {
  if (!secret || !appliedAt) {
    return false;
  }

  const secretUpdatedAtMs = Date.parse(secret.updatedAt);
  const appliedAtMs = Date.parse(appliedAt);
  return (
    Number.isFinite(secretUpdatedAtMs) &&
    Number.isFinite(appliedAtMs) &&
    secretUpdatedAtMs > appliedAtMs
  );
}

function currentNormalizedProviderUrl(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey
): string | null {
  const value = settingString(snapshot, key);
  if (!value) {
    return null;
  }

  try {
    return normalizeBaseUrl(new URL(value));
  } catch {
    return null;
  }
}

function currentConnectionValidationStatus(
  snapshot: ProviderConfigurationSnapshot,
  key: ProviderConfigSettingKey,
  provider: string
): RuntimeValidationStatus | null {
  const setting = snapshot.settings[key];
  const status = connectionValidationStatus(setting);
  if (status === null) {
    return null;
  }

  const metadata = setting.validation.metadata;
  if (metadata.provider !== provider || metadata.egressPolicy !== EGRESS_POLICY.id) {
    return null;
  }

  const currentNormalizedUrl = currentNormalizedProviderUrl(snapshot, key);
  if (
    typeof metadata.connectionNormalizedUrl !== 'string' ||
    metadata.connectionNormalizedUrl !== currentNormalizedUrl
  ) {
    return null;
  }

  const expectedSecretNames = sortedConnectionSecretNames({
    snapshot,
    settingKey: key,
    provider
  });
  const storedSecretNames = metadataStringArray(metadata.connectionSecretNames);
  if (
    !storedSecretNames ||
    !stringArraysEqual(storedSecretNames, expectedSecretNames)
  ) {
    return null;
  }

  const expectedSecretRevisions = connectionSecretRevisions(
    snapshot,
    expectedSecretNames
  );
  const storedSecretRevisions = metadataStringNullRecord(
    metadata.connectionSecretRevisions
  );
  return storedSecretRevisions &&
    stringNullRecordsEqual(storedSecretRevisions, expectedSecretRevisions)
    ? status
    : null;
}

async function updateSettingValidationIfDatabaseBacked(
  pool: Pool,
  snapshot: ProviderConfigurationSnapshot,
  input: {
    key: ProviderConfigSettingKey;
    status: RuntimeValidationStatus;
    message: string;
    metadata?: Record<string, unknown> | undefined;
    actorAdminUserId?: string | undefined;
  }
): Promise<void> {
  const setting = snapshot.settings[input.key];
  if (setting.source !== 'database') {
    return;
  }

  const updated = await updateRuntimeSettingValidation(pool, {
    key: input.key,
    status: input.status,
    message: input.message,
    metadata: input.metadata,
    actorAdminUserId: input.actorAdminUserId
  });
  if (updated.isErr()) {
    throw updated.error;
  }
}

async function updateConnectionValidationIfCurrent(
  pool: Pool,
  snapshot: ProviderConfigurationSnapshot,
  input: {
    key: ProviderConfigSettingKey;
    status: RuntimeValidationStatus;
    message: string;
    metadata: Record<string, JsonValue>;
    secretNames: ProviderSecretName[];
    actorAdminUserId?: string | undefined;
  }
): Promise<boolean> {
  const setting = snapshot.settings[input.key];
  if (setting.source !== 'database' || setting.updatedAt === null) {
    return true;
  }

  const expectedSecretRevisions = connectionSecretRevisions(
    snapshot,
    input.secretNames
  );
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const currentSetting = await client.query<{
      value: JsonValue;
      updated_at: Date;
    }>(
      `
        SELECT value, updated_at
        FROM admin_runtime_settings
        WHERE key = $1
        FOR UPDATE
      `,
      [input.key]
    );
    const currentSettingUpdatedAt =
      currentSetting.rows[0]?.updated_at.toISOString() ?? null;
    if (
      currentSettingUpdatedAt !== setting.updatedAt ||
      !jsonValuesEqual(currentSetting.rows[0]?.value, setting.value)
    ) {
      await client.query('COMMIT');
      return false;
    }

    if (input.secretNames.length > 0) {
      const currentSecrets = await client.query<{
        name: string;
        updated_at: Date;
      }>(
        `
          SELECT name, updated_at
          FROM admin_runtime_secrets
          WHERE name = ANY($1::text[])
          FOR UPDATE
        `,
        [input.secretNames]
      );
      const currentSecretRevisions: Record<string, string | null> = {};
      for (const name of input.secretNames) {
        currentSecretRevisions[name] = null;
      }
      for (const row of currentSecrets.rows) {
        currentSecretRevisions[row.name] = row.updated_at.toISOString();
      }

      if (
        !stringNullRecordsEqual(
          currentSecretRevisions,
          expectedSecretRevisions
        )
      ) {
        await client.query('COMMIT');
        return false;
      }
    }

    const updated = await client.query(
      `
        UPDATE admin_runtime_settings
        SET
          validation_status = $2,
          validation_message = $3,
          validation_metadata = $4::jsonb,
          validated_at = $5,
          updated_by_admin_user_id = $6
        WHERE key = $1
      `,
      [
        input.key,
        input.status,
        input.message,
        JSON.stringify(input.metadata),
        new Date(),
        input.actorAdminUserId ?? null
      ]
    );
    if (updated.rowCount !== 1) {
      await client.query('COMMIT');
      return false;
    }

    await writeProviderConfigAudit(client, {
      adminUserId: input.actorAdminUserId ?? null,
      operation: 'admin.settings.validate',
      details: {
        key: input.key,
        validation_status: input.status
      }
    });
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function targetRuntimeConfig(
  snapshot: ProviderConfigurationSnapshot,
  envConfig: AppConfig | undefined
): AppConfig | null {
  if (!envConfig) {
    return null;
  }

  const target = { ...envConfig } as AppConfig;
  for (const setting of Object.values(snapshot.settings)) {
    if (setting.source === 'database' && setting.value !== undefined) {
      (target as unknown as Record<string, JsonValue>)[setting.key] =
        setting.value;
    }
  }

  return target;
}

function envSecretValue(
  envConfig: AppConfig | undefined,
  name: ProviderSecretName
): string | undefined {
  const value = envConfig?.[name as keyof AppConfig];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function runtimeSecretAvailability(
  pool: Pool,
  input: {
    envConfig: AppConfig | undefined;
    name: ProviderSecretName;
    encryptionKey?: string | undefined;
  }
): Promise<{ available: true } | { available: false; message: string }> {
  const metadata = await getRuntimeSecretMetadata(pool, input.name);
  if (metadata.isErr()) {
    throw metadata.error;
  }

  if (metadata.value) {
    if (!input.encryptionKey && envSecretValue(input.envConfig, input.name)) {
      return { available: true };
    }
    if (!input.encryptionKey) {
      return {
        available: false,
        message:
          'ADMIN_SETTINGS_ENCRYPTION_KEY is required to load stored provider secrets'
      };
    }

    const plaintext = await getRuntimeSecretPlaintext(pool, {
      name: input.name,
      encryptionKey: input.encryptionKey
    });
    if (plaintext.isErr() || plaintext.value === null) {
      if (envSecretValue(input.envConfig, input.name)) {
        return { available: true };
      }
      return {
        available: false,
        message:
          'ADMIN_SETTINGS_ENCRYPTION_KEY could not decrypt stored provider secret'
      };
    }

    return { available: true };
  }

  return envSecretValue(input.envConfig, input.name)
    ? { available: true }
    : {
        available: false,
        message: `${input.name} is required for this provider configuration`
      };
}

async function validateTargetRuntimeConstructibility(
  pool: Pool,
  snapshot: ProviderConfigurationSnapshot,
  input: {
    envConfig: AppConfig | undefined;
    encryptionKey?: string | undefined;
  }
): Promise<ProviderValidationResult['runtime']> {
  const target = targetRuntimeConfig(snapshot, input.envConfig);
  const errors: ProviderValidationResult['runtime']['errors'] = [];

  if (!target) {
    return {
      constructible: false,
      errors: [
        {
          field: 'envConfig',
          message:
            'Runtime env config is required to validate provider startup construction'
        }
      ]
    };
  }
  const runtimeEnvConfig = target;

  if (
    runtimeEnvConfig.EMBEDDING_MODEL &&
    runtimeEnvConfig.EMBEDDING_DIMENSIONS === undefined
  ) {
    errors.push({
      field: 'EMBEDDING_DIMENSIONS',
      message:
        'EMBEDDING_DIMENSIONS is required when EMBEDDING_MODEL is configured'
    });
  }

  async function requireSecret(
    name: ProviderSecretName,
    message: string
  ): Promise<void> {
    const availability = await runtimeSecretAvailability(pool, {
      envConfig: runtimeEnvConfig,
      name,
      encryptionKey: input.encryptionKey
    });
    if (!availability.available) {
      const secretStateMessage = availability.message.startsWith(
        'ADMIN_SETTINGS_ENCRYPTION_KEY'
      )
        ? availability.message
        : message;
      errors.push({
        field: name,
        message: secretStateMessage
      });
    }
  }

  async function validateOptionalStoredSecret(
    name: ProviderSecretName
  ): Promise<void> {
    const metadata = await getRuntimeSecretMetadata(pool, name);
    if (metadata.isErr()) {
      throw metadata.error;
    }
    if (!metadata.value || !input.encryptionKey) {
      return;
    }

    const availability = await runtimeSecretAvailability(pool, {
      envConfig: runtimeEnvConfig,
      name,
      encryptionKey: input.encryptionKey
    });
    if (!availability.available) {
      errors.push({
        field: name,
        message: availability.message
      });
    }
  }

  if (runtimeEnvConfig.EMBEDDING_PROVIDER === 'openai') {
    await requireSecret(
      'OPENAI_API_KEY',
      'OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai'
    );
  }

  if (runtimeEnvConfig.EXTRACTION_ENABLED) {
    switch (runtimeEnvConfig.EXTRACTION_PROVIDER) {
      case 'openai':
        await requireSecret(
          'OPENAI_API_KEY',
          'OPENAI_API_KEY is required for openai extraction provider'
        );
        break;
      case 'anthropic':
        await requireSecret(
          'ANTHROPIC_API_KEY',
          'ANTHROPIC_API_KEY is required for anthropic extraction provider'
        );
        break;
      case 'openai-compatible':
        if (!runtimeEnvConfig.EXTRACTION_BASE_URL) {
          errors.push({
            field: 'EXTRACTION_BASE_URL',
            message:
              'EXTRACTION_BASE_URL is required for openai-compatible extraction provider'
          });
        }
        break;
      case 'ollama':
        break;
    }
  }

  for (const usage of providerSecretUsage(runtimeEnvConfig)) {
    if (!usage.required) {
      await validateOptionalStoredSecret(usage.name);
    }
  }

  return {
    constructible: errors.length === 0,
    errors
  };
}

export function validateProviderConfiguration(
  pool: Pool,
  input: {
    actorAdminUserId?: string | undefined;
    envConfig?: AppConfig | undefined;
    encryptionKey?: string | undefined;
    dnsLookup?: ProviderConfigDnsLookup | undefined;
    fetchImpl?: ProviderConfigFetch | undefined;
    testConnections?: boolean | undefined;
  }
): ServiceResult<ProviderValidationResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const snapshotResult = await readProviderConfiguration(pool, {
        envConfig: input.envConfig
      });
      if (snapshotResult.isErr()) {
        throw snapshotResult.error;
      }
      const snapshot = snapshotResult.value;
      const connectionTests: Partial<
        Record<ProviderConfigSettingKey, ProviderConnectionResult>
      > = {};
      let invalid = false;
      let error = false;

      for (const key of PROVIDER_SETTING_KEYS) {
        if (!PROVIDER_URL_KEYS.has(key)) {
          continue;
        }

        const value = settingString(snapshot, key);
        if (!value) {
          continue;
        }
        if (!isProviderUrlRelevant(snapshot, key)) {
          continue;
        }

        const provider = providerForUrlKey(snapshot, key);
        const urlValidation = await validateProviderBaseUrl({
          settingKey: key,
          provider,
          baseUrl: value,
          dnsLookup: input.dnsLookup
        });

        if (!urlValidation.safe) {
          invalid = true;
          await updateSettingValidationIfDatabaseBacked(pool, snapshot, {
            key,
            status: 'invalid',
            message: urlValidation.message,
            metadata: {
              provider,
              egressPolicy: EGRESS_POLICY.id,
              reason: urlValidation.reason
            },
            actorAdminUserId: input.actorAdminUserId
          });
          continue;
        }

        const priorConnectionStatus = currentConnectionValidationStatus(
          snapshot,
          key,
          provider
        );
        if (!input.testConnections && priorConnectionStatus !== null) {
          if (priorConnectionStatus === 'invalid') {
            invalid = true;
          }
          if (priorConnectionStatus === 'error') {
            error = true;
          }
          continue;
        }

        if (input.testConnections) {
          const secretNames = sortedConnectionSecretNames({
            snapshot,
            settingKey: key,
            provider
          });
          const apiKeys = await connectionApiKeys(pool, {
            snapshot,
            settingKey: key,
            provider,
            envConfig: input.envConfig,
            encryptionKey: input.encryptionKey
          });
          const testedConnections: ProviderConnectionResult[] = [];
          for (const apiKey of apiKeys) {
            testedConnections.push(
              await testProviderConnection({
                settingKey: key,
                provider,
                baseUrl: value,
                apiKey,
                dnsLookup: input.dnsLookup,
                fetchImpl: input.fetchImpl
              })
            );
          }
          const connection = combineConnectionResults(testedConnections);
          connectionTests[key] = connection;
          if (connection.status === 'invalid') {
            invalid = true;
          }
          if (connection.status === 'error') {
            error = true;
          }
          const validationCurrent = await updateConnectionValidationIfCurrent(pool, snapshot, {
            key,
            status: connection.status,
            message: connection.message,
            metadata: {
              provider,
              egressPolicy: EGRESS_POLICY.id,
              connectionTest: true,
              connectionNormalizedUrl: urlValidation.normalizedUrl,
              connectionSecretNames: secretNames,
              connectionSecretRevisions: connectionSecretRevisions(
                snapshot,
                secretNames
              ),
              ...(typeof connection.metadata.status === 'number'
                ? { connectionStatus: connection.metadata.status }
                : {}),
              ...(typeof connection.metadata.reason === 'string'
                ? { reason: connection.metadata.reason }
                : {}),
              ...(apiKeys.length > 1 ? { credentialTests: apiKeys.length } : {})
            },
            secretNames,
            actorAdminUserId: input.actorAdminUserId
          });
          if (!validationCurrent) {
            error = true;
            connectionTests[key] = {
              status: 'error',
              message:
                'Provider configuration changed during validation; rerun validation',
              metadata: {
                reason: 'stale_validation'
              }
            };
          }
          continue;
        }

        await updateSettingValidationIfDatabaseBacked(pool, snapshot, {
          key,
          status: 'unvalidated',
          message:
            'Provider base URL accepted by egress policy; run connection validation before apply',
          metadata: {
            provider,
            egressPolicy: EGRESS_POLICY.id,
            localProviderException: urlValidation.localProviderException
          },
          actorAdminUserId: input.actorAdminUserId
        });
      }

      const embeddingTarget = hasPendingDatabaseSetting(
        snapshot,
        EMBEDDING_IDENTITY_KEYS
      )
        ? targetEmbeddingIdentity(snapshot)
        : null;
      const embeddingCurrent = embeddingTarget
        ? await currentEmbeddingIdentity(pool)
        : null;
      const embeddingMismatch = embeddingTarget
        ? await assertEmbeddingDimensionAgreement(pool, embeddingTarget)
        : null;
      const reembedRequired = embeddingMismatch !== null;
      const restartRequired = Object.values(snapshot.settings).some(
        (setting) =>
          setting.source === 'database' &&
          setting.state === 'pending' &&
          setting.restartRequired
      );
      const runtime = await validateTargetRuntimeConstructibility(
        pool,
        snapshot,
        {
          envConfig: input.envConfig,
          encryptionKey: input.encryptionKey
        }
      );
      if (!runtime.constructible) {
        invalid = true;
      }

      return {
        status: invalid
          ? 'invalid'
          : error
            ? 'error'
            : reembedRequired
              ? 'requires_reembedding'
              : 'valid',
        restartRequired,
        reembedRequired,
        connectionTests,
        runtime,
        embedding: {
          current: embeddingCurrent,
          target: embeddingTarget
        }
      };
    })(),
    (error) => toAppError(error, 'Failed to validate provider configuration')
  );
}

function connectionSecretNames(input: {
  snapshot: ProviderConfigurationSnapshot;
  settingKey: ProviderConfigSettingKey;
  provider: string;
}): ProviderSecretName[] {
  if (input.settingKey === 'EXTRACTION_BASE_URL') {
    return input.provider === 'openai-compatible' ? ['EXTRACTION_API_KEY'] : [];
  }

  if (input.settingKey === 'EMBEDDING_BASE_URL') {
    return ['EMBEDDING_API_KEY'];
  }

  if (input.settingKey !== 'OLLAMA_BASE_URL') {
    return [];
  }

  const names: ProviderSecretName[] = [];
  if (
    targetEmbeddingProvider(input.snapshot) === 'ollama' &&
    !settingString(input.snapshot, 'EMBEDDING_BASE_URL')
  ) {
    names.push('EMBEDDING_API_KEY');
  }
  if (
    (settingBoolean(input.snapshot, 'EXTRACTION_ENABLED') ?? false) &&
    targetExtractionProvider(input.snapshot) === 'ollama'
  ) {
    names.push('OLLAMA_API_KEY');
  }

  return names;
}

async function providerConnectionApiKey(
  pool: Pool,
  input: {
    secretName: ProviderSecretName;
    envConfig?: AppConfig | undefined;
    encryptionKey?: string | undefined;
  }
): Promise<string | undefined> {
  const metadata = await getRuntimeSecretMetadata(pool, input.secretName);
  if (metadata.isErr()) {
    throw metadata.error;
  }
  if (!metadata.value) {
    return envSecretValue(input.envConfig, input.secretName);
  }
  if (!input.encryptionKey) {
    throw new AppError(
      ErrorCode.INTERNAL,
      'Admin settings encryption key is required to test stored provider secrets',
      { secret: input.secretName }
    );
  }

  const plaintext = await getRuntimeSecretPlaintext(pool, {
    name: input.secretName,
    encryptionKey: input.encryptionKey
  });
  if (plaintext.isErr()) {
    throw plaintext.error;
  }

  return plaintext.value ?? undefined;
}

async function connectionApiKeys(
  pool: Pool,
  input: {
    snapshot: ProviderConfigurationSnapshot;
    settingKey: ProviderConfigSettingKey;
    provider: string;
    envConfig?: AppConfig | undefined;
    encryptionKey?: string | undefined;
  }
): Promise<Array<string | undefined>> {
  const secretNames = connectionSecretNames(input);
  if (secretNames.length === 0) {
    return [undefined];
  }

  const values: Array<string | undefined> = [];
  const seen = new Set<string>();
  for (const secretName of secretNames) {
    const apiKey = await providerConnectionApiKey(pool, {
      secretName,
      envConfig: input.envConfig,
      encryptionKey: input.encryptionKey
    });
    const dedupeKey = apiKey ?? '<no-provider-api-key>';
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      values.push(apiKey);
    }
  }

  return values.length > 0 ? values : [undefined];
}

function combineConnectionResults(
  results: ProviderConnectionResult[]
): ProviderConnectionResult {
  const invalid = results.find((result) => result.status === 'invalid');
  if (invalid) {
    return invalid;
  }

  const error = results.find((result) => result.status === 'error');
  if (error) {
    return error;
  }

  return results[0] ?? {
    status: 'valid',
    message: 'Provider connection validated',
    metadata: {
      egressPolicy: EGRESS_POLICY.id
    }
  };
}

async function storedSecretReadyForRuntime(
  pool: Pool,
  input: {
    name: ProviderSecretName;
    runtimeConfig: AppConfig;
  }
): Promise<boolean> {
  const secret = await getRuntimeSecretMetadata(pool, input.name);
  if (secret.isErr()) {
    throw secret.error;
  }

  const relatedSettings: ProviderConfigSettingKey[] =
    input.name === 'EXTRACTION_API_KEY' &&
    input.runtimeConfig.EXTRACTION_ENABLED &&
    input.runtimeConfig.EXTRACTION_PROVIDER === 'openai-compatible'
      ? ['EXTRACTION_BASE_URL']
      : input.name === 'OLLAMA_API_KEY' &&
          input.runtimeConfig.EXTRACTION_ENABLED &&
          input.runtimeConfig.EXTRACTION_PROVIDER === 'ollama'
        ? ['OLLAMA_BASE_URL']
        : input.name === 'EMBEDDING_API_KEY' &&
            input.runtimeConfig.EMBEDDING_PROVIDER === 'ollama'
          ? input.runtimeConfig.EMBEDDING_BASE_URL
            ? ['EMBEDDING_BASE_URL']
            : ['OLLAMA_BASE_URL']
          : [];

  for (const key of relatedSettings) {
    const setting = await getRuntimeSetting(pool, key);
    if (setting.isErr()) {
      throw setting.error;
    }
    if (!setting.value) {
      continue;
    }

    const runtimeValue = (input.runtimeConfig as unknown as Record<
      string,
      JsonValue
    >)[key];
    const runtimeValidationStatus = runtimeConnectionValidationStatus(
      setting.value,
      {
        runtimeValue,
        secretName: input.name,
        secret: secret.value
      }
    );

    if (setting.value.state === 'applied') {
      if (
        jsonValuesEqual(setting.value.value, runtimeValue) &&
        runtimeValidationStatus !== 'valid'
      ) {
        return false;
      }
      continue;
    }

    if (
      setting.value.appliedVersion > 0 &&
      jsonValuesEqual(setting.value.appliedValue ?? undefined, runtimeValue) &&
      secretUpdatedAfterSettingApplied(secret.value, setting.value.appliedAt) &&
      runtimeValidationStatus !== 'valid'
    ) {
      return false;
    }
  }

  return true;
}

async function writeProviderConfigAudit(
  executor: PoolClient,
  input: {
    adminUserId: string | null;
    operation: string;
    details: Record<string, JsonValue>;
  }
): Promise<void> {
  await executor.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, NULL, $3)
    `,
    [input.adminUserId, input.operation, input.details]
  );
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original service error.
  }
}

function pendingUrlSettingsMissingConnectionValidation(
  snapshot: ProviderConfigurationSnapshot
): ProviderConfigSettingKey[] {
  return Object.values(snapshot.settings)
    .filter(
      (setting) => {
        if (
          setting.source !== 'database' ||
          !PROVIDER_URL_KEYS.has(setting.key) ||
          !isProviderUrlRelevant(snapshot, setting.key)
        ) {
          return false;
        }

        const provider = providerForUrlKey(snapshot, setting.key);
        return (
          currentConnectionValidationStatus(snapshot, setting.key, provider) !==
          'valid'
        );
      }
    )
    .map((setting) => setting.key)
    .sort();
}

function jsonValuesEqual(
  left: JsonValue | undefined,
  right: JsonValue | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type ProviderSecretUsage = {
  name: ProviderSecretName;
  required: boolean;
};

function addSecretUsage(
  usages: Map<ProviderSecretName, ProviderSecretUsage>,
  name: ProviderSecretName,
  required: boolean
): void {
  const existing = usages.get(name);
  usages.set(name, {
    name,
    required: required || existing?.required === true
  });
}

function providerSecretUsage(config: AppConfig): ProviderSecretUsage[] {
  const usages = new Map<ProviderSecretName, ProviderSecretUsage>();

  if (config.EMBEDDING_PROVIDER === 'openai') {
    addSecretUsage(usages, 'OPENAI_API_KEY', true);
  }
  if (config.EMBEDDING_PROVIDER === 'ollama') {
    addSecretUsage(usages, 'EMBEDDING_API_KEY', false);
  }

  if (config.EXTRACTION_ENABLED) {
    switch (config.EXTRACTION_PROVIDER) {
      case 'openai':
        addSecretUsage(usages, 'OPENAI_API_KEY', true);
        break;
      case 'anthropic':
        addSecretUsage(usages, 'ANTHROPIC_API_KEY', true);
        break;
      case 'openai-compatible':
        addSecretUsage(usages, 'EXTRACTION_API_KEY', false);
        break;
      case 'ollama':
        addSecretUsage(usages, 'OLLAMA_API_KEY', false);
        break;
    }
  }

  return Array.from(usages.values());
}

function activeSecretRestartImpacts(
  snapshot: ProviderConfigurationSnapshot,
  envConfig: AppConfig | undefined
): {
  restartRequired: boolean;
  extraction: boolean;
  embedding: boolean;
} {
  const target = targetRuntimeConfig(snapshot, envConfig);
  if (!target) {
    return { restartRequired: false, extraction: false, embedding: false };
  }

  const changed = (name: ProviderSecretName): boolean =>
    secretNeedsCurrentProcessRestart(snapshot.secrets[name], new Set([name]));

  const embedding =
    (target.EMBEDDING_PROVIDER === 'openai' && changed('OPENAI_API_KEY')) ||
    (target.EMBEDDING_PROVIDER === 'ollama' && changed('EMBEDDING_API_KEY'));
  const extraction =
    target.EXTRACTION_ENABLED &&
    ((target.EXTRACTION_PROVIDER === 'openai' && changed('OPENAI_API_KEY')) ||
      (target.EXTRACTION_PROVIDER === 'anthropic' &&
        changed('ANTHROPIC_API_KEY')) ||
      (target.EXTRACTION_PROVIDER === 'openai-compatible' &&
        changed('EXTRACTION_API_KEY')) ||
      (target.EXTRACTION_PROVIDER === 'ollama' && changed('OLLAMA_API_KEY')));

  return {
    restartRequired: embedding || extraction,
    extraction,
    embedding
  };
}

export function applyProviderConfiguration(
  pool: Pool,
  input: {
    actorAdminUserId?: string | undefined;
    envConfig?: AppConfig | undefined;
    encryptionKey?: string | undefined;
    dnsLookup?: ProviderConfigDnsLookup | undefined;
  }
): ServiceResult<ProviderApplyResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const validatedSnapshot = await readProviderConfiguration(pool, {
        envConfig: input.envConfig
      });
      if (validatedSnapshot.isErr()) {
        throw validatedSnapshot.error;
      }
      const validatedPendingValues = new Map<
        ProviderConfigSettingKey,
        JsonValue | undefined
      >(
        Object.values(validatedSnapshot.value.settings)
          .filter(
            (
              setting
            ): setting is ProviderConfigSettingSnapshot & {
              source: 'database';
              state: 'pending';
            } =>
              setting.source === 'database' && setting.state === 'pending'
          )
          .map((setting) => [setting.key, setting.value])
      );

      const validation = await validateProviderConfiguration(pool, {
        actorAdminUserId: input.actorAdminUserId,
        envConfig: input.envConfig,
        encryptionKey: input.encryptionKey,
        dnsLookup: input.dnsLookup,
        testConnections: false
      });
      if (validation.isErr()) {
        throw validation.error;
      }

      if (
        validation.value.status === 'invalid' ||
        validation.value.status === 'error'
      ) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'Provider configuration validation must pass before apply',
          { status: validation.value.status }
        );
      }

      const snapshotForApply = await readProviderConfiguration(pool, {
        envConfig: input.envConfig
      });
      if (snapshotForApply.isErr()) {
        throw snapshotForApply.error;
      }
      const missingConnectionValidation =
        pendingUrlSettingsMissingConnectionValidation(snapshotForApply.value);
      if (missingConnectionValidation.length > 0) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'Provider connection validation must pass before apply',
          {
            settings: missingConnectionValidation
          }
        );
      }
      const changedValidatedSettings = Array.from(validatedPendingValues)
        .filter(([key, value]) => {
          const current = snapshotForApply.value.settings[key];
          return !(
            current.source === 'database' &&
            current.state === 'pending' &&
            jsonValuesEqual(current.value, value)
          );
        })
        .map(([key]) => key)
        .sort();
      if (changedValidatedSettings.length > 0) {
        throw new AppError(
          ErrorCode.CONFLICT,
          'Provider settings changed during apply; revalidate before applying',
          {
            expectedSettings: Array.from(validatedPendingValues.keys()).sort(),
            changedSettings: changedValidatedSettings
          }
        );
      }
      const settingsToApply = Object.values(snapshotForApply.value.settings)
        .filter(
          (
            setting
          ): setting is ProviderConfigSettingSnapshot & {
            source: 'database';
            state: 'pending';
            updatedAt: string;
            value: JsonValue;
          } =>
            setting.source === 'database' &&
            setting.state === 'pending' &&
            setting.updatedAt !== null &&
            setting.value !== undefined &&
            validatedPendingValues.has(setting.key) &&
            jsonValuesEqual(
              setting.value,
              validatedPendingValues.get(setting.key)
            )
        )
        .sort((left, right) => left.key.localeCompare(right.key));
      const appliesEmbeddingIdentity = settingsToApply.some((setting) =>
        EMBEDDING_IDENTITY_KEYS.has(setting.key)
      );
      const hasRecentlyAppliedEmbeddingIdentity = Object.values(
        snapshotForApply.value.settings
      ).some(
        (setting) =>
          EMBEDDING_IDENTITY_KEYS.has(setting.key) &&
          setting.source === 'database' &&
          appliedAfterProcessStart(setting.appliedAt)
      );
      let reembedRequired = false;
      if (appliesEmbeddingIdentity || hasRecentlyAppliedEmbeddingIdentity) {
        const targetEmbedding = await embeddingIdentityAfterApply(pool, {
          envConfig: input.envConfig,
          settingsToApply
        });
        const currentEmbedding = await currentEmbeddingIdentity(pool);
        reembedRequired =
          currentEmbedding === null ||
          currentEmbedding.provider !== targetEmbedding.provider ||
          currentEmbedding.model !== targetEmbedding.model ||
          currentEmbedding.dimensions !== targetEmbedding.dimensions;
      }
      const expectedApplyRows = settingsToApply.map((setting) => ({
        key: setting.key,
        value: setting.value,
        validation_status: setting.validation.status,
        validation_metadata: setting.validation.metadata,
        validated_at: setting.validation.validatedAt
      }));

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let appliedSettings: ProviderConfigSettingKey[] = [];

        if (settingsToApply.length > 0) {
          const applied = await client.query<{ key: ProviderConfigSettingKey }>(
            `
              WITH validated_pending AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS expected(
                  key text,
                  value jsonb,
                  validation_status text,
                  validation_metadata jsonb,
                  validated_at timestamptz
                )
              )
              UPDATE admin_runtime_settings
              SET
                state = 'applied',
                applied_value = admin_runtime_settings.value,
                applied_version = applied_version + 1,
                applied_at = statement_timestamp(),
                updated_by_admin_user_id = $2,
                updated_at = statement_timestamp()
              FROM validated_pending
              WHERE admin_runtime_settings.key = validated_pending.key
                AND admin_runtime_settings.state = 'pending'
                AND admin_runtime_settings.value = validated_pending.value
                AND admin_runtime_settings.validation_status = validated_pending.validation_status
                AND admin_runtime_settings.validation_metadata = validated_pending.validation_metadata
                AND admin_runtime_settings.validated_at IS NOT DISTINCT FROM validated_pending.validated_at
              RETURNING admin_runtime_settings.key
            `,
            [
              JSON.stringify(expectedApplyRows),
              input.actorAdminUserId ?? null
            ]
          );
          appliedSettings = applied.rows.map((row) => row.key).sort();
          if (appliedSettings.length !== settingsToApply.length) {
            throw new AppError(
              ErrorCode.CONFLICT,
              'Provider settings changed during apply; revalidate before applying',
              {
                expectedSettings: settingsToApply.map((setting) => setting.key),
                appliedSettings
              }
            );
          }
        }

        const secretRestart = activeSecretRestartImpacts(
          snapshotForApply.value,
          input.envConfig
        );
        const restartRequired =
          appliedSettings.some(
            (key) => PROVIDER_SETTING_DEFINITIONS[key].restartRequired
          ) || secretRestart.restartRequired;
        const sharedOllamaUsedForEmbedding =
          appliedSettings.includes('OLLAMA_BASE_URL') &&
          targetEmbeddingProvider(snapshotForApply.value) === 'ollama' &&
          !settingString(snapshotForApply.value, 'EMBEDDING_BASE_URL');
        const sharedOllamaUsedForExtraction =
          appliedSettings.includes('OLLAMA_BASE_URL') &&
          (settingBoolean(snapshotForApply.value, 'EXTRACTION_ENABLED') ??
            false) &&
          targetExtractionProvider(snapshotForApply.value) === 'ollama';
        const extractionChanged =
          appliedSettings.some((key) => key.startsWith('EXTRACTION_')) ||
          sharedOllamaUsedForExtraction ||
          secretRestart.extraction;
        const embeddingChanged =
          appliedSettings.some((key) => key.startsWith('EMBEDDING_')) ||
          sharedOllamaUsedForEmbedding ||
          secretRestart.embedding;

        await writeProviderConfigAudit(client, {
          adminUserId: input.actorAdminUserId ?? null,
          operation: 'admin.provider_config.apply',
          details: {
            applied_settings: appliedSettings,
            restart_required: restartRequired,
            secret_restart_required: secretRestart.restartRequired,
            reembed_required: reembedRequired,
            extraction_reload: extractionChanged
              ? 'restart_required'
              : 'unchanged',
            embedding_reload: embeddingChanged
              ? 'restart_required'
              : 'unchanged'
          }
        });

        await client.query('COMMIT');
        return {
          applied: true,
          restartRequired,
          reembedRequired,
          reload: {
            extraction: extractionChanged ? 'restart_required' : 'unchanged',
            embedding: embeddingChanged ? 'restart_required' : 'unchanged'
          },
          appliedSettings
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to apply provider configuration')
  );
}

export function resolveRuntimeProviderConfig(
  pool: Pool,
  input: {
    envConfig: AppConfig;
    encryptionKey?: string | undefined;
  }
): ServiceResult<AppConfig> {
  return ResultAsync.fromPromise(
    (async () => {
      const resolved = { ...input.envConfig } as AppConfig;
      const settings = await pool.query<{
        key: ProviderConfigSettingKey;
        value: JsonValue;
      }>(
        `
          SELECT
            key,
            CASE
              WHEN state = 'applied' THEN value
              ELSE applied_value
            END AS value
          FROM admin_runtime_settings
          WHERE key = ANY($1::text[])
            AND (
              state = 'applied'
              OR applied_version > 0
              OR applied_value IS NOT NULL
            )
        `,
        [PROVIDER_SETTING_KEYS]
      );

      for (const row of settings.rows) {
        (resolved as unknown as Record<string, JsonValue>)[row.key] = row.value;
      }

      for (const { name, required } of providerSecretUsage(resolved)) {
        const metadata = await getRuntimeSecretMetadata(pool, name);
        if (metadata.isErr()) {
          throw metadata.error;
        }
        if (!metadata.value) {
          continue;
        }
        const ready = await storedSecretReadyForRuntime(pool, {
          name,
          runtimeConfig: resolved
        });
        if (!ready) {
          if (envSecretValue(resolved, name)) {
            continue;
          }
          if (!required) {
            continue;
          }
          throw new AppError(
            ErrorCode.VALIDATION,
            'Stored provider secret must be validated before runtime use',
            { secret: name }
          );
        }
        if (!input.encryptionKey) {
          if (envSecretValue(resolved, name)) {
            continue;
          }
          if (!required) {
            continue;
          }
          throw new AppError(
            ErrorCode.INTERNAL,
            'Admin settings encryption key is required to load stored provider secrets',
            { secret: name }
          );
        }

        const plaintext = await getRuntimeSecretPlaintext(pool, {
          name,
          encryptionKey: input.encryptionKey
        });
        if (plaintext.isErr()) {
          if (envSecretValue(resolved, name) || !required) {
            continue;
          }
          throw plaintext.error;
        }
        if (plaintext.value === null) {
          if (envSecretValue(resolved, name) || !required) {
            continue;
          }
          throw new AppError(
            ErrorCode.INTERNAL,
            'Stored provider secret could not be loaded',
            { secret: name }
          );
        }
        (resolved as unknown as Record<string, string>)[name] = plaintext.value;
      }

      return resolved;
    })(),
    (error) => toAppError(error, 'Failed to resolve runtime provider config')
  );
}

export function readAppliedProviderSettingKeys(
  pool: Pool
): ServiceResult<ProviderConfigSettingKey[]> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<{ key: ProviderConfigSettingKey }>(
        `
          SELECT key
          FROM admin_runtime_settings
          WHERE key = ANY($1::text[])
            AND (
              state = 'applied'
              OR applied_version > 0
              OR applied_value IS NOT NULL
            )
          ORDER BY key ASC
        `,
        [PROVIDER_SETTING_KEYS]
      );

      return result.rows.map((row) => row.key);
    })(),
    (error) => toAppError(error, 'Failed to read applied provider settings')
  );
}
