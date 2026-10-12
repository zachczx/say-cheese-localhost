<script lang="ts">
  import type { ShotStatus } from '../../capture/job';

  interface Props {
    completed: number;
    total: number;
    currentUrl: string;
    status: ShotStatus;
    label: string;
  }

  let { completed, total, currentUrl, status, label }: Props = $props();
</script>

<div class="run-status" aria-live="polite">
  <div class="telemetry-tile progress-block">
    <div class="status-label-row">
      <span>Overall progress</span>
      <strong>{completed} / {total}</strong>
    </div>
    <progress class="progress progress-warning" value={completed} max={Math.max(total, 1)}
    ></progress>
  </div>
  <div class="telemetry-tile current-location">
    <span>Current URL</span>
    <strong title={currentUrl}>{currentUrl}</strong>
  </div>
  <div class="telemetry-tile current-state">
    <span>Status</span>
    <strong data-status={status}>{label}</strong>
  </div>
</div>
