import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const container = document.getElementById('farmCanvasContainer');
let scene, camera, renderer, clock;
let cropMesh, dataPoints = [], rainPoints, rainMaterial;
let mouseX = 0, mouseY = 0, scrollProgress = 0;

const DRY_COLOR = new THREE.Color('#8a6a3a');
const LUSH_COLOR = new THREE.Color('#2fae7a');
const MODE_ACCENT = {
  overview: '#34d399', health: '#34d399', soil: '#38bdf8',
  irrigation: '#38bdf8', yield: '#bef264', risk: '#fb7360', agents: '#f5a524'
};

function init() {
  if (!container || typeof THREE === 'undefined') return;
  const width = container.clientWidth, height = container.clientHeight || 480;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06090a, 0.032);

  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(0, 6.2, 10.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x2a3a30, 1.2));
  const sun = new THREE.DirectionalLight(0xbfe9d0, 1.1);
  sun.position.set(6, 10, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x38bdf8, 0.4);
  rim.position.set(-6, 4, -6);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 34),
    new THREE.MeshStandardMaterial({ color: 0x0d1a14, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  const rows = 12, cols = 18, count = rows * cols;
  const geo = new THREE.ConeGeometry(0.09, 0.34, 6);
  const mat = new THREE.MeshStandardMaterial({ color: LUSH_COLOR, roughness: 0.65, emissive: 0x0a2a1c, emissiveIntensity: 0.3 });
  cropMesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dummy.position.set(
        (c - cols / 2) * 0.55 + (Math.random() - 0.5) * 0.08,
        0.17,
        (r - rows / 2) * 0.65 + (Math.random() - 0.5) * 0.08
      );
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.scale.setScalar(0.85 + Math.random() * 0.3);
      dummy.updateMatrix();
      cropMesh.setMatrixAt(i++, dummy.matrix);
    }
  }
  scene.add(cropMesh);

  const dpGeo = new THREE.SphereGeometry(0.055, 12, 12);
  for (let n = 0; n < 8; n++) {
    const dpMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 1.5 });
    const sphere = new THREE.Mesh(dpGeo, dpMat);
    sphere.position.set((Math.random() - 0.5) * 9, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 7);
    sphere.userData.baseY = sphere.position.y;
    sphere.userData.phase = Math.random() * Math.PI * 2;
    scene.add(sphere);
    dataPoints.push(sphere);
  }

  const rainCount = 350;
  const positions = new Float32Array(rainCount * 3);
  for (let p = 0; p < rainCount; p++) {
    positions[p * 3] = (Math.random() - 0.5) * 14;
    positions[p * 3 + 1] = Math.random() * 8;
    positions[p * 3 + 2] = (Math.random() - 0.5) * 12;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  rainMaterial = new THREE.PointsMaterial({ color: 0x9fd8e8, size: 0.03, transparent: true, opacity: 0 });
  rainPoints = new THREE.Points(rainGeo, rainMaterial);
  scene.add(rainPoints);

  clock = new THREE.Clock();
  animate();

  window.addEventListener('resize', onResize);
  container.addEventListener('mousemove', onMouseMove);
  window.dispatchEvent(new CustomEvent('farmready'));
}

function onResize() {
  if (!container || !renderer) return;
  const width = container.clientWidth, height = container.clientHeight || 480;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function onMouseMove(e) {
  const rect = container.getBoundingClientRect();
  mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Scroll-driven cinematic push-in: starts higher/further back, descends and pushes in as the
  // farm section scrolls through. Mouse parallax is layered on top of whatever the scroll position sets.
  const baseY = 6.2 - scrollProgress * 2.1;
  const baseZ = 10.5 - scrollProgress * 3.4;
  const baseFov = 42 + scrollProgress * 6;

  camera.position.x += (mouseX * 1.6 - camera.position.x) * 0.02;
  camera.position.y += (baseY - mouseY * 0.7 - camera.position.y) * 0.03;
  camera.position.z += (baseZ - camera.position.z) * 0.03;
  if (Math.abs(camera.fov - baseFov) > 0.01) {
    camera.fov += (baseFov - camera.fov) * 0.04;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(0, 0.3, 0);

  dataPoints.forEach(dp => {
    dp.position.y = dp.userData.baseY + Math.sin(t * 0.8 + dp.userData.phase) * 0.12;
  });

  if (rainMaterial.opacity > 0.01) {
    const pos = rainPoints.geometry.attributes.position;
    for (let p = 0; p < pos.count; p++) {
      let y = pos.getY(p) - 0.13;
      if (y < 0) y = 8;
      pos.setY(p, y);
    }
    pos.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

function updateFromData({ soil_moisture_m3m3, rain_probability_next_12h }) {
  if (!cropMesh) return;
  if (typeof soil_moisture_m3m3 === 'number') {
    const t = THREE.MathUtils.clamp((soil_moisture_m3m3 - 0.05) / 0.35, 0, 1);
    cropMesh.material.color.copy(DRY_COLOR.clone().lerp(LUSH_COLOR, t));
  }
  if (typeof rain_probability_next_12h === 'number') {
    rainMaterial.opacity = THREE.MathUtils.clamp(rain_probability_next_12h / 140, 0, 0.55);
  }
}

function setMode(mode) {
  const accent = new THREE.Color(MODE_ACCENT[mode] || MODE_ACCENT.overview);
  dataPoints.forEach(dp => {
    dp.material.color.copy(accent);
    dp.material.emissive.copy(accent);
  });
}

function setScrollProgress(p) {
  scrollProgress = Math.max(0, Math.min(1, p));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.VerdantFarm = { updateFromData, setMode, setScrollProgress };
