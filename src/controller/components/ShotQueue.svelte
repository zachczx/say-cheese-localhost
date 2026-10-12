<script lang="ts">
  import type { CaptureProfile, Shot } from '../../profiles/schema';
  import { VIEWPORTS } from '../../profiles/viewports';
  import { formatSavedAt, type CaptureLog } from '../../storage/captures';
  import { activeStatuses, statusLabels, type ShotState } from '../status';

  interface Props {
    profile: CaptureProfile;
    shotStates: Record<string, ShotState>;
    selectedIds: string[];
    previews: Record<string, string>;
    captureLog: CaptureLog;
    ready: boolean;
    running: boolean;
    onToggleShot: (shotId: string, checked: boolean) => void;
    onToggleAll: (checked: boolean) => void;
    onRetry: (shot: Shot) => void;
    onPreview: (shotId: string) => void;
  }

  let {
    profile,
    shotStates,
    selectedIds,
    previews,
    captureLog,
    ready,
    running,
    onToggleShot,
    onToggleAll,
    onRetry,
    onPreview,
  }: Props = $props();

  const selectedCount = $derived(selectedIds.length);
  const allSelected = $derived(profile.shots.length > 0 && selectedCount === profile.shots.length);
  const partiallySelected = $derived(selectedCount > 0 && !allSelected);

  function viewportLabel(viewportId: string): string {
    return VIEWPORTS.find((candidate) => candidate.id === viewportId)?.label ?? viewportId;
  }
</script>

<div class="queue-header">
  <div>
    <h2 id="queue-title">Shot queue</h2>
    <p>{profile.shots.length} ordered shots · {selectedCount} selected</p>
  </div>
</div>

<div class="shot-table-wrap">
  <table class="shot-table">
    <thead>
      <tr>
        <th class="order-column">Order</th>
        <th>Shot</th>
        <th>Route</th>
        <th class="status-column">Status</th>
        <th class="retry-column"><span class="sr-only">Actions</span></th>
        <th class="select-column">
          <input
            class="checkbox checkbox-sm checkbox-primary"
            type="checkbox"
            checked={allSelected}
            indeterminate={partiallySelected}
            disabled={!ready || running || profile.shots.length === 0}
            aria-label={allSelected ? 'Clear all shot selections' : 'Select all shots'}
            title={allSelected ? 'Clear all selections' : 'Select all shots'}
            onchange={(event) => onToggleAll(event.currentTarget.checked)}
          />
        </th>
      </tr>
    </thead>
    <tbody>
      {#each profile.shots as shot, index (shot.id)}
        {@const state = shotStates[shot.id] ?? { status: 'pending' }}
        {@const record = captureLog[profile.id]?.[shot.id]}
        <tr data-status={state.status} data-active={activeStatuses.includes(state.status)}>
          <td class="order-column">{String(index + 1).padStart(2, '0')}</td>
          <td>
            <div class="shot-cell">
              {#if previews[shot.id]}
                <button
                  class="shot-thumb"
                  type="button"
                  aria-label={`Preview ${shot.label}`}
                  onclick={() => onPreview(shot.id)}
                >
                  <img src={previews[shot.id]} alt="" />
                </button>
              {/if}
              <div class="shot-text">
                <span class="shot-title">{shot.label}</span>
                <span class="shot-file">{shot.filename}</span>
                {#if shot.preparation}<span class="shot-file">{shot.preparation}</span>{/if}
                {#if record}
                  <time
                    class="shot-saved"
                    datetime={new Date(record.savedAt).toISOString()}
                    title={`Saved at ${viewportLabel(record.viewportId)}`}
                    >Saved {formatSavedAt(record.savedAt)}</time
                  >
                {/if}
                {#if state.status === 'failed' && state.error}
                  <p class="shot-error" id={`shot-error-${shot.id}`}>{state.error}</p>
                {/if}
              </div>
            </div>
          </td>
          <td><code class="route-code" title={shot.path}>{shot.path}</code></td>
          <td class="status-column">
            <span
              class="status-badge"
              data-status={state.status}
              aria-describedby={state.status === 'failed' && state.error
                ? `shot-error-${shot.id}`
                : undefined}
            >
              {statusLabels[state.status]}
            </span>
          </td>
          <td class="retry-column">
            {#if state.status === 'failed'}
              <button
                class="retry-shot btn btn-ghost btn-sm"
                type="button"
                disabled={running}
                aria-label={`Retry ${shot.label}`}
                onclick={() => onRetry(shot)}
              >
                Retry
              </button>
            {/if}
          </td>
          <td class="select-column">
            <input
              class="checkbox checkbox-sm checkbox-primary"
              type="checkbox"
              checked={selectedIds.includes(shot.id)}
              disabled={running}
              aria-label={`Select ${shot.label}`}
              onchange={(event) => onToggleShot(shot.id, event.currentTarget.checked)}
            />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
