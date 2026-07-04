const TAP_DISTANCE = 14;
const SWIPE_DISTANCE = 42;
const LONG_PRESS_MS = 520;

export function createInputController(target, handlers) {
  let enabled = false;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let longPressTimer = 0;
  let longPressFired = false;
  let pointerType = 'touch';

  function onPointerDown(event) {
    if (!enabled) return;
    startX = event.clientX;
    startY = event.clientY;
    pointerType = event.pointerType || 'touch';
    startTime = performance.now();
    longPressFired = false;
    window.clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => {
      longPressFired = true;
      handlers.onLongPress?.();
    }, LONG_PRESS_MS);
  }

  function onPointerUp(event) {
    if (!enabled) return;
    window.clearTimeout(longPressTimer);
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const elapsed = performance.now() - startTime;

    if (longPressFired) return;

    if (Math.max(absX, absY) < TAP_DISTANCE && elapsed < LONG_PRESS_MS) {
      handlers.onTap?.();
      return;
    }

    if (pointerType === 'mouse') return;

    if (absY > absX && absY > SWIPE_DISTANCE) {
      handlers.onSwipeVertical?.(dy < 0 ? 'up' : 'down');
      return;
    }

    if (absX > SWIPE_DISTANCE) {
      handlers.onSwipeHorizontal?.(dx > 0 ? 'right' : 'left');
    }
  }

  function onPointerCancel() {
    window.clearTimeout(longPressTimer);
  }

  target.addEventListener('pointerdown', onPointerDown, { passive: true });
  target.addEventListener('pointerup', onPointerUp, { passive: true });
  target.addEventListener('pointercancel', onPointerCancel, { passive: true });

  return {
    enable() {
      enabled = true;
    },
    disable() {
      enabled = false;
      window.clearTimeout(longPressTimer);
    },
  };
}
