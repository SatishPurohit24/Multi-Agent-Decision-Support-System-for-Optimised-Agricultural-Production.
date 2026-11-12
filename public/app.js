const hasGSAP = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
if (hasGSAP) gsap.registerPlugin(ScrollTrigger);

const presets = {
  nagpur:   { lat: 21.1458, lon: 79.0882, commodity: 'Tomato', state: 'Maharashtra', label: 'Tomato · Maharashtra' },
  nashik:   { lat: 19.9975, lon: 73.7898, commodity: 'Onion',  state: 'Maharashtra', label: 'Onion · Maharashtra' },
  ludhiana: { lat: 30.9010, lon: 75.8573, commodity: 'Wheat',  state: 'Punjab',      label: 'Wheat · Punjab' }
};

const el = id => document.getElementById(id);
const presetSelect = el('presetSelect');
const customRow = el('customRow');
const runBtn = el('runBtn');
const runStatus = el('runStatus');
const systemDot = el('systemDot');
const systemStatusText = el('systemStatusText');
const logPanel = el('logPanel');
const logEmpty = el('logEmpty');

presetSelect.addEventListener('change', () => {
  customRow.hidden = presetSelect.value !== 'custom';
});

function currentParams() {
  if (presetSelect.value === 'custom') {
    const commodity = el('customCommodity').value || 'Tomato';
    const state = el('customState').value || 'Maharashtra';
    return { lat: el('customLat').value || '21.1458', lon: el('customLon').value || '79.0882', commodity, state, label: `${commodity} · ${state}` };
  }
  return presets[presetSelect.value];
}

function setSystemStatus(mode, text) {
  systemDot.className = 'status-dot' + (mode ? ' ' + mode : '');
  systemStatusText.textContent = text;
}

function addLogEntry(message) {
  if (!logEmpty.hidden) logEmpty.hidden = true;
  const row = document.createElement('div');
  row.className = 'log-entry';
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString();
  const msg = document.createElement('span');
  msg.textContent = message;
  row.append(time, msg);
  logPanel.appendChild(row);
  logPanel.scrollTop = logPanel.scrollHeight;
}

/* ---------- animated counters ---------- */
function animateCount(id, target, { decimals = 0, suffix = '' } = {}) {
  const node = el(id);
  if (!node) return;
  const start = parseFloat(node.dataset.raw || '0');
  const startTime = performance.now();
  const duration = 800;
  function tick(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = start + (target - start) * eased;
    node.textContent = val.toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(tick); else node.dataset.raw = target;
  }
  requestAnimationFrame(tick);
}

/* ---------- reset between runs ---------- */
function resetUI() {
  logPanel.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'log-empty';
  empty.id = 'logEmpty';
  empty.textContent = 'Run started...';
  logPanel.appendChild(empty);

  document.querySelectorAll('.agent-card').forEach(card => {
    card.querySelector('[data-role="status"]').className = 'pill pill-idle';
    card.querySelector('[data-role="status"]').textContent = 'idle';
    card.querySelector('[data-role="body"]').textContent = 'Waiting for this agent to respond...';
    const meta = card.querySelector('[data-role="meta"]');
    meta.hidden = true; meta.innerHTML = '';
  });

  const pestPanel = el('pestDiseasePanel');
  if (pestPanel) pestPanel.hidden = true;

  ['weather', 'soil', 'pest', 'market'].forEach(a => {
    document.getElementById('node-' + a).classList.remove('thinking', 'done', 'story-lit');
    document.getElementById('edge-' + a).classList.remove('active', 'done', 'story-lit');
    document.getElementById('particle-' + a).setAttribute('opacity', '0');
  });
  document.getElementById('node-coordinator').classList.remove('thinking', 'done', 'story-lit');
  document.getElementById('edge-output').classList.remove('active', 'done');
  document.getElementById('particle-output').setAttribute('opacity', '0');
  clearNetworkSelection();

  el('planCard').classList.remove('revealed');
  el('planHeadline').textContent = 'Waiting for the coordinator...';
  el('planText').textContent = 'The coordinator will produce a plan once all four agents have responded.';
  el('planConflict').hidden = true;
  el('planOverride').hidden = true;
  const mechBodyEl = el('mechBody');
  if (mechBodyEl) mechBodyEl.innerHTML = '<p class="log-empty">Solving...</p>';
}

const urgencyTag = u => `<span class="tag tag-urgency-${u}">${u}</span>`;
const confidenceTag = c => `<span class="tag tag-confidence">confidence: ${c}</span>`;
function setRangeFill(id, ratio) {
  const fill = el(id);
  if (!fill) return;
  const width = Math.max(0, Math.min(1, ratio)) * 100;
  if (hasGSAP) gsap.to(fill, { attr: { width }, duration: 0.9, ease: 'power3.out' });
  else fill.setAttribute('width', width);
}

function updateStrip(payload) {
  if (payload.type === 'weather') {
    animateCount('val-rain', payload.rain_probability_next_12h, { suffix: '%' });
    animateCount('val-soil', payload.soil_moisture_m3m3, { decimals: 2 });
    setRangeFill('fill-rain', payload.rain_probability_next_12h / 100);
    setRangeFill('fill-soil', payload.soil_moisture_m3m3 / 0.5);
    const soil = payload.soil_moisture_m3m3;
    const tag = el('tag-soil');
    if (soil >= 0.20 && soil <= 0.35) { tag.textContent = 'optimal'; tag.className = 'tile-tag tag-lime'; }
    else { tag.textContent = soil < 0.20 ? 'low' : 'high'; tag.className = 'tile-tag tag-warn'; }
    window.VerdantFarm?.updateFromData(payload);
  }
  if (payload.type === 'market') {
    animateCount('val-market', payload.records.length);
    el('val-location').textContent = `${payload.commodity} · ${payload.state}`;
  }
}

