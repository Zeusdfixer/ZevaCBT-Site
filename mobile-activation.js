/**
 * MOBILE ACTIVATION ORCHESTRATOR
 * ============================================================
 * Loaded before the rest of the app. Checks this device's license
 * status (see mobile-license.js) and either:
 *   (a) shows a full activation screen with a "Continue with free
 *       trial" option, if the device has never engaged with either,
 *   (b) loads the real app directly, if already activated (paid) or
 *       the person has already chosen to continue in trial mode this
 *       session, or
 *   (c) loads the real app with trial content limits applied, when
 *       proceeding via the free trial.
 *
 * The core app scripts are loaded dynamically (not via static <script>
 * tags in index.html) so this file has full control over exactly when
 * app.js's auto-running init() actually starts.
 */

const MOBILE_APP_SCRIPTS = [
  'preloader.js',
  'modal.js',
  'icons.js',
  'chatbot.js',
  'data-store.js',
  'mobile-bootstrap.js',
  'demo-content.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(el);
  });
}

async function loadAppScriptsInOrder(scripts) {
  for (const src of scripts) {
    await loadScript(src);
  }
}

/** Caps the free trial to a small, real slice of content rather than
 * the full demo bank, and swaps in a "trial mode" label plus an
 * "Activate full version" button so the limit is visible, not a
 * silent restriction. Called after app.js has loaded (so the
 * function it's overriding already exists), before render() has run
 * for the first time. */
function applyMobileTrialContentCap() {
  const TRIAL_MAX_SUBJECTS = 3;
  const TRIAL_MAX_QUESTIONS_PER_SUBJECT = 5;

  const originalRenderGuestTrialSetup = window.renderGuestTrialSetup;
  window.renderGuestTrialSetup = async function mobileTrialRenderGuestTrialSetup() {
    await originalRenderGuestTrialSetup();

    // The original function already rendered its screen and wired its
    // own "Start demo trial" button. Re-wire that same button here so
    // the per-subject question count it uses is capped, and the
    // subject list offered is capped too — without touching app.js
    // itself, which both the PC and mobile apps share.
    const demoSubjects = await DataStore.getSubjects(typeof state !== 'undefined' ? state.section : null, { isDemo: true });
    const cappedSubjectIds = new Set(demoSubjects.slice(0, TRIAL_MAX_SUBJECTS).map((s) => s.id));

    const startBtn = document.getElementById('btn-start-guest-trial');
    if (!startBtn) return;

    // Clone-and-replace to discard the original click handler (which
    // captured the uncapped selectedSubjects/questionsPerSubject in
    // its own closure) and attach a capped version instead.
    const freshBtn = startBtn.cloneNode(true);
    startBtn.parentNode.replaceChild(freshBtn, startBtn);

    // Add a visible note explaining the cap, right above the button.
    const note = document.createElement('p');
    note.className = 'subtitle';
    note.style.cssText = 'font-size:12px; color:var(--signal-amber); margin-top:-6px; margin-bottom:14px;';
    note.textContent = `Free trial: up to ${TRIAL_MAX_SUBJECTS} subjects, ${TRIAL_MAX_QUESTIONS_PER_SUBJECT} questions each. Activate the full version for complete access to every subject and question.`;
    freshBtn.parentNode.insertBefore(note, freshBtn);

    freshBtn.addEventListener('click', async () => {
      let selectedSubjects = demoSubjects.filter((s) => cappedSubjectIds.has(s.id));

      const gradePicker = document.getElementById('guest-grade-picker');
      const bodyPicker = document.getElementById('guest-body-picker');
      if (gradePicker) {
        const grade = gradePicker.value;
        selectedSubjects = demoSubjects.filter((s) => s.grade === grade && cappedSubjectIds.has(s.id));
      } else if (bodyPicker) {
        const bodyId = bodyPicker.value;
        selectedSubjects = demoSubjects.filter((s) => s.id === bodyId && cappedSubjectIds.has(s.id));
      }

      if (selectedSubjects.length === 0) {
        await zevaModal.alert({
          title: 'Not included in the free trial',
          message: `That selection isn't part of the ${TRIAL_MAX_SUBJECTS}-subject free trial. Activate the full version to unlock every subject, or pick one of the first ${TRIAL_MAX_SUBJECTS} subjects listed.`,
        });
        return;
      }

      const questionsPerSubject = {};
      selectedSubjects.forEach((s) => { questionsPerSubject[s.id] = TRIAL_MAX_QUESTIONS_PER_SUBJECT; });

      // NOTE: `state` here refers to app.js's top-level `const state`.
      // In a plain (non-module) <script>, a top-level const/let does
      // NOT attach to `window`, so `window.state` is undefined even
      // though the bare identifier `state` is reachable from this
      // file — both scripts share one global scope, just not via the
      // `window.` prefix for block-scoped declarations. Same applies
      // to `render`, which app.js also declares with `function
      // render()` — that one DOES attach to window (function
      // declarations always do), but is referenced here without the
      // prefix too, for consistency and because it reads clearer.
      state.student = {
        id: 'trial_' + Date.now(),
        fullName: state.guestName || 'Guest',
        regNumber: '', examNumber: '',
        section: state.section,
        isTrial: true,
        photo: null,
      };
      state.exam = {
        id: 'guest_demo_exam',
        title: `Free Trial — ${sectionLabel(state.section)}`,
        section: state.section,
        subjectIds: selectedSubjects.map((s) => s.id),
        questionsPerSubject,
        theoryQuestionsPerSubject: {},
        durationMinutes: 15,
        shuffleQuestions: true,
        shuffleOptions: true,
        passMarkPercent: 50,
        resitPolicy: 'remaining_time',
        allowPause: true,
        allowReview: true,
      };
      state.screen = 'instructions';
      render();
    });
  };
}

