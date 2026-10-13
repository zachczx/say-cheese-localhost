import type { ShotStatus } from '../capture/job';

export interface ShotState {
  status: ShotStatus;
  error?: string;
}

export const statusLabels: Record<ShotStatus, string> = {
  pending: 'Pending',
  waiting: 'Prepare manually',
  skipped: 'Skipped',
  navigating: 'Navigating',
  preparing: 'Preparing',
  capturing: 'Capturing',
  downloading: 'Downloading',
  complete: 'Complete',
  failed: 'Failed',
};

export const activeStatuses: readonly ShotStatus[] = [
  'navigating',
  'preparing',
  'capturing',
  'downloading',
];
