<script lang="ts">
  import type { Shot } from '../../profiles/schema';

  interface Props {
    shot: Shot;
    error: string;
    fullPage: boolean;
    /** The capture command's key binding, or empty when unassigned. */
    shortcut: string;
    onCapture: () => void;
    onSkip: () => void;
  }

  let { shot, error, fullPage, shortcut, onCapture, onSkip }: Props = $props();
</script>

<div class="manual-preparation" aria-live="polite">
  <div class="manual-copy">
    <strong>{shot.label}</strong>
    <p>
      {shot.preparation ??
        (fullPage
          ? 'Arrange the page content, then capture the complete document.'
          : 'Arrange the capture window, then capture the current view.')}
    </p>
    <p>
      {fullPage
        ? 'Navigate freely. Capture loads lazy content and returns to this scroll position.'
        : 'Navigate and scroll freely. Capture keeps your current framing.'}
      The next shot opens as soon as the image is saved.
    </p>
    {#if error}<p role="alert">{error} Correct the page and retry here.</p>{/if}
    {#if shortcut}
      <p class="manual-shortcut">
        Or press <kbd>{shortcut}</kbd> in the capture window to capture without switching back.
      </p>
    {/if}
    <div class="capture-actions">
      <button class="primary-button btn btn-primary" type="button" onclick={onCapture}
        >Capture {fullPage ? 'full page' : 'current view'}</button
      >
      <button class="quiet-button btn btn-ghost" type="button" onclick={onSkip}>Skip shot</button>
    </div>
  </div>
</div>
