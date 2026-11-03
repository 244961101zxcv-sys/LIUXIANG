import * as THREE from 'three';

const TAU = Math.PI * 2;

/**
 * A deliberately small orbit controller with the exact mappings used by the site:
 *   desktop : left-drag = pan, middle-drag = rotate, wheel = zoom
 *   touch   : one finger = rotate, two fingers = pinch zoom (no pan)
 *
 * Using a small local controller instead of OrbitControls keeps the touch mapping
 * exact and avoids accidental two-finger panning on phones.
 */
export class OrbitViewControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.target = new THREE.Vector3();
    this._home = {
      target: new THREE.Vector3(),
      radius: 3,
      theta: Math.PI * 0.18,
      phi: Math.PI * 0.46,
    };

    this.radius = 3;
    this.theta = Math.PI * 0.18;
    this.phi = Math.PI * 0.46;

    this.minDistance = 0.05;
    this.maxDistance = 1000;
    this.rotateSpeed = 1;
    this.panSpeed = 1;
    this.zoomSpeed = 1;
    this.enabled = true;
    this.autoRotateSpeed = 0.18;

    this._pointers = new Map();
    this._mode = null; // 'rotate' | 'pan' | 'pinch'
    this._activeId = null;
    this._last = new THREE.Vector2();
    this._pinchStartDistance = 1;
    this._pinchStartRadius = 1;

    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._offset = new THREE.Vector3();

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onContextMenu = (event) => event.preventDefault();
    this._onAuxClick = (event) => event.preventDefault();
    this._onMouseDown = (event) => {
      if (event.button === 1) event.preventDefault();
    };

    this.domElement.style.touchAction = 'none';
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.domElement.addEventListener('pointermove', this._onPointerMove);
    this.domElement.addEventListener('pointerup', this._onPointerUp);
    this.domElement.addEventListener('pointercancel', this._onPointerUp);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this.domElement.addEventListener('contextmenu', this._onContextMenu);
    this.domElement.addEventListener('auxclick', this._onAuxClick);
    this.domElement.addEventListener('mousedown', this._onMouseDown);

    this.update();
  }

  get dragging() {
    return this._mode !== null;
  }

  _handlePointerDown(event) {
    if (!this.enabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;

    event.preventDefault();
    this.domElement.focus?.({ preventScroll: true });
    this._pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      type: event.pointerType,
      button: event.button,
    });

    try {
      this.domElement.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }

    if (event.pointerType === 'touch') {
      if (this._pointers.size === 1) {
        this._mode = 'rotate';
        this._activeId = event.pointerId;
        this._last.set(event.clientX, event.clientY);
      } else if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        this._mode = 'pinch';
        this._activeId = null;
        this._pinchStartDistance = Math.max(1, this._distance(a, b));
        this._pinchStartRadius = this.radius;
      }
      return;
    }

    this._mode = event.button === 1 ? 'rotate' : 'pan';
    this._activeId = event.pointerId;
    this._last.set(event.clientX, event.clientY);
  }

  _handlePointerMove(event) {
    if (!this.enabled || !this._pointers.has(event.pointerId)) return;
    const pointer = this._pointers.get(event.pointerId);
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (this._mode === 'pinch' && this._pointers.size >= 2) {
      event.preventDefault();
      const [a, b] = [...this._pointers.values()];
      const distance = Math.max(1, this._distance(a, b));
      this.radius = THREE.MathUtils.clamp(
        this._pinchStartRadius * (this._pinchStartDistance / distance),
        this.minDistance,
        this.maxDistance,
      );
      this.update();
      return;
    }

    if (this._activeId !== event.pointerId) return;
    if (this._mode !== 'rotate' && this._mode !== 'pan') return;

    const dx = event.clientX - this._last.x;
    const dy = event.clientY - this._last.y;
    this._last.set(event.clientX, event.clientY);
    if (dx === 0 && dy === 0) return;

    event.preventDefault();
    if (this._mode === 'rotate') {
      this._rotateByPixels(dx, dy);
    } else {
      this._panByPixels(dx, dy);
    }
    this.update();
  }

  _handlePointerUp(event) {
    if (!this._pointers.has(event.pointerId)) return;
    this._pointers.delete(event.pointerId);

    if (this._pointers.size === 0) {
      this._mode = null;
      this._activeId = null;
      return;
    }

    if (event.pointerType === 'touch' && this._mode === 'pinch' && this._pointers.size === 1) {
      const [pointer] = [...this._pointers.values()];
      this._mode = 'rotate';
      this._activeId = [...this._pointers.keys()][0];
      this._last.set(pointer.x, pointer.y);
    }
  }

  _handleWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    if (event.deltaMode === 2) delta *= 100;
    const factor = Math.exp(delta * 0.0012 * this.zoomSpeed);
    this.radius = THREE.MathUtils.clamp(this.radius * factor, this.minDistance, this.maxDistance);
    this.update();
  }

  _distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _rotateByPixels(dx, dy) {
    const height = Math.max(1, this.domElement.clientHeight);
    const scale = (TAU / height) * this.rotateSpeed;
    this.theta -= dx * scale;
    this.phi -= dy * scale;
    this.phi = THREE.MathUtils.clamp(this.phi, 0.06, Math.PI - 0.06);
    this.theta = ((this.theta % TAU) + TAU) % TAU;
  }

  _panByPixels(dx, dy) {
    const height = Math.max(1, this.domElement.clientHeight);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const worldPerPixel = (2 * this.radius * Math.tan(fov / 2)) / height;

    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.target.addScaledVector(this._right, -dx * worldPerPixel * this.panSpeed);
    this.target.addScaledVector(this._up, dy * worldPerPixel * this.panSpeed);
  }

  rotateBy(deltaTheta) {
    this.theta = (this.theta + deltaTheta) % TAU;
    this.update();
  }

  update() {
    const sinPhi = Math.sin(this.phi);
    this._offset.set(
      this.radius * sinPhi * Math.sin(this.theta),
      this.radius * Math.cos(this.phi),
      this.radius * sinPhi * Math.cos(this.theta),
    );
    this.camera.position.copy(this.target).add(this._offset);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /**
   * Frame a Box3 using both the horizontal and vertical field of view so tall
   * characters and wide props both fit without clipping.
   */
  frameBox(box, padding = 1.22) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) return;

    this.target.copy(center);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, this.camera.aspect));
    const distanceV = size.y / 2 / Math.tan(vFov / 2);
    const distanceH = Math.max(size.x, size.z) / 2 / Math.tan(hFov / 2);
    this.radius = Math.max(distanceV, distanceH, maxDimension * 0.32) * padding;

    this.minDistance = Math.max(this.radius * 0.04, 0.01);
    this.maxDistance = this.radius * 9;
    this.theta = Math.PI * 0.17;
    this.phi = Math.PI * 0.46;
    this.update();
    this._saveHome();
  }

  _saveHome() {
    this._home.target.copy(this.target);
    this._home.radius = this.radius;
    this._home.theta = this.theta;
    this._home.phi = this.phi;
  }

  reset() {
    this.target.copy(this._home.target);
    this.radius = this._home.radius;
    this.theta = this._home.theta;
    this.phi = this._home.phi;
    this.update();
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('pointercancel', this._onPointerUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    this.domElement.removeEventListener('auxclick', this._onAuxClick);
    this.domElement.removeEventListener('mousedown', this._onMouseDown);
    this._pointers.clear();
  }
}
