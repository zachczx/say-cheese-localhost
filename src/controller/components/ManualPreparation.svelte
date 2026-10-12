<script lang="ts">
  import type { Shot } from '../../profiles/schema';

  interface Props {
    shot: Shot;
    saved: boolean;
    error: string;
    fullPage: boolean;
    isLastShot: boolean;
    /** The image saved for this shot, when there is one. */
    preview: string | undefined;
    /** The capture command's key binding, or empty when unassigned. */
    shortcut: string;
    onCapture: () => void;
    onNext: () => void;
    onPreview: () => void;
  }

  let {
    shot,
    saved,
    error,
    fullPage,
    isLastShot,
    preview,
    shortcut,
    onCapture,
    onNext,
    onPreview,
  }: Props = $props();
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
      {error && saved
        ? 'An earlier image was saved, but the latest attempt failed.'
        : saved
          ? 'Image saved. You can retake it or move on.'
          : fullPage
            ? 'Navigate freely. Capture loads lazy content and returns to this scroll position.'
            : 'Navigate and scroll freely. Capture keeps your current framing.'}
    </p>
    {#if error}<p role="alert">{error} Correct the page and retry here.</p>{/if}
    {#if shortcut}
      <p class="manual-shortcut">
        Or press <kbd>{shortcut}</kbd> in the capture window to capture without switching back.
      </p>
    {/if}
    <div class="capture-actions">
      <button class="primary-button btn btn-primary" type="button" onclick={onCapture}
        >{saved ? 'Retake' : 'Capture'}
        {fullPage ? 'full page' : 'current view'}</button
      >
      <button class="quiet-button btn btn-ghost" type="button" onclick={onNext}
        >{saved ? (isLastShot ? 'Finish' : 'Next shot') : 'Skip shot'}</button
      >
    </div>
  </div>
  {#if saved && preview}
    <button
      class="manual-preview"
      type="button"
      aria-label={`Open saved image for ${shot.label}`}
      onclick={onPreview}
    >
      <img src={preview} alt="" />
    </button>
  {/if}
</div>