/** Renders the activation screen. Returns a Promise that resolves
 * once the person either activates successfully or chooses to
 * continue with the free trial — either way, the caller proceeds to
 * load the real app next. */
function renderMobileActivationScreen(status) {
  return new Promise((resolve) => {
    const root = document.getElementById('root');
    root.innerHTML = `
      <div class="mobile-activation-screen">
        <img src="assets/logo-icon.png" alt="" class="mobile-activation-logo" />
        <h1>Zeva CBT Practice</h1>
        <p class="mobile-activation-subtitle">by Zeus Technologies Innovations</p>

        <div class="mobile-serial-box">
          <div class="mobile-serial-label">This device's serial number</div>
          <div class="mobile-serial-value" id="mobile-serial-value">${status.serialNumber || 'Unavailable — see note below'}</div>
        </div>

        ${!status.serialNumber ? `
        <div class="mobile-activation-instructions" style="border: 1px solid rgba(220,53,69,0.4); background: rgba(220,53,69,0.12);">
          Could not read this device's identifier (${status.error || 'unknown error'}). This should only happen when running outside a real packaged app — if you're seeing this on a real device, please contact Zeus Technologies Innovations for support.
        </div>
        ` : ''}

        <div class="mobile-activation-instructions">
          This app is a <strong>one-time purchase</strong> — activate once and it keeps working on this phone, including after a normal reinstall. It will not work if copied to a different phone. Send the serial number above to Zeus Technologies Innovations to buy an activation code.
        </div>

        <label class="mobile-field-label" for="mobile-code-input">Activation code</label>
        <input type="text" id="mobile-code-input" class="mobile-code-input" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" />
        <button class="mobile-activate-btn" id="mobile-activate-btn" ${!status.serialNumber ? 'disabled' : ''}>Activate</button>
        <div class="mobile-activation-message" id="mobile-activation-message"></div>

        <div class="mobile-trial-divider">or</div>
        <button class="mobile-trial-btn" id="mobile-trial-btn">Continue with free trial</button>
        <p class="mobile-trial-note">A small set of subjects and questions, so you can try the app before buying.</p>
      </div>
    `;

    document.getElementById('mobile-activate-btn').addEventListener('click', async () => {
      const btn = document.getElementById('mobile-activate-btn');
      const input = document.getElementById('mobile-code-input');
      const messageEl = document.getElementById('mobile-activation-message');
      const code = input.value.trim();
      if (!code) return;

      btn.disabled = true;
      btn.textContent = 'Activating…';
      messageEl.className = 'mobile-activation-message';
      messageEl.textContent = '';

      const result = await window.ZevaMobileLicense.activateWithCode(code);
      if (result.success) {
        messageEl.className = 'mobile-activation-message success';
        messageEl.textContent = 'Activated! Loading the full app…';
        setTimeout(() => resolve({ activated: true }), 900);
      } else {
        messageEl.className = 'mobile-activation-message error';
        messageEl.textContent = result.message;
        btn.disabled = false;
        btn.textContent = 'Activate';
      }
    });

    document.getElementById('mobile-code-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mobile-activate-btn').click();
    });

    document.getElementById('mobile-trial-btn').addEventListener('click', () => {
      resolve({ activated: false, trial: true });
    });
  });
}

/** Adds a persistent, always-visible ribbon at the top of the screen
 * while in free-trial mode, with a tap-through back to the activation
 * screen. Uses a fixed-position element outside of app.js's own
 * render() output so it survives every screen change within the app
 * without needing app.js itself to know anything about licensing. */
function showTrialRibbon() {
  const ribbon = document.createElement('div');
  ribbon.className = 'mobile-trial-ribbon';
  ribbon.textContent = 'Free trial — tap to activate the full version';
  ribbon.addEventListener('click', () => {
    window.location.reload();
  });
  document.body.appendChild(ribbon);
}

(async function mobileInit() {
  const status = await window.ZevaMobileLicense.checkLicenseStatus();

  let proceedAsTrial = false;
  if (!status.activated) {
    const choice = await renderMobileActivationScreen(status);
    proceedAsTrial = !choice.activated;
  }

  // Clear whatever the activation screen rendered before handing off
  // to the real app's own render().
  document.getElementById('root').innerHTML = '';

  // Load everything app.js depends on, PLUS app.js itself — but
  // mobile-bootstrap.js (included in this list) sets up
  // ZEVA_DATASTORE_READY as a promise WE hold open (see that file),
  // so even though app.js's IIFE starts running the instant its
  // script tag executes, it immediately blocks on that first await
  // and cannot reach render() until we explicitly release the gate
  // below. This replaces an earlier, buggy version of this file that
  // relied on script-load timing to win a race against app.js's IIFE
  // — that race was empirically confirmed to be lost more often than
  // not, so it's replaced with this explicit gate instead.
  await loadAppScriptsInOrder(MOBILE_APP_SCRIPTS);
  await loadScript('app.js');

  if (proceedAsTrial) {
    applyMobileTrialContentCap();
    showTrialRibbon();
  }

  // Release the gate — app.js's init() IIFE (blocked on
  // `await window.ZEVA_DATASTORE_READY`) resumes from here.
  window.ZEVA_RESOLVE_DATASTORE_READY();
})();
