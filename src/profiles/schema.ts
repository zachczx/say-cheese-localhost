import { isValidTimezone } from '../capture/emulation';

export type CaptureMode = 'viewport' | 'full-page' | 'element';

export interface ViewportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  touch: boolean;
}

export type ReadyCondition =
  | { type: 'selector'; selector: string; timeoutMs?: number }
  | { type: 'url'; pattern: string; timeoutMs?: number };

export type CaptureAction =
  | { type: 'wait-for-selector'; selector: string; timeoutMs?: number }
  | { type: 'click'; selector: string }
  | { type: 'select-index'; selector: string; index: number }
  | { type: 'scroll-to'; selector: string; topOffset?: number }
  | { type: 'wait-for-url'; pattern: string; timeoutMs?: number }
  | { type: 'delay'; milliseconds: number };

export interface Shot {
  id: string;
  label: string;
  path: string;
  filename: string;
  enabledByDefault: boolean;
  preparation?: string;
  ready?: ReadyCondition[];
  actions?: CaptureAction[];
  capture?: {
    mode: CaptureMode;
    selector?: string;
    captureBeyondViewport?: boolean;
  };
  settleMs?: number;
}

export interface PreflightRule {
  path: string;
  expected: Record<string, string | number | boolean>;
}

export interface RequestReplacement {
  urlPattern: string;
  assetPaths: string[];
}

/** Optional per-profile deadlines, in milliseconds. Human preparation never times out. */
export interface CaptureTimeouts {
  /** Whole-shot deadline for opening, preparing, capturing, and downloading. */
  shotMs?: number;
  /** Page navigation until the load event. */
  navigationMs?: number;
  /** Local document, script, and API requests settling. */
  networkQuietMs?: number;
  /** Fonts and visible images loading and decoding. */
  assetsMs?: number;
}

export const DEFAULT_TIMEOUTS: Readonly<Required<CaptureTimeouts>> = {
  shotMs: 45_000,
  navigationMs: 15_000,
  networkQuietMs: 15_000,
  assetsMs: 15_000,
};

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;

export function resolveTimeouts(timeouts?: CaptureTimeouts): Required<CaptureTimeouts> {
  return { ...DEFAULT_TIMEOUTS, ...timeouts };
}

export interface CaptureProfile {
  id: string;
  label: string;
  /** Position in the project list; lower comes first. Profiles without one sort last by label. */
  order?: number;
  defaultBaseUrl: string;
  /** Short help shown under the Base URL field, for example how to start a QA server. */
  baseUrlHint?: string;
  outputDirectory: string;
  defaultViewport: string;
  /** IANA time zone the capture window reports. Defaults to Asia/Singapore. */
  timezone?: string;
  timeouts?: CaptureTimeouts;
  preflight?: PreflightRule;
  requestReplacements?: RequestReplacement[];
  shots: Shot[];
}

const actionTypes = new Set<CaptureAction['type']>([
  'wait-for-selector',
  'click',
  'select-index',
  'scroll-to',
  'wait-for-url',
  'delay',
]);
const readyTypes = new Set<ReadyCondition['type']>(['selector', 'url']);
const captureModes = new Set<CaptureMode>(['viewport', 'full-page', 'element']);

export function validateViewport(viewport: ViewportPreset): string[] {
  const errors: string[] = [];
  if (!viewport.id.trim()) errors.push('Viewport ID is required.');
  if (!viewport.label.trim()) errors.push(`Viewport "${viewport.id}" needs a label.`);
  if (!Number.isInteger(viewport.width) || viewport.width < 240 || viewport.width > 7680) {
    errors.push(`Viewport "${viewport.id}" has an invalid width.`);
  }
  if (!Number.isInteger(viewport.height) || viewport.height < 240 || viewport.height > 7680) {
    errors.push(`Viewport "${viewport.id}" has an invalid height.`);
  }
  if (
    !Number.isFinite(viewport.deviceScaleFactor) ||
    viewport.deviceScaleFactor < 0.5 ||
    viewport.deviceScaleFactor > 4
  ) {
    errors.push(`Viewport "${viewport.id}" has an invalid device scale factor.`);
  }
  return errors;
}

