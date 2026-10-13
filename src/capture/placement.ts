export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

/**
 * Places the capture window beside the controller so it does not cover the
 * controller's capture actions. Prefers the right side, then the left, and
 * otherwise leaves placement to Chrome. Sizes are clamped to the work area so
 * Chrome does not resize the window after creation.
 */
export function besideController(
  controller: Partial<Bounds> | undefined,
  size: WindowSize,
  workArea: Bounds,
): Partial<Bounds> {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  if (
    controller?.left === undefined ||
    controller.width === undefined ||
    controller.top === undefined
  ) {
    return { width, height };
  }
  const top = Math.min(
    Math.max(controller.top, workArea.top),
    workArea.top + workArea.height - height,
  );
  const right = controller.left + controller.width;
  if (right + width <= workArea.left + workArea.width) return { left: right, top, width, height };
  if (controller.left - width >= workArea.left) {
    return { left: controller.left - width, top, width, height };
  }
  return { width, height };
}
