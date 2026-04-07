export interface DetectedBase64Image {
  base64Data: string;
  dataUrl: string;
  mimeType: string;
  path: string;
  sizeBytes: number;
  sourceType: 'data-url' | 'raw-base64';
}

interface DetectBase64ImageOptions {
  maxDepth?: number;
  maxImages?: number;
  minRawBase64Length?: number;
  parseJsonString?: boolean;
}

const DEFAULT_OPTIONS: Required<DetectBase64ImageOptions> = {
  maxDepth: 24,
  maxImages: 120,
  minRawBase64Length: 96,
  parseJsonString: true,
};

const BASE64_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

const isLikelyJsonString = (value: string) => {
  const text = value.trim();
  if (!text) return false;
  return (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  );
};

const buildObjectPath = (parentPath: string, key: string) => {
  if (/^[A-Z_$][\w$]*$/i.test(key)) {
    return parentPath === '$' ? `$.${key}` : `${parentPath}.${key}`;
  }
  const escapedKey = key
    .replaceAll('\\', '\\\\')
    .replaceAll('"', String.raw`\"`);
  return `${parentPath}["${escapedKey}"]`;
};

const buildArrayPath = (parentPath: string, index: number) => {
  return `${parentPath}[${index}]`;
};

const normalizeBase64Payload = (value: string) => {
  let normalized = value.trim().replaceAll(/\s+/g, '');
  if (!normalized) {
    return '';
  }

  // 兼容 URL-safe Base64
  normalized = normalized.replaceAll('-', '+').replaceAll('_', '/');

  if (/[^A-Z0-9+/=]/i.test(normalized)) {
    return '';
  }

  if (normalized.includes('=') && !/=+$/.test(normalized)) {
    return '';
  }

  const remainder = normalized.length % 4;
  if (remainder === 1) {
    return '';
  }
  if (remainder > 0) {
    normalized = `${normalized}${'='.repeat(4 - remainder)}`;
  }

  return normalized;
};

const estimateBase64SizeBytes = (base64Data: string) => {
  if (!base64Data) {
    return 0;
  }
  let padding = 0;
  if (base64Data.endsWith('==')) {
    padding = 2;
  } else if (base64Data.endsWith('=')) {
    padding = 1;
  }
  return Math.max(0, Math.floor((base64Data.length * 3) / 4) - padding);
};

const decodeBase64Preview = (base64Data: string, previewBytes = 160) => {
  if (typeof atob !== 'function') {
    return '';
  }
  try {
    const safeLength = Math.ceil(previewBytes / 3) * 4;
    const source = base64Data.slice(0, safeLength);
    return atob(source);
  } catch {
    return '';
  }
};

const inferImageMimeFromRawBase64 = (base64Data: string): null | string => {
  const prefix = base64Data.slice(0, 24);
  if (prefix.startsWith('iVBORw0KGgo')) {
    return 'image/png';
  }
  if (prefix.startsWith('/9j/')) {
    return 'image/jpeg';
  }
  if (prefix.startsWith('R0lGOD')) {
    return 'image/gif';
  }
  if (prefix.startsWith('Qk')) {
    return 'image/bmp';
  }
  if (
    prefix.startsWith('UklGR') &&
    base64Data.slice(0, 120).includes('V0VCUA')
  ) {
    return 'image/webp';
  }
  if (prefix.startsWith('PHN2Zy')) {
    return 'image/svg+xml';
  }
  if (prefix.startsWith('PD94bWwg')) {
    const preview = decodeBase64Preview(base64Data, 256);
    if (/<svg[\s>]/i.test(preview)) {
      return 'image/svg+xml';
    }
  }
  return null;
};

