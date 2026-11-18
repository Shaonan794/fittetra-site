import { models, useDesktopAssets, modelUrl, posterUrl } from './models.js';

document.documentElement.classList.remove('no-js');
const node = document.querySelector('[data-stage]');
const art = node.closest('.chapter-art');
const poster = node.querySelector('.model-poster');
const slot = node.querySelector('.canvas-slot');
const caption = node.querySelector('[data-model-label]');
const message = art.querySelector('.stage-status');
const toggle = art.querySelector('.static-toggle');
const angles = [...art.querySelectorAll('[data-angle]')];
const choices = [...document.querySelectorAll('[data-look]')];
const steps = [...document.querySelectorAll('[data-story-step]')];
const story = steps.length > 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Must match the full-bleed media query in styles.css.
const fullFrame = matchMedia('(min-width: 761px) and (min-height: 561px)');
const connection = navigator.connection;
// Resolve once per visit: orientation/resize never upgrades a phone/tablet into HD.
const tier = useDesktopAssets(window.innerWidth, matchMedia('(pointer: fine)').matches, navigator.maxTouchPoints || 0, Boolean(connection?.saveData)) ? 'desktop' : 'mobile';
node.dataset.tier = tier;
const TAU = Math.PI * 2;
// Home choreography. progress runs 0–3 across the three chapters; each chapter swaps the outfit.
// 1: dog on the right turns from the front to the side. 2: it crosses left and the camera rises to look down
// over the back of the garment. 3: it swings back to the front on the right, then makes one full turn.
// tilt raises only the camera, so the view looks down; it stays off the rear quadrant in chapter 2.
const keys = [
  { p: 0, yaw: -.45, x: .2, zoom: 1, lift: 0, tilt: 0 },
  { p: .8, yaw: -1.2, x: .2, zoom: 1, lift: 0, tilt: 0 },
  { p: 1.3, yaw: -1.4, x: -.23, zoom: .94, lift: 0, tilt: .1 },
  { p: 1.85, yaw: -2, x: -.23, zoom: .98, lift: 0, tilt: .16 },
  { p: 2.3, yaw: -.45, x: .2, zoom: 1, lift: 0, tilt: 0 },
  { p: 3, yaw: -.45 - TAU, x: .2, zoom: 1, lift: 0, tilt: 0 },
];
const viewYaw = { front: 0, detail: -.96, side: -1.48, back: -Math.PI };
const fadeMs = 1100;
let selected = 0, shown = null, view = 'detail', progress = 0, chapter = 0, peek = 0;
let staticMode = reduced.matches || Boolean(connection?.saveData);
let visible = false, engine = null, creating = null, fade = null, generation = 0;
let frame = 0, scrollFrame = 0, last = 0;
let spin = 0, velocity = 0, dragging = null, touched = 0, slowFrames = 0;
let decodeQueue = Promise.resolve();
const target = { yaw: keys[0].yaw, x: 0, zoom: 1, lift: 0, tilt: 0 }, current = { ...target };

