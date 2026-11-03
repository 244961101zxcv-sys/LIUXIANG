import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitViewControls } from './controls.js';

const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl'];
const DRACO_PATH = new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href;

export function extensionOf(name = '') {
  const clean = name.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

export function isModelFile(name = '') {
  return MODEL_EXTENSIONS.includes(extensionOf(name));
}

export class ModelViewer {
  constructor(container, { onReady, onProgress, onError } = {}) {
    this.container = container;
    this.onReady = onReady || (() => {});
    this.onProgress = onProgress || (() => {});
    this.onError = onError || (() => {});

    this.autoRotate = false;
    this.mixer = null;
    this.clock = new THREE.Clock();
    this.root = null;
    this._disposed = false;
    this._blobUrls = [];
    this._animationFrame = 0;
    this._dracoLoader = null;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'viewer-canvas';
    this.renderer.domElement.setAttribute('aria-label', '三维模型预览，可拖动旋转、平移和缩放');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b0c);
    this.scene.fog = new THREE.Fog(0x0a0b0c, 20, 80);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 2000);
    this.camera.position.set(0, 0, 6);

    this.controls = new OrbitViewControls(this.camera, this.renderer.domElement);

    this._setupEnvironment();
    this._setupLights();
    this._setupFloor();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();
    this._animate();
  }

  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.52;
    pmrem.dispose();
  }

  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x14141a, 1.15);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff1dd, 2.8);
    this.key.position.set(4, 7, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.rim = new THREE.DirectionalLight(0xe4eeff, 1.55);
    this.rim.position.set(-6, 3.5, -4);
    this.scene.add(this.rim);

    this.fill = new THREE.DirectionalLight(0x8aa7ff, 0.9);
    this.fill.position.set(5, 2, -3);
    this.scene.add(this.fill);
  }

  _setupFloor() {
    this.floorGroup = new THREE.Group();
    this.scene.add(this.floorGroup);

    this.shadowPlane = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.38, transparent: true }),
    );
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.receiveShadow = true;
    this.floorGroup.add(this.shadowPlane);

    this.platform = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1.018, 1, 96),
      new THREE.MeshStandardMaterial({
        color: 0x111214,
        roughness: 0.48,
        metalness: 0.55,
      }),
    );
    this.platform.receiveShadow = true;
    this.floorGroup.add(this.platform);

    this.platformRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.004, 8, 160),
      new THREE.MeshBasicMaterial({
        color: 0xc8ff3d,
        transparent: true,
        opacity: 0.42,
      }),
    );
    this.platformRing.rotation.x = Math.PI / 2;
    this.floorGroup.add(this.platformRing);

    this.grid = new THREE.GridHelper(20, 40, 0x2b2d27, 0x171817);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.32;
    this.grid.material.depthWrite = false;
    this.floorGroup.add(this.grid);
  }

  _placeStage(size, box) {
    const maxDim = Math.max(size.x, size.y, size.z);
    const floorY = box.min.y;
    const radius = Math.max(size.x, size.z) * 0.72 + maxDim * 0.08;

    this.shadowPlane.position.y = floorY + maxDim * 0.001;
    this.shadowPlane.scale.setScalar(Math.max(radius * 2.6, maxDim * 1.4));

    const thickness = Math.max(maxDim * 0.012, 0.004);
    this.platform.position.y = floorY - thickness / 2;
    this.platform.scale.set(radius, thickness, radius);

    this.platformRing.position.y = floorY + maxDim * 0.002;
    this.platformRing.scale.set(radius, radius, radius);

    const gridSize = Math.max(maxDim * 7, 8);
    this.grid.scale.setScalar(gridSize / 20);
    this.grid.position.y = floorY + maxDim * 0.0015;

    this.scene.fog.near = maxDim * 4;
    this.scene.fog.far = maxDim * 15;

    this.key.position.set(maxDim * 2.7, maxDim * 4.2, maxDim * 2.5);
    this.key.target.position.set(0, 0, 0);
    this.key.shadow.camera.left = -maxDim * 2.2;
    this.key.shadow.camera.right = maxDim * 2.2;
    this.key.shadow.camera.top = maxDim * 2.8;
    this.key.shadow.camera.bottom = -maxDim * 2.2;
    this.key.shadow.camera.near = Math.max(maxDim * 0.05, 0.01);
    this.key.shadow.camera.far = maxDim * 11;
    this.key.shadow.camera.updateProjectionMatrix();
    this.key.target.updateMatrixWorld();

    this.rim.position.set(-maxDim * 3.2, maxDim * 2.1, -maxDim * 2.2);
    this.fill.position.set(maxDim * 3.2, maxDim * 1.25, -maxDim * 1.8);

    return { maxDim, floorY };
  }

  _normalizeRoot(root) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error('模型里没有可显示的网格。');

    const center = box.getCenter(new THREE.Vector3());
    const wrapper = new THREE.Group();
    wrapper.add(root);
    // Offset the wrapper, not the model root, so root-level animation tracks
    // are not disturbed when we recenter the asset.
    wrapper.position.set(-center.x, -center.y, -center.z);
    wrapper.updateMatrixWorld(true);

    const normalizedBox = new THREE.Box3().setFromObject(wrapper);
    return { wrapper, box: normalizedBox };
  }

  async load(work, localRecord = null) {
    this._clearModel();

    const manager = new THREE.LoadingManager();
    const files = localRecord?.files || [];
    let mainUrl = work.model;
    let mainFile = null;
    let totalBytes = 0;

    if (files.length) {
      const map = new Map();
      const objectUrls = new Set();
      for (const file of files) {
        const name = (file.name || '').replace(/\\/g, '/').replace(/^\.?\//, '');
        const url = URL.createObjectURL(file.blob);
        this._blobUrls.push(url);
        objectUrls.add(url);
        totalBytes += file.blob?.size || 0;
        map.set(name, url);
        map.set(name.split('/').pop(), url);
      }
      manager.setURLModifier((url) => {
        if (!url || url.startsWith('data:')) return url;
        // Relative references inside a .gltf are resolved against the main
        // blob URL by GLTFLoader, producing blob URLs that do not exist.
        // Keep real object URLs, but map those synthetic ones back by filename.
        if (url.startsWith('blob:')) {
          if (objectUrls.has(url)) return url;
          const tail = url.split('/').pop().split('?')[0].split('#')[0];
          return map.get(tail) || url;
        }
        let clean = url;
        try {
          clean = decodeURIComponent(new URL(url, window.location.href).pathname);
        } catch {
          clean = decodeURIComponent(url);
        }
        clean = clean.replace(/^\/+/, '').replace(/^\.?\//, '');
        const base = clean.split('/').pop();
        return map.get(clean) || map.get(base) || url;
      });

      mainFile = files.find((file) => file.name === localRecord.entryFile)
        || files.find((file) => isModelFile(file.name));
      if (!mainFile) throw new Error('没有找到可加载的 .glb / .gltf / .obj / .stl 文件。');
      mainUrl = map.get(mainFile.name);
    }

    if (!mainUrl) throw new Error('这件作品还没有绑定 3D 模型。');

    const ext = extensionOf(mainFile?.name || mainUrl);
    let root;
    let animations = [];

    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader(manager);
      const draco = new DRACOLoader(manager);
      draco.setDecoderPath(DRACO_PATH);
      loader.setDRACOLoader(draco);
      this._dracoLoader = draco;
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          mainUrl,
          resolve,
          (event) => {
            if (event.lengthComputable && event.total) {
              this.onProgress(event.loaded / event.total);
            }
          },
          reject,
        );
      });
      root = gltf.scene || gltf.scenes?.[0];
      animations = gltf.animations || [];
      if (!root) throw new Error('GLTF 文件里没有场景。');
    } else if (ext === 'obj') {
      const loader = new OBJLoader(manager);
      const mtlFile = files.find((file) => extensionOf(file.name) === 'mtl');
      const mtlUrl = mtlFile
        ? (() => {
            // The map is local to the previous block; resolve a fresh object URL.
            const url = URL.createObjectURL(mtlFile.blob);
            this._blobUrls.push(url);
            return url;
          })()
        : work.mtl;
      if (mtlUrl) {
        const materials = await new MTLLoader(manager).loadAsync(mtlUrl);
        materials.preload();
        loader.setMaterials(materials);
      }
      root = await loader.loadAsync(mainUrl);
    } else if (ext === 'stl') {
      const geometry = await new STLLoader(manager).loadAsync(mainUrl);
      geometry.computeVertexNormals();
      root = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0xb8b9b3, roughness: 0.55, metalness: 0.08 }),
      );
    } else {
      throw new Error(`暂不支持 .${ext} 格式，请导出为 GLB。`);
    }

    if (!root) throw new Error('模型加载失败。');

    const { wrapper, box } = this._normalizeRoot(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.length() < 1e-6) throw new Error('模型尺寸为 0，无法显示。');

    let meshCount = 0;
    let triangles = 0;
    let vertices = 0;
    root.traverse((object) => {
      if (!object.isMesh) return;
      meshCount += 1;
      object.castShadow = true;
      object.receiveShadow = true;
      if (object.isSkinnedMesh) object.frustumCulled = false;
      const geometry = object.geometry;
      if (geometry) {
        const position = geometry.attributes?.position;
        if (position) vertices += position.count;
        if (geometry.index) triangles += geometry.index.count / 3;
        else if (position) triangles += position.count / 3;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        if ('envMapIntensity' in material) material.envMapIntensity = 0.9;
        for (const value of Object.values(material)) {
          if (value?.isTexture) {
            value.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          }
        }
      }
    });

    if (!meshCount) throw new Error('模型里没有可显示的网格。');

    this.root = wrapper;
    this.scene.add(wrapper);
    this._placeStage(size, box);
    this.controls.frameBox(box, 1.6);

    if (animations.length) {
      this.mixer = new THREE.AnimationMixer(root);
      const action = this.mixer.clipAction(animations[0]);
      action.play();
    }

    this.renderer.render(this.scene, this.camera);
    const info = {
      format: ext.toUpperCase(),
      triangles: Math.round(triangles),
      vertices,
      meshCount,
      animations: animations.length,
      bytes: totalBytes || null,
    };
    this.onReady(info);
    return info;
  }

  _clearModel() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    if (this.root) {
      this.root.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if (value?.isTexture) value.dispose();
          }
          material.dispose?.();
        }
      });
      this.scene.remove(this.root);
      this.root = null;
    }
    for (const url of this._blobUrls) URL.revokeObjectURL(url);
    this._blobUrls = [];
    if (this._dracoLoader) {
      this._dracoLoader.dispose();
      this._dracoLoader = null;
    }
  }

  setAutoRotate(enabled) {
    this.autoRotate = Boolean(enabled);
  }

  reset() {
    this.controls.reset();
  }

  captureCover(maxWidth = 720) {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const targetRatio = 4 / 5;
    let sw = source.width;
    let sh = source.height;
    if (sw / sh > targetRatio) sw = sh * targetRatio;
    else sh = sw / targetRatio;
    const outW = Math.min(maxWidth, Math.round(sw));
    const outH = Math.round(outW / targetRatio);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      source,
      Math.round((source.width - sw) / 2),
      Math.round((source.height - sh) / 2),
      Math.round(sw),
      Math.round(sh),
      0,
      0,
      outW,
      outH,
    );
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  _animate() {
    if (this._disposed) return;
    this._animationFrame = requestAnimationFrame(() => this._animate());
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.root && this.autoRotate && !this.controls.dragging) {
      this.controls.rotateBy(this.controls.autoRotateSpeed * delta);
    }
    if (this.mixer) this.mixer.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._animationFrame);
    this._resizeObserver?.disconnect();
    this._clearModel();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