export function validateProfile(
  profile: CaptureProfile,
  viewports: readonly ViewportPreset[],
): string[] {
  // Manifests are JSON, so check the structure before relying on it.
  const shapeErrors = validateShape(profile);
  if (shapeErrors.length > 0) return shapeErrors;

  const errors: string[] = [];
  const viewportIds = new Set(viewports.map((viewport) => viewport.id));
  const shotIds = new Set<string>();
  const filenames = new Set<string>();

  if (!profile.id.trim()) errors.push('Profile ID is required.');
  if (!profile.label.trim()) errors.push(`Profile "${profile.id}" needs a label.`);
  if (profile.shots.length === 0) errors.push(`Profile "${profile.id}" has no shots.`);
  if (profile.order !== undefined && !Number.isInteger(profile.order)) {
    errors.push(`Profile "${profile.id}" order must be an integer.`);
  }

  try {
    const url = new URL(profile.defaultBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    errors.push(`Profile "${profile.id}" has an invalid default base URL.`);
  }

  if (!isSafeRelativePath(profile.outputDirectory)) {
    errors.push(`Profile "${profile.id}" has an unsafe output directory.`);
  }
  if (!viewportIds.has(profile.defaultViewport)) {
    errors.push(
      `Profile "${profile.id}" references unknown viewport "${profile.defaultViewport}".`,
    );
  }
  if (profile.preflight && !isOriginRelativePath(profile.preflight.path)) {
    errors.push(`Profile "${profile.id}" has an unsafe preflight path.`);
  }
  errors.push(...validateTimeouts(profile));
  if (
    profile.timezone !== undefined &&
    (typeof profile.timezone !== 'string' || !isValidTimezone(profile.timezone))
  ) {
    errors.push(`Profile "${profile.id}" has an unknown timezone "${String(profile.timezone)}".`);
  }
  if (
    profile.baseUrlHint !== undefined &&
    (typeof profile.baseUrlHint !== 'string' ||
      !profile.baseUrlHint.trim() ||
      profile.baseUrlHint.length > 160)
  ) {
    errors.push(`Profile "${profile.id}" baseUrlHint must be 1–160 characters.`);
  }

  for (const shot of profile.shots) {
    const normalizedId = shot.id.toLocaleLowerCase('en-US');
    const normalizedFilename = shot.filename.toLocaleLowerCase('en-US');
    if (!shot.id.trim()) errors.push('Shot ID is required.');
    if (!shot.label.trim()) errors.push(`Shot "${shot.id}" needs a label.`);
    if (shotIds.has(normalizedId)) errors.push(`Duplicate shot ID "${shot.id}".`);
    if (filenames.has(normalizedFilename)) errors.push(`Duplicate filename "${shot.filename}".`);
    shotIds.add(normalizedId);
    filenames.add(normalizedFilename);

    if (!isSafeFilename(shot.filename) || !shot.filename.toLowerCase().endsWith('.webp')) {
      errors.push(`Shot "${shot.id}" has an unsafe filename.`);
    }
    if (!isOriginRelativePath(shot.path)) {
      errors.push(`Shot "${shot.id}" must use a same-origin absolute path.`);
    }
    if (shot.capture?.mode === 'element' && !shot.capture.selector?.trim()) {
      errors.push(`Shot "${shot.id}" uses element capture without a selector.`);
    }
    if (
      shot.capture?.captureBeyondViewport !== undefined &&
      typeof shot.capture.captureBeyondViewport !== 'boolean'
    ) {
      errors.push(`Shot "${shot.id}" captureBeyondViewport must be a boolean.`);
    }
    for (const action of shot.actions ?? []) {
      if ('timeoutMs' in action && !isOptionalPositive(action.timeoutMs)) {
        errors.push(`Shot "${shot.id}" has a non-positive action timeout.`);
      }
      if (action.type === 'select-index' && (!Number.isInteger(action.index) || action.index < 0)) {
        errors.push(`Shot "${shot.id}" has an invalid select index.`);
      }
      if (
        action.type === 'delay' &&
        (!Number.isFinite(action.milliseconds) || action.milliseconds < 0)
      ) {
        errors.push(`Shot "${shot.id}" has an invalid delay.`);
      }
      if (
        action.type === 'scroll-to' &&
        action.topOffset !== undefined &&
        !Number.isFinite(action.topOffset)
      ) {
        errors.push(`Shot "${shot.id}" has an invalid scroll offset.`);
      }
    }
    for (const condition of shot.ready ?? []) {
      if (!isOptionalPositive(condition.timeoutMs)) {
        errors.push(`Shot "${shot.id}" has a non-positive readiness timeout.`);
      }
    }
    if (shot.settleMs !== undefined && (!Number.isFinite(shot.settleMs) || shot.settleMs < 0)) {
      errors.push(`Shot "${shot.id}" has an invalid settle delay.`);
    }
  }

  if (profile.requestReplacements) {
    for (const replacement of profile.requestReplacements) {
      if (!replacement.urlPattern.trim() || replacement.assetPaths.length === 0) {
        errors.push(`Profile "${profile.id}" has an incomplete request replacement.`);
      }
      for (const assetPath of replacement.assetPaths) {
        if (!isSafeRelativePath(assetPath)) {
          errors.push(`Profile "${profile.id}" has an unsafe replacement asset path.`);
        }
      }
    }
  }

  return errors;
}

function isOptionalPositive(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && value > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateShape(value: unknown): string[] {
  if (!isRecord(value)) return ['The profile must be a JSON object.'];
  const errors: string[] = [];
  for (const key of ['id', 'label', 'defaultBaseUrl', 'outputDirectory', 'defaultViewport']) {
    if (typeof value[key] !== 'string') errors.push(`The profile needs a "${key}" string.`);
  }
  if (value.timeouts !== undefined && !isRecord(value.timeouts)) {
    errors.push('"timeouts" must be an object.');
  }
  if (
    value.preflight !== undefined &&
    !(
      isRecord(value.preflight) &&
      typeof value.preflight.path === 'string' &&
      isRecord(value.preflight.expected)
    )
  ) {
    errors.push('"preflight" needs a "path" string and an "expected" object.');
  }
  if (value.requestReplacements !== undefined) {
    if (!Array.isArray(value.requestReplacements)) {
      errors.push('"requestReplacements" must be a list.');
    } else {
      value.requestReplacements.forEach((replacement: unknown, index) => {
        if (
          !isRecord(replacement) ||
          typeof replacement.urlPattern !== 'string' ||
          !isStringList(replacement.assetPaths)
        ) {
          errors.push(
            `Request replacement ${index + 1} needs a "urlPattern" string and an "assetPaths" list of strings.`,
          );
        }
      });
    }
  }
  if (!Array.isArray(value.shots)) {
    errors.push('The profile needs a "shots" list.');
    return errors;
  }
  value.shots.forEach((shot: unknown, index) => errors.push(...validateShotShape(shot, index)));
  return errors;
}

function validateShotShape(shot: unknown, index: number): string[] {
  if (!isRecord(shot)) return [`Shot ${index + 1} must be an object.`];
  const name =
    typeof shot.id === 'string' && shot.id.trim() ? `Shot "${shot.id}"` : `Shot ${index + 1}`;
  const errors: string[] = [];
  for (const key of ['id', 'label', 'path', 'filename']) {
    if (typeof shot[key] !== 'string') errors.push(`${name} needs a "${key}" string.`);
  }
  if (typeof shot.enabledByDefault !== 'boolean') {
    errors.push(`${name} needs "enabledByDefault" set to true or false.`);
  }
  if (shot.preparation !== undefined && typeof shot.preparation !== 'string') {
    errors.push(`${name} "preparation" must be a string.`);
  }
  if (shot.capture !== undefined) {
    if (!isRecord(shot.capture) || !captureModes.has(shot.capture.mode as CaptureMode)) {
      errors.push(`${name} "capture" needs a "mode" of viewport, full-page, or element.`);
    } else if (shot.capture.selector !== undefined && typeof shot.capture.selector !== 'string') {
      errors.push(`${name} capture "selector" must be a string.`);
    }
  }
  if (shot.ready !== undefined) {
    if (!Array.isArray(shot.ready)) {
      errors.push(`${name} "ready" must be a list.`);
    } else {
      shot.ready.forEach((condition: unknown, conditionIndex) => {
        const label = `${name} ready condition ${conditionIndex + 1}`;
        if (!isRecord(condition) || !readyTypes.has(condition.type as ReadyCondition['type'])) {
          errors.push(`${label} needs a "type" of selector or url.`);
        } else if (condition.type === 'selector' && typeof condition.selector !== 'string') {
          errors.push(`${label} needs a "selector" string.`);
        } else if (condition.type === 'url' && typeof condition.pattern !== 'string') {
          errors.push(`${label} needs a "pattern" string.`);
        }
      });
    }
  }
  if (shot.actions !== undefined) {
    if (!Array.isArray(shot.actions)) {
      errors.push(`${name} "actions" must be a list.`);
    } else {
      shot.actions.forEach((action: unknown, actionIndex) => {
        const label = `${name} action ${actionIndex + 1}`;
        if (!isRecord(action) || !actionTypes.has(action.type as CaptureAction['type'])) {
          const type = isRecord(action) ? ` "${String(action.type)}"` : '';
          errors.push(`${label} uses an unsupported type${type}.`);
        } else if (action.type === 'wait-for-url') {
          if (typeof action.pattern !== 'string') errors.push(`${label} needs a "pattern" string.`);
        } else if (action.type !== 'delay' && typeof action.selector !== 'string') {
          errors.push(`${label} needs a "selector" string.`);
        }
      });
    }
  }
  return errors;
}

function validateTimeouts(profile: CaptureProfile): string[] {
  if (profile.timeouts === undefined) return [];
  const errors: string[] = [];
  const known = new Set(Object.keys(DEFAULT_TIMEOUTS));
  for (const [key, value] of Object.entries(profile.timeouts)) {
    if (!known.has(key)) {
      errors.push(`Profile "${profile.id}" has unknown timeout "${key}".`);
      continue;
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MIN_TIMEOUT_MS ||
      value > MAX_TIMEOUT_MS
    ) {
      errors.push(
        `Profile "${profile.id}" timeout "${key}" must be ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS} ms.`,
      );
    }
  }
  if (errors.length > 0) return errors;
  const resolved = resolveTimeouts(profile.timeouts);
  for (const key of ['navigationMs', 'networkQuietMs', 'assetsMs'] as const) {
    if (resolved[key] > resolved.shotMs) {
      errors.push(`Profile "${profile.id}" timeout "${key}" exceeds "shotMs".`);
    }
  }
  return errors;
}

export function isSafeRelativePath(value: string): boolean {
  if (!value.trim() || value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  return !value.split(/[\\/]+/).includes('..');
}

export function isSafeFilename(value: string): boolean {
  return isSafeRelativePath(value) && !value.includes('/') && !value.includes('\\');
}

export function isOriginRelativePath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  try {
    const url = new URL(value, 'http://localhost');
    return url.origin === 'http://localhost';
  } catch {
    return false;
  }
}

export function joinDownloadPath(...segments: string[]): string {
  if (segments.some((segment) => !isSafeRelativePath(segment))) {
    throw new Error('Download path must stay beneath the Downloads directory.');
  }
  const normalized = segments.map((segment) =>
    segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
  );
  return normalized.join('/');
}
