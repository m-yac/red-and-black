// Pointer pinch-to-zoom + wheel zoom. Exposes a single scale factor combining
// both inputs and fires `onChange` whenever it updates.
//
// Pinch logic based on:
// https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures

export class Zoom {
  constructor(canvas, onChange) {
    this.onChange = onChange;
    this.scrollScale = 1.0;
    this.touchScale = 1.0;
    this.pointerEvts = new Map();
    this.initialDiff = undefined;

    const onEnd = (e) => this.handlePinchEnd(e);
    canvas.addEventListener('pointerup',     onEnd);
    canvas.addEventListener('pointercancel', onEnd);
    canvas.addEventListener('pointerleave',  onEnd);
    canvas.addEventListener('pointerout',    onEnd);

    const onMove = (e) => this.handlePinch(e);
    canvas.addEventListener('pointerdown', onMove);
    canvas.addEventListener('pointermove', onMove);

    canvas.addEventListener('wheel', (e) => {
      this.scrollScale *= Math.pow(1.001, e.deltaY);
      this.onChange();
    });
  }

  getScale() {
    return this.scrollScale * this.touchScale;
  }

  handlePinchEnd(e) {
    if (e !== undefined) {
      if (e.pointerType != 'touch') return;
      this.pointerEvts.delete(e.pointerId);
    }
    if (this.pointerEvts.size < 2) {
      this.initialDiff = undefined;
      this.scrollScale *= this.touchScale;
      this.touchScale = 1.0;
    }
  }

  handlePinch(e) {
    if (e.pointerType != 'touch') return;
    this.pointerEvts.set(e.pointerId, e);
    if (this.pointerEvts.size == 2) {
      const [e1, e2] = [...this.pointerEvts.values()];
      const diff = Math.hypot(e1.clientX - e2.clientX,
                              e1.clientY - e2.clientY);
      if (this.initialDiff === undefined) {
        this.initialDiff = diff;
      } else {
        this.touchScale = diff / this.initialDiff;
        this.onChange();
      }
    } else {
      this.handlePinchEnd();
    }
  }
}
