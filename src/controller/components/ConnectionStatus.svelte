<script lang="ts">
  import type { PingResult } from '../../capture/ping';
  import IconRefresh from '~icons/lucide/refresh-cw';

  interface Props {
    pinging: boolean;
    result: PingResult | undefined;
    ready: boolean;
    running: boolean;
    onRetry: () => void;
  }

  let { pinging, result, ready, running, onRetry }: Props = $props();
</script>

{#if pinging}
  <div class="ping-status ping-status-pending" role="status" aria-live="polite">
    <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
    <span>Checking connection…</span>
  </div>
{:else if result}
  <div
    class="ping-status"
    class:ping-status-success={result.reachable}
    class:ping-status-error={!result.reachable}
    role="status"
    aria-live="polite"
  >
    <span class="ping-dot" aria-hidden="true"></span>
    {#if result.reachable}
      <span class="ping-message">
        <strong>Up</strong> · {result.latencyMs}ms{result.status ? ` (HTTP ${result.status})` : ''}
      </span>
    {:else}
      <span class="ping-message">
        <strong>Down</strong> · {result.error ?? 'Connection refused'}
        {#if !running}
          · Retrying every 30 seconds.{/if}
      </span>
    {/if}
    <button
      type="button"
      class="btn btn-ghost btn-sm btn-square"
      aria-label={result.reachable ? 'Check again' : 'Retry now'}
      title={result.reachable ? 'Check again' : 'Retry now'}
      disabled={!ready || running}
      onclick={onRetry}
    >
      <IconRefresh aria-hidden="true" />
    </button>
  </div>
{/if}
