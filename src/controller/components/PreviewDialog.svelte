<script lang="ts">
  import { outputFilename } from '../../capture/screenshot';
  import type { Shot } from '../../profiles/schema';

  interface Props {
    /** The shot to show, or undefined when closed. */
    shot: Shot | undefined;
    /** The saved image as a data URL. */
    image: string | undefined;
    onClosed: () => void;
  }

  let { shot, image, onClosed }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let size = $state('');

  export function show(): void {
    size = '';
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  export function hide(): void {
    if (typeof dialog?.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
    onClosed();
  }
</script>

<dialog
  class="preview-dialog"
  bind:this={dialog}
  aria-labelledby="preview-title"
  onclose={onClosed}
  onclick={(event) => {
    if (event.target === dialog) hide();
  }}
>
  {#if shot && image}
    <header class="preview-header">
      <div>
        <h2 id="preview-title">{shot.label}</h2>
        <p>
          {outputFilename(shot.filename, image.startsWith('data:image/png') ? 'png' : 'webp')}{size
            ? ` · ${size}`
            : ''}
        </p>
      </div>
      <button class="quiet-button btn btn-ghost btn-sm" type="button" onclick={hide}>Close</button>
    </header>
    <img
      src={image}
      alt={`Saved image for ${shot.label}`}
      onload={(event) => {
        const loaded = event.currentTarget as HTMLImageElement;
        size = `${loaded.naturalWidth} × ${loaded.naturalHeight}`;
      }}
    />
  {/if}
</dialog>