function renderPestDiagnosis(payload) {
  const panel = el('pestDiseasePanel');
  const title = el('pestDiseaseTitle');
  const badgesRow = el('pestBadgesRow');
  const symptomsText = el('pestSymptomsText');
  if (!panel || !title) return;

  panel.hidden = false;
  title.textContent = payload.disease || 'Detected Condition';

  let badgesHtml = '';
  if (payload.pathogen) {
    badgesHtml += `<span class="badge-pathogen">${payload.pathogen}</span>`;
  }
  if (payload.severity) {
    badgesHtml += `<span class="badge-severity">Severity: ${payload.severity}</span>`;
  }
  badgesRow.innerHTML = badgesHtml;

  if (payload.symptoms) {
    symptomsText.innerHTML = `<strong>Observed Symptoms:</strong> ${payload.symptoms}`;
    symptomsText.hidden = false;
  } else {
    symptomsText.hidden = true;
  }
}

function updateAgentCard(payload) {
  const card = document.querySelector(`.agent-card[data-agent="${payload.agent}"]`);
  if (!card) return;
  const status = card.querySelector('[data-role="status"]');
  const body = card.querySelector('[data-role="body"]');
  const meta = card.querySelector('[data-role="meta"]');

  if (payload.status === 'thinking') {
    status.className = 'pill pill-thinking'; status.textContent = 'thinking';
    body.textContent = 'Reasoning over live data...';
    if (payload.agent === 'pest') {
      const panel = el('pestDiseasePanel');
      if (panel) panel.hidden = true;
    }
    return;
  }
  if (payload.status === 'error') {
    status.className = 'pill pill-error'; status.textContent = 'unavailable';
    body.textContent = payload.reason || 'This agent could not run.';
    return;
  }
  status.className = 'pill pill-done'; status.textContent = 'done';
  body.textContent = payload.action;
  meta.hidden = false;
  meta.innerHTML = urgencyTag(payload.urgency) + confidenceTag(payload.confidence);
  card.title = payload.reason;

  if (payload.agent === 'pest' && (payload.disease || payload.symptoms)) {
    renderPestDiagnosis(payload);
  }
}

function updateNetwork(payload) {
  const node = el('node-' + payload.agent);
  const edge = el('edge-' + payload.agent);
  const particle = el('particle-' + payload.agent);
  if (!node || !edge) return;
  if (payload.status === 'thinking') {
    node.classList.add('thinking'); node.classList.remove('done');
    edge.classList.add('active'); edge.classList.remove('done');
    particle.setAttribute('opacity', '1');
  } else {
    node.classList.remove('thinking'); node.classList.add('done');
    edge.classList.remove('active'); edge.classList.add('done');
    particle.setAttribute('opacity', '0');
  }
}

function updateCoordinator(payload) {
  const node = el('node-coordinator');
  const edge = el('edge-output');
  const particle = el('particle-output');
  if (payload.status === 'thinking') {
    node.classList.add('thinking'); node.classList.remove('done');
    edge.classList.add('active'); particle.setAttribute('opacity', '1');
    el('planHeadline').textContent = 'Coordinator is resolving conflicts...';
    return;
  }
  node.classList.remove('thinking'); node.classList.add('done');
  edge.classList.remove('active'); edge.classList.add('done'); particle.setAttribute('opacity', '0');

  el('planCard').classList.add('revealed');
  el('planHeadline').textContent = 'Final plan';
  el('planText').textContent = payload.plan;

  originalPlanText = payload.plan;
  isPlanTranslated = false;
  const transBtnText = el('transPlanBtnText');
  if (transBtnText) transBtnText.textContent = getCurrentDict().translate_plan_btn || 'Translate Plan';
  const transNote = el('planTransNote');
  if (transNote) transNote.hidden = true;

  // Auto-translate if viewing in regional or international language
  if (currentLang && currentLang !== 'en') {
    handleTranslatePlan(true);
  }

  if (hasGSAP) {
    gsap.fromTo(el('planCard'),
      { boxShadow: '0 0 0 rgba(56,189,248,0)', scale: 0.985 },
      { boxShadow: '0 0 70px rgba(56,189,248,.18)', scale: 1, duration: 0.6, ease: 'power2.out',
        onComplete: () => gsap.to(el('planCard'), { boxShadow: '0 0 60px rgba(56,189,248,.06)', duration: 1.2 }) });
  }

  const hasConflict = payload.conflict && payload.conflict.toUpperCase() !== 'NONE';
  el('planConflict').hidden = !hasConflict;
  if (hasConflict) el('conflictText').textContent = payload.conflict;

  const hasOverride = payload.overridden_agent && payload.overridden_agent.toUpperCase() !== 'NONE';
  el('planOverride').hidden = !hasOverride;
  if (hasOverride) el('overrideAgent').textContent = payload.overridden_agent;
}

