import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Small decorative WebGL sculpture in the hero. It is intentionally independent
 * from the model viewer so it can pause when off-screen and fail quietly.
 */
export function initHero(container) {
  if (!container) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    container.classList.add('hero-webgl--failed');
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = 'hero-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  camera.position.set(0, 0, 6.4);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = environment;
  scene.environmentIntensity = 0.65;

  const key = new THREE.DirectionalLight(0xfff4e5, 4);
  key.position.set(3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc8ff3d, 6);
  rim.position.set(-4, 1.5, -3);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x6f8cff, 3);
  fill.position.set(2, -2, -4);
  scene.add(fill);

  const group = new THREE.Group();
  group.rotation.set(0.45, -0.4, 0.15);
  scene.add(group);

  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0x9fa29c,
    metalness: 1,
    roughness: 0.19,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
  });

  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.06, 0.29, 240, 36, 2, 3),
    chrome,
  );
  group.add(knot);

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x242623,
    metalness: 0.9,
    roughness: 0.32,
  });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.012, 8, 180), ringMaterial);
  ringA.rotation.set(Math.PI / 2.35, 0.2, 0.2);
  group.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.93, 0.007, 8, 180), ringMaterial);
  ringB.rotation.set(-0.35, 0.8, 0.5);
  group.add(ringB);

  const glint = new THREE.PointLight(0xc8ff3d, 18, 10, 2);
  glint.position.set(-2.4, 2.1, 2.8);
  group.add(glint);

  const pointer = new THREE.Vector2();
  const targetRotation = new THREE.Vector2(0.45, -0.4);
  let visible = true;
  let paused = false;
  let raf = 0;
  let last = performance.now();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const onPointerMove = (event) => {
    const rect = container.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!visible || paused || document.hidden) return;
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reduceMotion) {
      targetRotation.x = 0.45 + pointer.y * 0.12;
      targetRotation.y = -0.4 + pointer.x * 0.18;
      group.rotation.x += (targetRotation.x - group.rotation.x) * 0.035;
      group.rotation.y += (targetRotation.y + now * 0.000045 - group.rotation.y) * 0.035;
      group.position.y = Math.sin(now * 0.00055) * 0.06;
    }
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const intersection = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      last = performance.now();
    },
    { threshold: 0.01 },
  );
  intersection.observe(container);

  return {
    setPaused(value) {
      paused = Boolean(value);
      last = performance.now();
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      scene.traverse((object) => {
        if (object.isMesh) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