const parseDataUrlImage = (
  value: string,
): null | {
  base64Data: string;
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
} => {
  if (!value.startsWith('data:')) {
    return null;
  }
  const commaIndex = value.indexOf(',');
  if (commaIndex <= 5) {
    return null;
  }

  const metadata = value.slice(5, commaIndex).trim();
  const payload = value.slice(commaIndex + 1);
  const mimeType = metadata.split(';')[0]?.trim().toLowerCase();
  if (!mimeType || !mimeType.startsWith('image/')) {
    return null;
  }
  if (!/;base64(?:;|$)/i.test(metadata)) {
    return null;
  }

  const normalizedPayload = normalizeBase64Payload(payload);
  if (!normalizedPayload) {
    return null;
  }

  return {
    mimeType,
    base64Data: normalizedPayload,
    dataUrl: `data:${mimeType};base64,${normalizedPayload}`,
    sizeBytes: estimateBase64SizeBytes(normalizedPayload),
  };
};

const detectImageFromString = (
  text: string,
  minRawBase64Length: number,
): null | {
  base64Data: string;
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: 'data-url' | 'raw-base64';
} => {
  const parsedDataUrl = parseDataUrlImage(text);
  if (parsedDataUrl) {
    return {
      ...parsedDataUrl,
      sourceType: 'data-url',
    };
  }

  const normalizedPayload = normalizeBase64Payload(text);
  if (!normalizedPayload || normalizedPayload.length < minRawBase64Length) {
    return null;
  }
  const mimeType = inferImageMimeFromRawBase64(normalizedPayload);
  if (!mimeType) {
    return null;
  }

  return {
    sourceType: 'raw-base64',
    mimeType,
    base64Data: normalizedPayload,
    dataUrl: `data:${mimeType};base64,${normalizedPayload}`,
    sizeBytes: estimateBase64SizeBytes(normalizedPayload),
  };
};

export const detectBase64ImagesInData = (
  input: unknown,
  options: DetectBase64ImageOptions = {},
) => {
  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const results: DetectedBase64Image[] = [];
  const addedKeys = new Set<string>();
  const visited = new WeakSet<object>();

  const tryPushImage = (value: string, path: string) => {
    if (results.length >= config.maxImages) {
      return;
    }
    const detected = detectImageFromString(value, config.minRawBase64Length);
    if (!detected) {
      return;
    }

    const uniqueKey = `${path}|${detected.mimeType}|${detected.sizeBytes}`;
    if (addedKeys.has(uniqueKey)) {
      return;
    }
    addedKeys.add(uniqueKey);
    results.push({
      path,
      mimeType: detected.mimeType,
      sizeBytes: detected.sizeBytes,
      dataUrl: detected.dataUrl,
      base64Data: detected.base64Data,
      sourceType: detected.sourceType,
    });
  };

  const traverse = (value: unknown, path = '$', depth = 0) => {
    if (results.length >= config.maxImages || depth > config.maxDepth) {
      return;
    }

    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) {
        return;
      }

      tryPushImage(text, path);

      if (config.parseJsonString && isLikelyJsonString(text)) {
        try {
          const parsed = JSON.parse(text);
          traverse(parsed, path, depth + 1);
        } catch {
          // ignore invalid json string
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        traverse(item, buildArrayPath(path, index), depth + 1);
      });
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    Object.entries(value).forEach(([key, fieldValue]) => {
      traverse(fieldValue, buildObjectPath(path, key), depth + 1);
    });
  };

  traverse(input);
  return results;
};

export const formatDetectedImageSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const fixed = value >= 100 || index === 0 ? 0 : 2;
  return `${Number.parseFloat(value.toFixed(fixed))} ${units[index]}`;
};

export const buildDetectedImageFileName = (
  image: Pick<DetectedBase64Image, 'mimeType' | 'path'>,
  index: number,
) => {
  const ext = BASE64_IMAGE_EXTENSIONS[image.mimeType] || 'bin';
  const normalizedPath = image.path
    .replaceAll(/^\$\.?/g, '')
    .replaceAll(/\[(\d+)\]/g, '-$1')
    .replaceAll(/[^\w-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .toLowerCase();
  const prefix = normalizedPath || `image-${index}`;
  const safePrefix = prefix.slice(0, 64) || `image-${index}`;
  return `${safePrefix}.${ext}`;
};