/* ---------- run pipeline with automatic history recording ---------- */
function runAnalysis() {
  const p = currentParams();
  resetUI();
  runBtn.disabled = true;
  setSystemStatus('running', 'RUNNING');
  runStatus.textContent = `Running live analysis for ${p.label}...`;

  const activeRunSnapshot = {
    id: 'run_' + Date.now(),
    timestamp: new Date().toISOString(),
    displayTime: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    params: { ...p },
    strip: {},
    agents: {},
    coordinator: null,
    mechanism: null,
    leafName: el('leafQuickName')?.textContent || 'Sample Leaf',
    leafImage: el('leafPhoto')?.src || ''
  };

  const url = `/api/run?lat=${p.lat}&lon=${p.lon}&commodity=${encodeURIComponent(p.commodity)}&state=${encodeURIComponent(p.state)}`;
  const source = new EventSource(url);

  source.addEventListener('log', e => addLogEntry(JSON.parse(e.data).message));
  source.addEventListener('data', e => {
    const d = JSON.parse(e.data);
    activeRunSnapshot.strip[d.type] = d;
    updateStrip(d);
  });
  source.addEventListener('agent', e => {
    const d = JSON.parse(e.data);
    activeRunSnapshot.agents[d.agent] = d;
    updateAgentCard(d);
    updateNetwork(d);
  });
  source.addEventListener('coordinator', e => {
    const d = JSON.parse(e.data);
    activeRunSnapshot.coordinator = d;
    updateCoordinator(d);
  });
  source.addEventListener('mechanism', e => {
    const d = JSON.parse(e.data);
    activeRunSnapshot.mechanism = d;
    renderMechanism(d);
  });
  source.addEventListener('complete', () => {
    setSystemStatus('', 'SYSTEM READY');
    runStatus.textContent = 'Analysis complete. Run again anytime.';
    runBtn.disabled = false;
    source.close();
    saveRunToHistory(activeRunSnapshot);
    showToast('Analysis run automatically saved to History');
  });
  source.addEventListener('error', e => {
    let message = 'Connection lost.';
    try { message = JSON.parse(e.data).message; } catch (_) {}
    addLogEntry('Error: ' + message);
    setSystemStatus('error', 'SYSTEM ERROR');
    runStatus.textContent = 'Something went wrong — check the terminal running the server.';
    runBtn.disabled = false;
    source.close();
  });
}
runBtn.addEventListener('click', runAnalysis);

/* ---------- Leaf Image Upload & Disease Detection ---------- */
const leafPhoto = el('leafPhoto');
const pestImageEmpty = el('pestImageEmpty');
const leafFileInput = el('leafFileInput');
const uploadLeafBtn = el('uploadLeafBtn');
const diagnoseLeafBtn = el('diagnoseLeafBtn');
const resetLeafBtn = el('resetLeafBtn');
const leafDropzone = el('pestDropzone');
const leafSourceBadge = el('leafSourceBadge');
const leafQuickDot = el('leafQuickDot');
const leafQuickName = el('leafQuickName');
const leafQuickUploadBtn = el('leafQuickUploadBtn');

if (leafPhoto) {
  leafPhoto.addEventListener('error', () => {
    leafPhoto.style.display = 'none';
    if (pestImageEmpty) pestImageEmpty.hidden = false;
  });
  leafPhoto.addEventListener('load', () => {
    leafPhoto.style.display = 'block';
    if (pestImageEmpty) pestImageEmpty.hidden = true;
  });
}

function updateLeafBadges(isCustom, filename) {
  if (leafSourceBadge) {
    leafSourceBadge.textContent = isCustom ? 'Custom Upload' : 'Sample Leaf';
    leafSourceBadge.classList.toggle('badge-custom', isCustom);
  }
  if (leafQuickDot) {
    leafQuickDot.classList.toggle('custom', isCustom);
  }
  if (leafQuickName) {
    leafQuickName.textContent = isCustom ? (filename || 'Custom Uploaded Leaf') : 'Sample Leaf (Tomato)';
  }
}

async function checkLeafStatus() {
  try {
    const res = await fetch('/api/leaf-status');
    if (!res.ok) return;
    const data = await res.json();
    updateLeafBadges(data.isCustom, data.filename);
  } catch (_) {}
}
checkLeafStatus();

function uploadLeafFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Please upload a valid image file (JPEG, PNG, etc.)');
    return;
  }

  const reader = new FileReader();
  reader.onload = async e => {
    const dataUrl = e.target.result;
    // Immediate preview
    if (leafPhoto) {
      leafPhoto.src = dataUrl;
      leafPhoto.style.display = 'block';
      if (pestImageEmpty) pestImageEmpty.hidden = true;
    }

    addLogEntry(`Uploading custom crop leaf: ${file.name}...`);
    try {
      const res = await fetch('/api/upload-leaf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, filename: file.name })
      });
      const data = await res.json();
      if (data.success) {
        updateLeafBadges(true, file.name);
        addLogEntry(`Leaf uploaded successfully (${file.name}). Ready for disease diagnosis!`);
        const pestNode = el('node-pest');
        if (pestNode) {
          pestNode.classList.add('story-lit');
          setTimeout(() => pestNode.classList.remove('story-lit'), 2000);
        }
      } else {
        addLogEntry('Leaf upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      addLogEntry('Leaf upload failed: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

if (uploadLeafBtn && leafFileInput) {
  uploadLeafBtn.addEventListener('click', () => leafFileInput.click());
}
if (leafQuickUploadBtn && leafFileInput) {
  leafQuickUploadBtn.addEventListener('click', () => {
    el('pestAgentCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    leafFileInput.click();
  });
}
if (leafFileInput) {
  leafFileInput.addEventListener('change', () => {
    if (leafFileInput.files && leafFileInput.files[0]) {
      uploadLeafFile(leafFileInput.files[0]);
    }
  });
}

// Drag & drop on pestDropzone
if (leafDropzone) {
  ['dragenter', 'dragover'].forEach(evName => {
    leafDropzone.addEventListener(evName, e => {
      e.preventDefault();
      e.stopPropagation();
      leafDropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evName => {
    leafDropzone.addEventListener(evName, e => {
      e.preventDefault();
      e.stopPropagation();
      leafDropzone.classList.remove('dragover');
    });
  });
  leafDropzone.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      uploadLeafFile(files[0]);
    }
  });
}

// Dedicated "Find Disease" button
if (diagnoseLeafBtn) {
  diagnoseLeafBtn.addEventListener('click', async () => {
    diagnoseLeafBtn.disabled = true;
    updateAgentCard({ agent: 'pest', status: 'thinking' });
    updateNetwork({ agent: 'pest', status: 'thinking' });
    addLogEntry('Running standalone Pest & Disease diagnosis on active leaf...');

    try {
      const res = await fetch('/api/diagnose-leaf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.success && data.diagnosis) {
        updateAgentCard({ ...data.diagnosis, status: 'done' });
        updateNetwork({ agent: 'pest', status: 'done' });
        addLogEntry(`Leaf Disease Identified: ${data.diagnosis.disease} (${data.diagnosis.severity || 'severity unrated'}). Recommendation: ${data.diagnosis.action}`);
      } else {
        updateAgentCard({ agent: 'pest', status: 'error', reason: data.error || 'Diagnosis failed' });
        updateNetwork({ agent: 'pest', status: 'done' });
        addLogEntry(`Disease diagnosis failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      updateAgentCard({ agent: 'pest', status: 'error', reason: err.message });
      updateNetwork({ agent: 'pest', status: 'done' });
      addLogEntry(`Disease diagnosis failed: ${err.message}`);
    } finally {
      diagnoseLeafBtn.disabled = false;
    }
  });
}

// "Reset to Sample" button
if (resetLeafBtn) {
  resetLeafBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/reset-leaf', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        if (leafPhoto) {
          leafPhoto.src = data.imageUrl;
          leafPhoto.style.display = 'block';
          if (pestImageEmpty) pestImageEmpty.hidden = true;
        }
        updateLeafBadges(false);
        const panel = el('pestDiseasePanel');
        if (panel) panel.hidden = true;
        const card = document.querySelector('.agent-card[data-agent="pest"]');
        if (card) {
          card.querySelector('[data-role="status"]').className = 'pill pill-idle';
          card.querySelector('[data-role="status"]').textContent = 'idle';
          card.querySelector('[data-role="body"]').textContent = 'Reset to sample tomato leaf. Click "Find Disease" or "Run live analysis" to inspect.';
          const meta = card.querySelector('[data-role="meta"]');
          if (meta) meta.hidden = true;
        }
        addLogEntry('Reset to default sample tomato leaf.');
      }
    } catch (err) {
      console.error(err);
    }
  });
}

/* ---------- mode tabs -> farm scene ---------- */
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    window.VerdantFarm?.setMode(tab.dataset.mode);
  });
});

/* ---------- network node click-to-highlight ---------- */
const agentIds = ['weather', 'soil', 'pest', 'market'];
let selectedAgent = null;
function clearNetworkSelection() {
  selectedAgent = null;
  document.querySelectorAll('.network .node, .network .edge').forEach(n => n.classList.remove('dimmed'));
}
agentIds.forEach(a => {
  el('node-' + a).addEventListener('click', () => {
    if (selectedAgent === a) { clearNetworkSelection(); return; }
    selectedAgent = a;
    agentIds.forEach(other => {
      const dim = other !== a;
      el('node-' + other).classList.toggle('dimmed', dim);
      el('edge-' + other).classList.toggle('dimmed', dim);
    });
  });
});
el('node-coordinator').addEventListener('click', clearNetworkSelection);

/* ---------- scroll reveal (GSAP cinematic, falls back to IntersectionObserver if GSAP fails to load) ---------- */
document.querySelectorAll('.strip-tile, .agent-card').forEach(t => t.setAttribute('data-reveal', ''));

if (hasGSAP) {
  document.querySelectorAll('[data-reveal]').forEach((target, i) => {
    const isCard = target.matches('.strip-tile, .agent-card');
    gsap.fromTo(target,
      { opacity: 0, y: 34, filter: 'blur(6px)' },
      {
        opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.85, ease: 'power3.out',
        delay: isCard ? (i % 4) * 0.08 : 0,
        scrollTrigger: { trigger: target, start: 'top 88%', toggleActions: 'play none none none' }
      }
    );
  });
} else {
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('revealed'); io.unobserve(entry.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('[data-reveal]').forEach(t => io.observe(t));
}

/* ---------- hero cinematic entrance ---------- */
if (hasGSAP) {
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .fromTo('.eyebrow', { opacity: 0, y: 16, filter: 'blur(4px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7 })
    .fromTo('.hero h1', { opacity: 0, y: 26, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9 }, '-=0.45')
    .fromTo('.hero-sub', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7 }, '-=0.5')
    .fromTo('.run-panel', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7 }, '-=0.4');
}

/* ---------- farm section: scroll-driven cinematic camera ---------- */
if (hasGSAP) {
  ScrollTrigger.create({
    trigger: '.farm-section',
    start: 'top 80%',
    end: 'bottom 20%',
    scrub: 0.6,
    onUpdate: self => window.VerdantFarm?.setScrollProgress(self.progress)
  });
}

/* ---------- network section: unpinned lightweight reveal (zero scroll resistance) ---------- */
if (hasGSAP) {
  const storyOrder = ['weather', 'soil', 'pest', 'market'];
  ScrollTrigger.create({
    trigger: '.network-section',
    start: 'top 80%',
    once: false,
    onEnter: () => {
      storyOrder.forEach((agent, i) => {
        setTimeout(() => {
          el('node-' + agent)?.classList.add('story-lit');
          el('edge-' + agent)?.classList.add('story-lit');
          setTimeout(() => {
            el('node-' + agent)?.classList.remove('story-lit');
            el('edge-' + agent)?.classList.remove('story-lit');
          }, 800);
        }, i * 160);
      });
      setTimeout(() => {
        el('node-coordinator')?.classList.add('story-lit');
        setTimeout(() => el('node-coordinator')?.classList.remove('story-lit'), 900);
      }, storyOrder.length * 160 + 80);
    }
  });
}

/* ---------- nav sliding indicator + scroll transform + active section ---------- */
const nav = el('mainNav');
window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 40));
const navLinks = document.querySelectorAll('.nav-links a');
const navSections = document.querySelectorAll('main > section[id]');
const navIndicator = el('navIndicator');
function moveIndicator(link) {
  if (!link || !navIndicator) return;
  const linkBox = link.getBoundingClientRect();
  const parentBox = link.closest('.nav-links').getBoundingClientRect();
  const x = linkBox.left - parentBox.left, w = linkBox.width;
  if (hasGSAP) gsap.to(navIndicator, { x, width: w, duration: 0.4, ease: 'power2.out' });
  else { navIndicator.style.transform = `translateX(${x}px)`; navIndicator.style.width = w + 'px'; }
}
const sectionIO = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const link = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      navLinks.forEach(l => l.classList.toggle('active', l === link));
      moveIndicator(link);
    }
  });
}, { rootMargin: '-35% 0px -55% 0px' });
navSections.forEach(s => sectionIO.observe(s));

/* ---------- card tilt ---------- */
function attachTilt(selector, maxTilt) {
  document.querySelectorAll(selector).forEach(card => {
    if (hasGSAP) {
      const setX = gsap.quickTo(card, 'rotationX', { duration: 0.4, ease: 'power3.out' });
      const setY = gsap.quickTo(card, 'rotationY', { duration: 0.4, ease: 'power3.out' });
      const setLift = gsap.quickTo(card, 'y', { duration: 0.4, ease: 'power3.out' });
      gsap.set(card, { transformPerspective: 800 });
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        setX(-py * maxTilt); setY(px * maxTilt); setLift(-2);
      });
      card.addEventListener('mouseleave', () => { setX(0); setY(0); setLift(0); });
    } else {
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(800px) rotateX(${(-py * maxTilt).toFixed(2)}deg) rotateY(${(px * maxTilt).toFixed(2)}deg) translateY(-2px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    }
  });
}
attachTilt('.agent-card', 5);
attachTilt('.strip-tile', 4);
attachTilt('.plan-card', 2.5);

/* ---------- magnetic run button ---------- */
if (hasGSAP) {
  const magX = gsap.quickTo(runBtn, 'x', { duration: 0.35, ease: 'power3.out' });
  const magY = gsap.quickTo(runBtn, 'y', { duration: 0.35, ease: 'power3.out' });
  runBtn.addEventListener('mousemove', e => {
    const rect = runBtn.getBoundingClientRect();
    magX((e.clientX - rect.left - rect.width / 2) * 0.25);
    magY((e.clientY - rect.top - rect.height / 2) * 0.25);
  });
  runBtn.addEventListener('mouseleave', () => { magX(0); magY(0); });
} else {
  runBtn.addEventListener('mousemove', e => {
    const rect = runBtn.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * 0.25;
    const y = (e.clientY - rect.top - rect.height / 2) * 0.25;
    runBtn.style.transform = `translate(${x}px, ${y}px)`;
  });
  runBtn.addEventListener('mouseleave', () => { runBtn.style.transform = ''; });
}

/* ---------- cursor glow in hero ---------- */
const hero = document.querySelector('.hero');
const cursorGlow = el('cursorGlow');
hero.addEventListener('mousemove', e => {
  const rect = hero.getBoundingClientRect();
  cursorGlow.style.setProperty('--x', (e.clientX - rect.left) + 'px');
  cursorGlow.style.setProperty('--y', (e.clientY - rect.top) + 'px');
});

/* ---------- lightweight hero particle field (2D canvas, no dependency) ---------- */
(function heroParticles() {
  const canvas = el('heroCanvas');
  const ctx = canvas.getContext('2d');
  let w, h, points;
  const COUNT = 46;

  function size() {
    w = canvas.width = hero.clientWidth;
    h = canvas.height = hero.clientHeight + 40;
  }
  function seed() {
    points = Array.from({ length: COUNT }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    points.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    });
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          ctx.strokeStyle = `rgba(52,211,153,${0.14 * (1 - dist / 130)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(points[j].x, points[j].y); ctx.stroke();
        }
      }
    }
    points.forEach(p => {
      ctx.fillStyle = 'rgba(56,189,248,0.55)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    requestAnimationFrame(frame);
  }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    size(); seed(); frame();
    window.addEventListener('resize', size);
  }
})();


/* ---------- Clearing mechanism panel ---------- */
function renderMechanism(m) {
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const days = ['Today', 'Day 2', 'Day 3'];
  const row = (label, arr, cls) => `<tr class="${cls || ''}"><th>${label}</th>${arr.map(a => `<td><span class="act act-${a}">${a}</span></td>`).join('')}</tr>`;
  const b = m.baseline || {};
  const joint = (m.independent_joint_events || []).map(e => `<li>${esc(e.why)} (day ${e.d + 1} to ${e.d + 2})</li>`).join('') || '<li>none</li>';
  const infl = Object.entries(m.influence || {}).map(([k, v]) => `<span class="tag">${k}: ${v}</span>`).join(' ');
  const ov = (m.overridden_today || [])[0];
  const mechBody = el('mechBody');
  if (!mechBody) return;
  mechBody.innerHTML = `
    <article class="mech-card"><h3>Cleared Optimization Plan</h3>
      <table class="mech-table"><tr><th></th>${days.map(d => `<th>${d}</th>`).join('')}</tr>${row('Optimal Schedule', m.plan[0], 'mech-win')}${row('Independent (no coupling)', m.independent_plan[0])}</table>
      <p class="mech-note">Landscape risk <strong>${m.landscape_risk}</strong> (cap ${m.tau}) vs <strong>${m.independent_risk}</strong> if each day were optimised independently. Feasible: ${m.feasible ? 'yes' : 'no'}.</p></article>
    <article class="mech-card"><h3>Why</h3>
      <p class="mech-note">Binding constraints: <strong>${(m.binding || []).join(', ') || 'none'}</strong>.<br>Overridden today: <strong>${ov ? `${ov.agent} (wanted ${ov.preferred}, gave up ${ov.lost})` : 'none'}</strong>.</p>
      <p class="mech-note">Harmful joint combinations the independent plan would have created:</p><ul class="mech-list">${joint}</ul>
      <p class="mech-note">Agent influence (welfare others lose because this agent is present): ${infl}</p></article>
    <article class="mech-card"><h3>Baseline: LLM-only coordinator</h3>
      <p class="mech-note">${b.error ? 'Baseline failed: ' + esc(b.error) : `<strong>Plan:</strong> ${esc(b.plan)}<br><strong>Conflict:</strong> ${esc(b.conflict)}<br><strong>Overridden:</strong> ${esc(b.overridden_agent)}`}</p>
      <p class="mech-note">The baseline has no risk model or constraint check, so its plan can break the water, resistance or risk limits without any warning.</p></article>`;
}

/* ==========================================================================
   DECISION HISTORY & STORAGE SYSTEM
   ========================================================================== */
const HISTORY_KEY = 'verdant_decision_history_v1';
let toastTimeout = null;

function showToast(msg) {
  const toast = el('saveToast');
  const msgEl = el('toastMsg');
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3500);
}

function getStoredHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function persistHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
  } catch (err) {
    console.warn('Failed to save to localStorage', err);
  }
}

function saveRunToHistory(runRecord) {
  if (!runRecord) return;
  const list = getStoredHistory();
  list.unshift(runRecord);
  persistHistory(list);
  renderHistoryUI(el('historySearchInput')?.value || '');
}

function renderHistoryUI(filterText = '') {
  const list = getStoredHistory();
  const historyListEl = el('historyList');
  const countEl = el('historyCount');
  const navBadgeEl = el('historyNavBadge');
  const dockBadgeEl = el('dockBadge');
  const lastSavedEl = el('historyLastSaved');
  if (!historyListEl) return;

  if (countEl) countEl.textContent = list.length;
  if (navBadgeEl) navBadgeEl.textContent = list.length;
  if (dockBadgeEl) dockBadgeEl.textContent = list.length;

  if (list.length > 0 && lastSavedEl) {
    lastSavedEl.textContent = `Last run saved: ${list[0].displayTime}`;
  } else if (lastSavedEl) {
    lastSavedEl.textContent = 'No runs recorded yet';
  }

  const query = (filterText || '').trim().toLowerCase();
  const filtered = query
    ? list.filter(item => {
        const crop = item.params?.commodity || '';
        const state = item.params?.state || '';
        const label = item.params?.label || '';
        const disease = item.agents?.pest?.disease || '';
        const plan = item.coordinator?.plan || '';
        return (crop + ' ' + state + ' ' + label + ' ' + disease + ' ' + plan).toLowerCase().includes(query);
      })
    : list;

  if (filtered.length === 0) {
    historyListEl.innerHTML = `
      <div class="history-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>${query ? 'No matching history found' : 'No analysis history saved yet.'}</p>
        <span>${query ? 'Try searching for a different crop name or state.' : 'Run a live analysis above — every decision, disease detection, and coordinated plan will be automatically saved here.'}</span>
      </div>`;
    return;
  }

  historyListEl.innerHTML = filtered.map(item => {
    const cropLabel = item.params?.label || (item.params?.commodity ? `${item.params.commodity} · ${item.params.state}` : 'Farm Analysis');
    const weather = item.strip?.weather;
    const rain = weather?.rain_probability_next_12h !== undefined ? `${weather.rain_probability_next_12h}% Rain` : null;
    const soil = weather?.soil_moisture_m3m3 !== undefined ? `${weather.soil_moisture_m3m3} m³/m³ Soil` : null;
    const pest = item.agents?.pest;
    const diseaseChip = pest?.disease && pest.disease !== 'Unknown' && pest.disease !== 'Diagnosis Error'
      ? `<span class="history-chip history-chip-disease">${pest.disease} (${pest.severity || 'detected'})</span>`
      : '';
    const planSnippet = item.coordinator?.plan
      ? (item.coordinator.plan.length > 180 ? item.coordinator.plan.slice(0, 180) + '...' : item.coordinator.plan)
      : 'Plan recorded';
    const conflict = item.coordinator?.conflict && item.coordinator.conflict.toUpperCase() !== 'NONE'
      ? `Conflict resolved: ${item.coordinator.conflict}`
      : 'No conflicting directives';

    return `
      <article class="history-card" data-history-id="${item.id}">
        <div class="history-card-top">
          <div class="history-card-title-group">
            <span class="history-card-crop">${cropLabel}</span>
            <span class="history-card-time">${item.displayTime}</span>
          </div>
          <div class="history-card-tags">
            ${rain ? `<span class="history-chip history-chip-rain">${rain}</span>` : ''}
            ${soil ? `<span class="history-chip history-chip-soil">${soil}</span>` : ''}
            ${diseaseChip}
          </div>
        </div>
        <div class="history-card-plan">
          <strong>Coordinated Action Plan</strong>
          ${planSnippet}
        </div>
        <div class="history-card-bottom">
          <span class="history-card-conflict">${conflict}</span>
          <div class="history-card-actions">
            <button type="button" class="btn-history-restore" data-action="restore" data-id="${item.id}">Restore View</button>
            <button type="button" class="btn-history-subtle" data-action="copy" data-id="${item.id}">Copy Plan</button>
            <button type="button" class="btn-history-subtle btn-history-del" data-action="delete" data-id="${item.id}" title="Delete record">✕</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

function restoreHistoryRun(id) {
  const list = getStoredHistory();
  const run = list.find(r => r.id === id);
  if (!run) return;

  // Restore selector
  if (run.params) {
    if (run.params.commodity && ['Tomato', 'Onion', 'Wheat'].includes(run.params.commodity)) {
      if (run.params.commodity === 'Tomato') presetSelect.value = 'nagpur';
      else if (run.params.commodity === 'Onion') presetSelect.value = 'nashik';
      else if (run.params.commodity === 'Wheat') presetSelect.value = 'ludhiana';
      customRow.hidden = true;
    } else {
      presetSelect.value = 'custom';
      customRow.hidden = false;
      el('customCommodity').value = run.params.commodity || '';
      el('customState').value = run.params.state || '';
      el('customLat').value = run.params.lat || '';
      el('customLon').value = run.params.lon || '';
    }
  }

  // Restore strip & 3D farm
  if (run.strip) {
    if (run.strip.weather) updateStrip(run.strip.weather);
    if (run.strip.market) updateStrip(run.strip.market);
  }

  // Restore agents
  if (run.agents) {
    Object.values(run.agents).forEach(ag => {
      updateAgentCard({ ...ag, status: 'done' });
      updateNetwork({ ...ag, status: 'done' });
    });
    if (run.agents.pest) {
      renderPestDiagnosis(run.agents.pest);
    }
  }

  // Restore coordinator
  if (run.coordinator) {
    updateCoordinator({ ...run.coordinator, status: 'done' });
  }

  // Restore mechanism
  if (run.mechanism) {
    renderMechanism(run.mechanism);
  }

  addLogEntry(`Restored historical run from ${run.displayTime} (${run.params?.label || 'Farm Run'})`);
  showToast(`Restored past record: ${run.params?.label || run.displayTime}`);
  el('planCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteHistoryItem(id) {
  let list = getStoredHistory();
  list = list.filter(item => item.id !== id);
  persistHistory(list);
  renderHistoryUI(el('historySearchInput')?.value || '');
  showToast('Record deleted from history');
}

function clearAllHistory() {
  const list = getStoredHistory();
  if (list.length === 0) return;
  if (!confirm('Are you sure you want to clear all saved decision history?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistoryUI();
  showToast('All decision history cleared');
}

function exportHistoryJson() {
  const list = getStoredHistory();
  if (list.length === 0) {
    alert('No history records to export.');
    return;
  }
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verdant-decision-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// History event delegation
const historyListContainer = el('historyList');
if (historyListContainer) {
  historyListContainer.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'restore') {
      restoreHistoryRun(id);
    } else if (action === 'delete') {
      deleteHistoryItem(id);
    } else if (action === 'copy') {
      const list = getStoredHistory();
      const run = list.find(r => r.id === id);
      if (run) {
        const text = `Verdant Farm Advisory — ${run.params?.label || 'Run'}\nDate: ${run.displayTime}\nPlan: ${run.coordinator?.plan || 'N/A'}\nConflict: ${run.coordinator?.conflict || 'None'}`;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy Plan', 1800);
        });
      }
    }
  });
}

// History actions
el('historySearchInput')?.addEventListener('input', e => renderHistoryUI(e.target.value));
el('clearHistoryBtn')?.addEventListener('click', clearAllHistory);
el('exportHistoryBtn')?.addEventListener('click', exportHistoryJson);

/* ==========================================================================
   MULTI-LANGUAGE TRANSLATION ENGINE & PLAN TRANSLATOR
   ========================================================================== */
let currentLang = localStorage.getItem('verdant_lang') || 'en';
const langSelector = el('langSelector');
let originalPlanText = '';
let translatedPlanCache = {};
let isPlanTranslated = false;

function getCurrentDict() {
  const all = window.VerdantTranslations || {};
  return all[currentLang] || all.en || {};
}

function applyLanguage(lang, triggerToast = true) {
  if (lang === 'google') {
    const combo = document.querySelector('.goog-te-combo');
    if (combo) {
      combo.focus();
    } else {
      const gElem = el('google_translate_element');
      if (gElem) gElem.style.display = 'block';
    }
    showToast('Select any language from the Google Translate menu');
    return;
  }

  currentLang = lang;
  localStorage.setItem('verdant_lang', lang);
  if (langSelector && langSelector.value !== lang) {
    langSelector.value = lang;
  }
  document.documentElement.lang = lang;

  const dict = getCurrentDict();

  // Apply to all elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const key = node.dataset.i18n;
    if (dict[key]) {
      if (dict[key].includes('<br>') || dict[key].includes('<strong>') || dict[key].includes('&')) {
        node.innerHTML = dict[key];
      } else {
        node.textContent = dict[key];
      }
    }
  });

  // Presets
  const optNag = presetSelect?.querySelector('option[value="nagpur"]');
  if (optNag && dict.preset_nagpur) optNag.textContent = dict.preset_nagpur;
  const optNash = presetSelect?.querySelector('option[value="nashik"]');
  if (optNash && dict.preset_nashik) optNash.textContent = dict.preset_nashik;
  const optLud = presetSelect?.querySelector('option[value="ludhiana"]');
  if (optLud && dict.preset_ludhiana) optLud.textContent = dict.preset_ludhiana;
  const optCust = presetSelect?.querySelector('option[value="custom"]');
  if (optCust && dict.preset_custom) optCust.textContent = dict.preset_custom;

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    const key = 'tab_' + tab.dataset.mode;
    if (dict[key]) tab.textContent = dict[key];
  });

  // Strip tiles
  const rainLbl = el('tile-weather')?.querySelector('.tile-label');
  if (rainLbl && dict.strip_rain) rainLbl.textContent = dict.strip_rain;
  const soilLbl = el('tile-soil')?.querySelector('.tile-label');
  if (soilLbl && dict.strip_soil) soilLbl.textContent = dict.strip_soil;
  const mktLbl = el('tile-market')?.querySelector('.tile-label');
  if (mktLbl && dict.strip_market) mktLbl.textContent = dict.strip_market;
  const locLbl = el('tile-location')?.querySelector('.tile-label');
  if (locLbl && dict.strip_location) locLbl.textContent = dict.strip_location;

  // Jump pills
  document.querySelectorAll('.quick-jump-pill').forEach(pill => {
    const href = pill.getAttribute('href');
    if (href === '#network' && dict.jump_network) pill.textContent = dict.jump_network;
    else if (href === '#plan' && dict.jump_plan) pill.textContent = dict.jump_plan;
    else if (href === '#farm' && dict.jump_farm) pill.textContent = dict.jump_farm;
    else if (href === '#agents' && dict.jump_agents) pill.textContent = dict.jump_agents;
  });

  // Quick dock
  const dockFarm = document.querySelector('.dock-btn[href="#farm"]');
  if (dockFarm && dict.dock_farm) dockFarm.textContent = dict.dock_farm;
  const dockNet = document.querySelector('.dock-btn[href="#network"]');
  if (dockNet && dict.dock_network) dockNet.textContent = dict.dock_network;
  const dockAg = document.querySelector('.dock-btn[href="#agents"]');
  if (dockAg && dict.dock_agents) dockAg.textContent = dict.dock_agents;
  const dockPl = document.querySelector('.dock-btn[href="#plan"]');
  if (dockPl && dict.dock_plan) dockPl.textContent = dict.dock_plan;
  const dockHist = document.querySelector('.dock-btn[href="#history"]');
  if (dockHist && dict.dock_history) {
    const badge = dockHist.querySelector('.dock-badge');
    dockHist.textContent = dict.dock_history + ' ';
    if (badge) dockHist.appendChild(badge);
  }

  // Translate Plan button text
  const transPlanBtnText = el('transPlanBtnText');
  if (transPlanBtnText && dict.translate_plan_btn) {
    transPlanBtnText.textContent = isPlanTranslated ? (dict.show_original_plan || 'Show Original') : (dict.translate_plan_btn || 'Translate Plan');
  }

  // History placeholder
  const searchInput = el('historySearchInput');
  if (searchInput && dict.history_search_placeholder) {
    searchInput.placeholder = dict.history_search_placeholder;
  }

  // Status text if idle
  if (systemStatusText && systemStatusText.textContent.trim().toUpperCase() === 'SYSTEM READY') {
    systemStatusText.textContent = dict.system_ready || 'SYSTEM READY';
  }

  // Re-render history UI with localized strings
  renderHistoryUI(searchInput?.value || '');

  // Auto-translate currently active plan if one is displayed and we switched language
  const planTextEl = el('planText');
  if (planTextEl && originalPlanText && !planTextEl.textContent.includes('Waiting for the coordinator') && !planTextEl.textContent.includes('Final plan appears here')) {
    if (lang === 'en') {
      planTextEl.textContent = originalPlanText;
      isPlanTranslated = false;
      if (transPlanBtnText) transPlanBtnText.textContent = dict.translate_plan_btn || 'Translate Plan';
      const transNote = el('planTransNote');
      if (transNote) transNote.hidden = true;
    } else {
      handleTranslatePlan(false);
    }
  }

  if (triggerToast) {
    showToast(`Language set to ${dict.lang_name || lang}`);
  }
}

async function handleTranslatePlan(isAuto = false) {
  const planTextEl = el('planText');
  const transBtn = el('translatePlanBtn');
  const transBtnText = el('transPlanBtnText');
  const transNote = el('planTransNote');
  if (!planTextEl) return;

  const currentPlan = planTextEl.textContent;
  if (!currentPlan || currentPlan.includes('Waiting for the coordinator') || currentPlan.includes('Final plan appears here')) {
    if (!isAuto) alert('Please run a live analysis first to generate a coordinator plan.');
    return;
  }

  if (!originalPlanText) {
    originalPlanText = currentPlan;
  }

  // If already translated and toggled manually by user, switch back to original
  if (isPlanTranslated && !isAuto) {
    planTextEl.textContent = originalPlanText;
    isPlanTranslated = false;
    if (transBtnText) transBtnText.textContent = getCurrentDict().translate_plan_btn || 'Translate Plan';
    if (transNote) transNote.hidden = true;
    showToast('Showing original English plan');
    return;
  }

  // Target language
  let target = currentLang;
  let targetName = getCurrentDict().lang_name || 'Hindi';
  if (target === 'en') {
    target = 'hi';
    targetName = 'हिन्दी (Hindi)';
  }

  // Check cache
  if (translatedPlanCache[target]) {
    planTextEl.textContent = translatedPlanCache[target];
    isPlanTranslated = true;
    if (transBtnText) transBtnText.textContent = getCurrentDict().show_original_plan || 'Show Original';
    if (transNote) {
      transNote.hidden = false;
      transNote.textContent = `✓ Translated to ${targetName}`;
    }
    if (!isAuto) showToast(`Translated to ${targetName}`);
    return;
  }

  // Fetch from /api/translate
  if (transBtn) transBtn.disabled = true;
  if (transBtnText) transBtnText.textContent = getCurrentDict().translating_plan || 'Translating advice...';

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: originalPlanText, targetLang: target, langName: targetName })
    });
    const data = await res.json();
    if (data.success && data.translated) {
      translatedPlanCache[target] = data.translated;
      planTextEl.textContent = data.translated;
      isPlanTranslated = true;
      if (transBtnText) transBtnText.textContent = getCurrentDict().show_original_plan || 'Show Original';
      if (transNote) {
        transNote.hidden = false;
        transNote.textContent = `✓ Translated to ${targetName}`;
      }
      showToast(`Plan successfully translated to ${targetName}`);
    }
  } catch (err) {
    console.warn('Translation error:', err);
  } finally {
    if (transBtn) transBtn.disabled = false;
  }
}

// Connect language selector
if (langSelector) {
  langSelector.addEventListener('change', e => applyLanguage(e.target.value, true));
}

// Connect plan translate button
el('translatePlanBtn')?.addEventListener('click', () => handleTranslatePlan(false));

// Initialize language and history on load
applyLanguage(currentLang, false);
renderHistoryUI();




