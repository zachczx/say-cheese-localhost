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
  ready?: ReadyCondition[];
  actions?: CaptureAction[];
  capture?: {
    mode: CaptureMode;
    selector?: string;
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

export interface CaptureProfile {
  id: string;
  label: string;
  defaultBaseUrl: string;
  outputDirectory: string;
  defaultViewport: string;
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
  const errors: string[] = [];
  const viewportIds = new Set(viewports.map((viewport) => viewport.id));
  const shotIds = new Set<string>();
  const filenames = new Set<string>();

  if (!profile.id.trim()) errors.push('Profile ID is required.');
  if (!profile.label.trim()) errors.push(`Profile "${profile.id}" needs a label.`);
  if (profile.shots.length === 0) errors.push(`Profile "${profile.id}" has no shots.`);

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
    for (const action of shot.actions ?? []) {
      if (!actionTypes.has(action.type)) {
        errors.push(`Shot "${shot.id}" uses unsupported action "${String(action.type)}".`);
      }
      if ('timeoutMs' in action && action.timeoutMs !== undefined && action.timeoutMs <= 0) {
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
    }
    for (const condition of shot.ready ?? []) {
      if (
        'timeoutMs' in condition &&
        condition.timeoutMs !== undefined &&
        condition.timeoutMs <= 0
      ) {
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