function controls() {
  toggle.hidden = reduced.matches;
  toggle.textContent = staticMode ? 'Load interactive 3D' : 'Use static view';
  for (const button of angles) {
    button.disabled = staticMode || reduced.matches;
    button.setAttribute('aria-pressed', String(button.dataset.angle === view));
  }
  choices.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.look) === selected)));
}
function describe(index) {
  node.dataset.model = String(index);
  node.setAttribute('aria-label', `${models[index].description}. ${index === 3 ? 'Base model comparison.' : 'Concept demo.'}`);
  poster.src = posterUrl(index);
  poster.alt = models[index].description;
  caption.textContent = models[index].label;
  const tag = node.querySelector('.concept-tag');
  tag.textContent = index === 3 ? 'Base model' : 'Concept demo';
}
function disposeModel(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  for (const material of materials) {
    Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
    material.dispose();
  }
  for (const texture of textures) { if (texture.source?.data) images.add(texture.source.data); texture.dispose(); }
  images.forEach(image => image.close?.());
  geometries.forEach(geometry => geometry.dispose());
}
function release() {
  generation++;
  fade = null; shown = null;
  cancelAnimationFrame(frame); frame = 0;
  slot.classList.remove('is-visible');
  poster.hidden = false;
  node.dataset.rendered = 'false';
  node.style?.removeProperty('--dog-x');
  node.dataset.loadState = 'static';
  if (!engine) return;
  engine.controllers.forEach(controller => controller.abort());
  engine.cache.forEach(entry => { engine.pivot.remove(entry.root); disposeModel(entry.root); });
  engine.cache.clear();
  engine.renderer.domElement.removeEventListener('webglcontextlost', contextLost);
  disposeModel(engine.shadow);
  engine.environment.dispose();
  engine.renderer.renderLists.dispose();
  engine.renderer.dispose();
  engine.renderer.forceContextLoss();
  engine.renderer.domElement.remove();
  engine = null;
}
function fallback(text) {
  staticMode = true;
  release(); describe(selected); controls();
  message.textContent = text;
}
function staticMessage() {
  return reduced.matches ? 'Reduced motion is on. Static previews only; choose any look below.'
    : 'Static preview. Choose a look, or load interactive 3D.';
}
function readyMessage() {
  return story ? 'Interactive model. Scroll to turn it and change outfits, or drag to turn it yourself.'
    : 'Interactive model. Drag to turn it, or choose a look and viewing angle.';
}
function contextLost(event) {
  event.preventDefault();
  fallback('3D paused by your device. Static previews are available; you can try 3D again.');
}
function groundShadow(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d'), gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,.6)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(.42, .78), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  return shadow;
}
async function createEngine() {
  if (engine) return engine;
  if (creating) return creating;
  creating = (async () => {
    const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
      import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/environments/RoomEnvironment.js'),
    ]);
    if (staticMode || reduced.matches || !visible || document.hidden) return null;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: tier === 'desktop', powerPreference: tier === 'desktop' ? 'high-performance' : 'low-power' });
    let environment;
    try {
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier === 'mobile' ? 1 : 2));
      renderer.setClearColor(0x111411, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
      try { environment = pmrem.fromScene(room, .04); } finally { room.dispose(); pmrem.dispose(); }
      const scene = new THREE.Scene();
      scene.environment = environment.texture;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x999999, 1));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(-2, 3, 3); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, .65);
      rim.position.set(2, 1, -1); scene.add(rim);
      const camera = new THREE.PerspectiveCamera(32, 1, .01, 10);
      const pivot = new THREE.Group(); scene.add(pivot);
      const shadow = groundShadow(THREE); pivot.add(shadow);
      renderer.domElement.addEventListener('webglcontextlost', contextLost, false);
      slot.replaceChildren(renderer.domElement);
      engine = { THREE, renderer, scene, camera, pivot, shadow, environment, loader: new GLTFLoader(), distance: 1,
        cache: new Map(), pending: new Map(), controllers: new Set(),
        // Shared by every outfit's dissolve shader: pivot space keeps the pattern fixed to the dog while it turns.
        local: { value: new THREE.Matrix4() }, edge: { value: new THREE.Color(0xd5fc74).multiplyScalar(2.4) } };
      resize();
      return engine;
    } catch (error) { environment?.dispose(); renderer.dispose(); renderer.forceContextLoss(); throw error; }
  })();
  try { return await creating; } finally { creating = null; }
}
async function fetchBytes(index, controller) {
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(modelUrl(index, tier), { signal: controller.signal });
    if (!response.ok) throw new Error(`Model response ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > (tier === 'mobile' ? 3000000 : 12000000)) throw new Error('Model delivery budget exceeded');
    return bytes;
  } finally { clearTimeout(timeout); }
}
// Outfit swap: the outgoing look burns away from the paws up while the incoming one fills the same band,
// with a lime edge on the seam. The supplied looks share one pose and frame, so the two halves meet.
const dissolveHead = `uniform float ftCut; uniform float ftMode; uniform vec2 ftRange; uniform vec3 ftEdge; varying vec3 ftPos;
float ftHash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float ftNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(ftHash(i),ftHash(i+vec3(1,0,0)),f.x),mix(ftHash(i+vec3(0,1,0)),ftHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(ftHash(i+vec3(0,0,1)),ftHash(i+vec3(1,0,1)),f.x),mix(ftHash(i+vec3(0,1,1)),ftHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
function addDissolve(material, uniforms) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 ftLocal; varying vec3 ftPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nftPos = (ftLocal * modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${dissolveHead}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat ftF = (ftPos.y - ftRange.x) / (ftRange.y - ftRange.x) + (ftNoise(ftPos * 38.) - .5) * .22;\nif (ftMode > .5 && ftF > ftCut || ftMode < -.5 && ftF < ftCut) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (abs(ftMode) > .5) totalEmissiveRadiance += ftEdge * (1. - smoothstep(0., .035, abs(ftF - ftCut)));');
  };
  material.customProgramCacheKey = () => 'ft-dissolve';
}
function prepare(current, root, index) {
  const { THREE } = current;
  const box = new THREE.Box3().setFromObject(root);
  const uniforms = { ftCut: { value: 0 }, ftMode: { value: 0 }, ftRange: { value: new THREE.Vector2(box.min.y, box.max.y) }, ftEdge: current.edge, ftLocal: current.local };
  root.traverse(object => {
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      addDissolve(material, uniforms);
      Object.values(material).forEach(value => { if (value?.isTexture) current.renderer.initTexture(value); });
    }
  });
  current.shadow.position.y = box.min.y + .002;
  root.visible = false;
  current.pivot.add(root);
  return { index, root, uniforms };
}
function evict(current) {
  // Desktop keeps every story look decoded for instant swaps; phones keep the shown look and one neighbour.
  const keep = new Set([shown, selected, fade?.from, fade?.to]);
  for (const [index, entry] of current.cache) {
    if (current.cache.size <= (tier === 'desktop' ? 4 : 2)) return;
    if (keep.has(index)) continue;
    current.pivot.remove(entry.root); disposeModel(entry.root); current.cache.delete(index);
  }
}
function loadEntry(index) {
  const current = engine;
  if (current.cache.has(index)) return Promise.resolve(current.cache.get(index));
  if (current.pending.has(index)) return current.pending.get(index);
  const controller = new AbortController();
  current.controllers.add(controller);
  const promise = (async () => {
    const bytes = await fetchBytes(index, controller);
    // Serialized: parallel decodes of large textures spike memory.
    const decode = decodeQueue.catch(() => {}).then(() => engine === current ? current.loader.parseAsync(bytes, '') : null);
    decodeQueue = decode;
    const gltf = await decode;
    if (!gltf) return null;
    if (engine !== current) { disposeModel(gltf.scene); return null; }
    // Supplied V2 transforms are already aligned. Do not recenter or rescale individual dogs.
    const entry = prepare(current, gltf.scene, index);
    current.cache.set(index, entry);
    evict(current);
    return entry;
  })().finally(() => { current.pending.delete(index); current.controllers.delete(controller); });
  current.pending.set(index, promise);
  return promise;
}
function warm() {
  // Background-load the other story looks one at a time, nearest chapter first.
  if (!engine || staticMode || shown === null || !story || connection?.saveData) return;
  const order = tier === 'desktop' ? [chapter + 1, chapter - 1, chapter + 2, chapter - 2] : [chapter + 1];
  const next = order.find(index => index >= 0 && index <= 2 && !engine.cache.has(index) && !engine.pending.has(index));
  if (next === undefined || engine.pending.size) return;
  loadEntry(next).then(warm, () => {});
}
function settleFade(index) {
  for (const look of [fade.from, fade.to]) {
    const entry = engine.cache.get(look);
    if (entry) { entry.root.visible = look === index; entry.uniforms.ftMode.value = 0; }
  }
  shown = index; fade = null;
}
function sync() {
  if (!engine || staticMode || reduced.matches) return;
  // Scrolling back mid-swap plays the dissolve in reverse instead of snapping.
  if (fade && (selected === fade.to || selected === fade.from)) { fade.dir = selected === fade.to ? 1 : -1; wake(); return; }
  if (!fade && shown === selected) return;
  const entry = engine.cache.get(selected);
  if (!entry) {
    node.dataset.loadState = 'loading';
    const token = generation;
    loadEntry(selected).then(() => { if (token === generation) sync(); }, error => {
      if (token !== generation) return;
      console.info('Fit Tetra: static fallback', error.name);
      fallback('Interactive view is unavailable. Choose a static preview, or try loading 3D again.');
    });
    return;
  }
  if (fade) settleFade(fade.dir > 0 ? fade.to : fade.from);
  if (shown === null || shown === selected) {
    entry.root.visible = true; shown = selected;
  } else {
    fade = { from: shown, to: selected, t: 0, dir: 1 };
    entry.root.visible = true;
  }
  node.dataset.loadState = 'ready';
  message.textContent = readyMessage();
  evict(engine); wake(); warm();
}
async function start() {
  if (staticMode || reduced.matches || !visible || document.hidden || engine || creating) return;
  node.dataset.loadState = 'loading';
  try {
    const current = await createEngine();
    if (current) sync(); else node.dataset.loadState = 'static';
  } catch (error) {
    console.info('Fit Tetra: static fallback', error.name);
    fallback('Interactive view is unavailable. Choose a static preview, or try loading 3D again.');
  }
}
function selectLook(index) {
  if (index === selected) return;
  selected = index; controls(); describe(index);
  if (staticMode || reduced.matches) message.textContent = staticMessage();
  else sync();
}
function resize() {
  if (!engine) return;
  const width = Math.max(1, slot.clientWidth), height = Math.max(1, slot.clientHeight);
  engine.renderer.setSize(width, height, false);
  engine.camera.aspect = width / height;
  const tangent = Math.tan(engine.THREE.MathUtils.degToRad(16));
  // One fixed frame for all four aligned models. Full-bleed keeps the dog inside one half of the screen.
  const [tall, wide] = story && fullFrame.matches ? [.66, .95] : [.48, .59];
  engine.distance = Math.max(tall / (2 * tangent), wide / (2 * tangent * engine.camera.aspect));
  wake();
}
function ease(t) { return t * t * (3 - 2 * t); }
function aim() {
  if (!story) { Object.assign(target, { yaw: viewYaw[view], x: 0, zoom: 1, lift: 0, tilt: 0 }); return; }
  let a = keys[0], b = keys[0];
  for (const key of keys) { b = key; if (key.p > progress) break; a = key; }
  const t = b === a ? 0 : ease((progress - a.p) / (b.p - a.p));
  for (const name of ['yaw', 'x', 'zoom', 'lift', 'tilt']) target[name] = a[name] + (b[name] - a[name]) * t;
  if (!fullFrame.matches) { target.x = 0; target.zoom = 1 + (target.zoom - 1) * .5; }
}
function storyProgress(height) {
  // Chapter i+1 begins when its copy reaches 60% of the viewport; the last ends when the sticky scene releases.
  const y = window.scrollY || 0, top = step => step.getBoundingClientRect().top + y;
  const marks = [0, top(steps[1]) - height * .6, top(steps[2]) - height * .6, steps[2].getBoundingClientRect().bottom + y - height];
  marks[0] = Math.min(0, marks[1] - 1);
  for (let i = 2; i < 4; i++) marks[i] = Math.max(marks[i], marks[i - 1] + 1);
  for (let i = 2; i >= 0; i--) if (y >= marks[i]) return Math.min(3, i + (y - marks[i]) / (marks[i + 1] - marks[i]));
  return 0;
}
function render() {
  const { camera, pivot, renderer, scene } = engine;
  pivot.rotation.y = current.yaw + spin;
  pivot.updateMatrixWorld();
  engine.local.value.copy(pivot.matrixWorld).invert();
  camera.position.set(0, .26 + current.lift + current.tilt, engine.distance / current.zoom);
  camera.lookAt(0, .205 + current.lift, 0);
  camera.updateProjectionMatrix();
  // Lens shift: slide the dog across the frame without changing perspective,
  // and keep it centred in the visible part of the scene while the panel is still below the header.
  camera.projectionMatrix.elements[8] = -2 * current.x;
  camera.projectionMatrix.elements[9] = -peek / Math.max(1, slot.clientHeight);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  renderer.render(scene, camera);
  node.style.setProperty('--dog-x', `${50 + current.x * 100}%`);
  if (!poster.hidden) {
    poster.hidden = true;
    slot.classList.add('is-visible');
  }
  node.dataset.rendered = 'true';
}
function tick(now) {
  frame = 0;
  if (!engine || shown === null || !visible || document.hidden || staticMode || reduced.matches) { last = 0; return; }
  const dt = last ? Math.min(.05, (now - last) / 1000) : 0;
  last = now;
  // Full-bleed frames are expensive on integrated GPUs: step resolution down after sustained slow frames.
  slowFrames = dt > .028 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
  if (slowFrames > 20 && engine.renderer.getPixelRatio() > 1) {
    slowFrames = 0;
    engine.renderer.setPixelRatio(Math.max(1, engine.renderer.getPixelRatio() - .5));
    resize();
  }
  let moving = false;
  const follow = 1 - Math.exp(-dt * 5.5);
  for (const name in target) {
    const gap = target[name] - current[name];
    if (Math.abs(gap) > 1e-4) { current[name] += gap * follow; moving = true; } else current[name] = target[name];
  }
  if (!dragging && Math.abs(velocity) > .01) { spin += velocity * dt; velocity *= Math.exp(-dt * 3.5); moving = true; }
  // On the home story, a drag is a detour: after a pause the dog returns to the scroll pose (by the shortest turn).
  if (story && !dragging && spin && now - touched > 1400) {
    const home = Math.round(spin / TAU) * TAU;
    spin += (home - spin) * (1 - Math.exp(-dt * 2.5));
    if (Math.abs(home - spin) < 1e-3) spin = 0; else moving = true;
  }
  if (fade) {
    fade.t = Math.min(1, Math.max(0, fade.t + fade.dir * dt * 1000 / fadeMs));
    const t = fade.t, cut = -.2 + 1.4 * (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const from = engine.cache.get(fade.from), to = engine.cache.get(fade.to);
    if (from) { from.uniforms.ftMode.value = -1; from.uniforms.ftCut.value = cut; }
    if (to) { to.uniforms.ftMode.value = 1; to.uniforms.ftCut.value = cut; }
    if (t >= 1 && fade.dir > 0) settleFade(fade.to); else if (t <= 0 && fade.dir < 0) settleFade(fade.from); else moving = true;
  }
  render();
  if (moving || dragging) frame = requestAnimationFrame(tick); else last = 0;
}
function wake() {
  if (frame || !engine || shown === null || !visible || document.hidden || staticMode || reduced.matches) return;
  frame = requestAnimationFrame(tick);
}
function onScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const height = window.innerHeight, rect = node.getBoundingClientRect();
    visible = rect.bottom > 0 && rect.top < height;
    if (story) {
      progress = storyProgress(height);
      const next = Math.min(2, Math.floor(progress));
      if (next !== chapter) { chapter = next; selectLook(next); }
      node.dataset.chapter = String(chapter);
      node.style?.setProperty('--progress', progress.toFixed(4));
      peek = fullFrame.matches ? Math.max(0, Math.min(height * .4, art.getBoundingClientRect().top)) : 0;
      art.style?.setProperty('--peek', `${peek}px`);
    }
    aim();
    if (!visible) { cancelAnimationFrame(frame); frame = 0; last = 0; return; }
    if (engine) { sync(); wake(); } else start();
  });
}
function turn(by) {
  if (!engine || staticMode || reduced.matches) return;
  spin += by; touched = performance.now(); wake();
}
node.addEventListener('pointerdown', event => {
  if (!engine || shown === null || staticMode || reduced.matches || event.button > 0 || event.target.closest('a, button')) return;
  dragging = { id: event.pointerId, x: event.clientX, t: event.timeStamp };
  velocity = 0; node.dataset.dragging = 'true';
  node.setPointerCapture(event.pointerId);
  wake();
});
node.addEventListener('pointermove', event => {
  if (dragging?.id !== event.pointerId) return;
  const delta = (event.clientX - dragging.x) * .0095;
  velocity = delta / Math.max(.008, (event.timeStamp - dragging.t) / 1000);
  dragging.x = event.clientX; dragging.t = event.timeStamp;
  turn(delta);
});
const endDrag = event => {
  if (dragging?.id !== event.pointerId) return;
  if (event.timeStamp - dragging.t > 80) velocity = 0;
  dragging = null; node.dataset.dragging = 'false'; touched = performance.now(); wake();
};
node.addEventListener('pointerup', endDrag);
node.addEventListener('pointercancel', endDrag);
node.addEventListener('keydown', event => {
  const step = { ArrowLeft: -.4, ArrowRight: .4 }[event.key];
  if (step === undefined || !engine) return;
  event.preventDefault(); turn(step);
});
choices.forEach(button => button.addEventListener('click', () => selectLook(Number(button.dataset.look))));
angles.forEach(button => button.addEventListener('click', () => {
  view = button.dataset.angle;
  // Fold any manual turn into the current pose so the view button turns the short way from where the dog is.
  current.yaw = (current.yaw + spin) % TAU; spin = 0; velocity = 0;
  const goal = viewYaw[view];
  current.yaw += Math.round((goal - current.yaw) / TAU) * TAU;
  controls(); aim(); wake();
}));
toggle.addEventListener('click', () => {
  if (reduced.matches) return;
  staticMode = !staticMode;
  if (staticMode) { release(); describe(selected); message.textContent = staticMessage(); }
  else { visible = true; start(); }
  controls();
});
if (!story) {
  const value = new URLSearchParams(location.search).get('look');
  if (/^[0-3]$/.test(value ?? '')) selected = Number(value);
}
if (story && !reduced.matches && typeof IntersectionObserver !== 'undefined') {
  // Copy rises in as each chapter reaches the middle band of the screen, and settles back out when it leaves.
  document.documentElement.classList.add('motion');
  const reveal = new IntersectionObserver(entries => entries.forEach(entry => entry.target.classList.toggle('is-in', entry.isIntersecting)), { rootMargin: '-30% 0px -30% 0px' });
  steps.forEach(step => { [...step.children].forEach((child, i) => child.style.setProperty('--i', i)); reveal.observe(step); });
}
reduced.addEventListener('change', () => { if (reduced.matches) fallback(staticMessage()); controls(); onScroll(); });
fullFrame.addEventListener?.('change', () => { resize(); onScroll(); });
connection?.addEventListener?.('change', () => { if (connection.saveData) fallback('Data saving is on. Static previews are available.'); });
new ResizeObserver(() => { resize(); onScroll(); }).observe(slot);
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0; } else onScroll(); });
window.addEventListener('pagehide', release);
window.addEventListener('pageshow', event => { if (event.persisted) onScroll(); });
describe(selected); controls();
message.textContent = staticMode ? staticMessage() : 'Static preview. 3D loads when the model comes into view.';
onScroll();
