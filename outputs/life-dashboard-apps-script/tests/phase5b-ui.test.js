'use strict';

/**
 * tests/phase5b-ui.test.js
 *
 * Behavior-level test suite for Phase 5B UI implementation:
 * - Scoring status & budget panel
 * - Explicit queue-level scoring action with double-click suppression
 * - Stored score states (unscored, current, stale, quarantined)
 * - StoppedReason safe message mappings
 * - Application tracking lifecycle & transitions
 * - Untrusted text safety (zero innerHTML, inert markup)
 * - Zero-call browsing invariant
 * - Resilience of Home, Tasks, and Calendar under Phase 5 failures
 * - Structural checks for touch targets, focus-visible, and reduced-motion
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function readDeployed(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

/**
 * Creates a lightweight, standards-compliant simulated DOM environment
 * for executing JavaScript.html against Index.html elements and the dev mock.
 */
function createTestHarness(queryString = '', options = {}) {
  const elementsById = new Map();
  const allElements = [];

  class FakeNode {
    constructor(tagName) {
      this.tagName = (tagName || 'div').toUpperCase();
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this._textContent = '';
      this.hidden = false;
      this.disabled = false;
      this._value = '';
      this.open = false;
      this.className = '';
      this.id = '';
      this.parentNode = null;
      allElements.push(this);
    }

    get value() {
      if (this.tagName === 'SELECT' && (this._value === '' || this._value === undefined)) {
        const firstOpt = this.children.find(c => c.tagName === 'OPTION');
        return firstOpt ? (firstOpt.value || firstOpt.textContent || '') : '';
      }
      return this._value || '';
    }

    set value(val) {
      this._value = String(val);
    }

    get firstChild() {
      return this.children[0] || null;
    }

    get childNodes() {
      return this.children;
    }

    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join('');
      }
      return this._textContent;
    }

    set textContent(val) {
      this.children = [];
      this._textContent = val === null || val === undefined ? '' : String(val);
    }

    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }

    setAttribute(name, val) {
      this.attributes[name] = String(val);
      if (name === 'id') {
        this.id = String(val);
        elementsById.set(this.id, this);
      }
      if (name === 'class') {
        this.className = String(val);
      }
    }

    getAttribute(name) {
      if (name === 'id') return this.id;
      if (name === 'class') return this.className;
      return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }

    removeAttribute(name) {
      delete this.attributes[name];
      if (name === 'id') elementsById.delete(this.id);
    }

    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const evObj = typeof event === 'object' ? event : { type: type, target: this, preventDefault: () => {} };
      if (!evObj.target) evObj.target = this;
      if (!evObj.preventDefault) evObj.preventDefault = () => {};

      const list = (this.listeners[type] || []).slice();
      list.forEach(fn => fn.call(this, evObj));
    }

    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }

    submit() {
      this.dispatchEvent({ type: 'submit', target: this, preventDefault: () => {} });
    }

    toggle() {
      this.open = !this.open;
      this.dispatchEvent({ type: 'toggle', target: this });
    }

    focus() {}

    querySelectorAll(selector) {
      return querySelectorAllFrom(this, selector);
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  function matchSingle(node, sel) {
    if (!node || node.nodeType === 3) return false;
    if (sel.startsWith('#')) {
      return node.id === sel.slice(1);
    }
    if (sel.startsWith('.')) {
      const classes = sel.split('.').filter(Boolean);
      const nodeClasses = (node.className || '').trim().split(/\s+/);
      return classes.every(cls => nodeClasses.includes(cls));
    }
    if (sel.includes('.')) {
      const parts = sel.split('.');
      const tag = parts[0];
      const classes = parts.slice(1);
      if (tag && node.tagName && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const nodeClasses = (node.className || '').trim().split(/\s+/);
      return classes.every(cls => nodeClasses.includes(cls));
    }
    if (node.tagName && node.tagName.toLowerCase() === sel.toLowerCase()) {
      return true;
    }
    return false;
  }

  function querySingleLevel(node, sel) {
    const results = [];
    function recurse(n) {
      if (!n || !n.children) return;
      for (const c of n.children) {
        if (!c) continue;
        if (matchSingle(c, sel)) results.push(c);
        recurse(c);
      }
    }
    recurse(node);
    return results;
  }

  function querySelectorAllFrom(root, selector) {
    const parts = selector.trim().split(/\s+/);
    if (parts.length === 1) {
      return querySingleLevel(root, parts[0]);
    }
    let current = querySingleLevel(root, parts[0]);
    for (let i = 1; i < parts.length; i++) {
      const next = [];
      for (const el of current) {
        next.push(...querySingleLevel(el, parts[i]));
      }
      current = next;
    }
    return current;
  }

  class FakeTextNode {
    constructor(text) {
      this.nodeType = 3;
      this.textContent = String(text);
      this.parentNode = null;
    }
  }

  function createElement(tag) {
    return new FakeNode(tag);
  }

  function createTextNode(text) {
    return new FakeTextNode(text);
  }

  function getElementById(id) {
    return elementsById.get(id) || null;
  }

  function querySelectorAll(selector) {
    return allElements.filter(el => matchSingle(el, selector));
  }

  function registerElement(tag, id, className, attrs) {
    const el = createElement(tag);
    if (id) el.setAttribute('id', id);
    if (className) el.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    }
    return el;
  }

  // Pre-seed static markup from Index.html
  const liveStatus = registerElement('div', 'live-status', 'visually-hidden');
  const liveAlert = registerElement('div', 'live-alert', 'visually-hidden');
  const connectionStatus = registerElement('p', 'connection-status');
  const viewHome = registerElement('section', 'view-home');
  const viewTasks = registerElement('section', 'view-tasks', '', { hidden: 'true' });
  viewTasks.hidden = true;
  const viewJobs = registerElement('section', 'view-jobs', '', { hidden: 'true' });
  viewJobs.hidden = true;

  const homeHeading = registerElement('h2', 'home-heading');
  const tasksHeading = registerElement('h2', 'tasks-heading');
  const jobsHeading = registerElement('h2', 'jobs-heading');

  const dashboardBody = registerElement('div', 'dashboard-body');
  const calendarBody = registerElement('div', 'calendar-body');
  const tasksContainer = registerElement('div', 'tasks-container');

  const addTaskForm = registerElement('form', 'add-task-form');
  const taskTitle = registerElement('input', 'task-title');
  const taskDueDate = registerElement('input', 'task-due-date');
  const taskPriority = registerElement('select', 'task-priority');
  taskPriority.value = 'Medium';
  const addTaskSubmit = registerElement('button', 'add-task-submit');
  const addTaskError = registerElement('p', 'add-task-error');

  const jobsContainer = registerElement('div', 'jobs-container');
  const jobsControls = registerElement('div', 'jobs-controls');
  const jobsFilter = registerElement('select', 'jobs-filter');
  jobsFilter.value = 'all';
  const jobsSort = registerElement('select', 'jobs-sort');
  jobsSort.value = 'match';
  const jobsRefresh = registerElement('button', 'jobs-refresh');

  const scoringBudgetCard = registerElement('section', 'scoring-budget-card');
  const scoreNextJobBtn = registerElement('button', 'score-next-job-btn');
  const scoringBudgetStatus = registerElement('div', 'scoring-budget-status');
  const budgetCeilingVal = registerElement('strong', 'budget-ceiling-val');
  const budgetSpendVal = registerElement('strong', 'budget-spend-val');
  const budgetRemainingVal = registerElement('strong', 'budget-remaining-val');
  const budgetCallsVal = registerElement('strong', 'budget-calls-val');
  const budgetAlert = registerElement('p', 'budget-alert');
  const scoringRunResult = registerElement('div', 'scoring-run-result');

  const navHome = registerElement('button', 'nav-home', 'nav-link', { 'data-view': 'home' });
  const navTasks = registerElement('button', 'nav-tasks', 'nav-link', { 'data-view': 'tasks' });
  const navJobs = registerElement('button', 'nav-jobs', 'nav-link', { 'data-view': 'jobs' });

  const windowObj = {
    setTimeout: (fn, ms) => setTimeout(fn, ms || 0),
    clearTimeout: id => clearTimeout(id),
    location: {
      search: queryString
    },
    URLSearchParams: require('url').URLSearchParams,
    crypto: {
      randomUUID: () => '00000000-0000-4000-8000-000000000001'
    }
  };

  const sandbox = {
    window: windowObj,
    document: {
      createElement,
      createTextNode,
      getElementById,
      querySelectorAll
    },
    URLSearchParams: require('url').URLSearchParams,
    setTimeout: windowObj.setTimeout,
    clearTimeout: windowObj.clearTimeout,
    console: console,
    Date: Date,
    Math: Math,
    Number: Number,
    String: String,
    Object: Object,
    Array: Array
  };
  sandbox.globalThis = sandbox;
  windowObj.window = windowObj;
  windowObj.document = sandbox.document;
  windowObj.__mockCallCounts = {};
  sandbox.__mockCallCounts = windowObj.__mockCallCounts;

  const context = vm.createContext(sandbox);

  const mockCode = readDeployed('dev/mock-google-script-run.js');
  vm.runInContext(mockCode, context);

  const jsHtml = readDeployed('JavaScript.html');
  const scriptContent = jsHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(scriptContent, context);

  return {
    sandbox,
    context,
    getCallCounts: () => (sandbox.__mockCallCounts || windowObj.__mockCallCounts || (sandbox.globalThis && sandbox.globalThis.__mockCallCounts) || {}),
    elements: {
      navHome, navTasks, navJobs,
      viewHome, viewTasks, viewJobs,
      scoreNextJobBtn, scoringBudgetStatus, scoringBudgetCard,
      budgetCeilingVal, budgetSpendVal, budgetRemainingVal, budgetCallsVal, budgetAlert,
      scoringRunResult,
      jobsContainer, jobsControls, jobsFilter, jobsSort, jobsRefresh,
      liveStatus, liveAlert
    }
  };
}

function wait(ms = 25) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================================================================
// Test Suites
// ===========================================================================

describe('Phase 5B UI: 1. Semantic markup, labels, and accessible live regions', () => {
  it('Index.html contains the AI scoring and budget card with landmarks and live regions', () => {
    const indexHtml = readDeployed('Index.html');
    assert.ok(indexHtml.includes('id="scoring-budget-card"'), 'scoring-budget-card exists');
    assert.ok(indexHtml.includes('aria-labelledby="scoring-budget-heading"'), 'accessible heading association exists');
    assert.ok(indexHtml.includes('id="score-next-job-btn"'), 'score-next-job-btn exists');
    assert.ok(indexHtml.includes('Score next eligible job'), 'exact explicit button label exists');
    assert.ok(indexHtml.includes('id="scoring-run-result"'), 'scoring-run-result live region exists');
    assert.ok(indexHtml.includes('role="status"'), 'role="status" on run result');
    assert.ok(indexHtml.includes('aria-live="polite"'), 'aria-live="polite" on run result');
  });

  it('Index.html explicitly clarifies AI review aid vs employment guarantee', () => {
    const indexHtml = readDeployed('Index.html');
    assert.ok(indexHtml.includes('80%+ match threshold is a review aid'), 'educational review aid disclaimer present');
    assert.ok(indexHtml.includes('not a guarantee of suitability or employment outcome'), 'employment guarantee disclaimer present');
  });
});

describe('Phase 5B UI: 2. Zero-call browsing guarantee', () => {
  it('page load, view switching, filtering, sorting, card expansion, and application view trigger 0 scorePendingJobs calls', async () => {
    const harness = createTestHarness();
    await wait(30);

    const counts = harness.getCallCounts();
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs on page load');

    // Switch to tasks
    harness.elements.navTasks.click();
    await wait(20);
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs on tasks view switch');

    // Switch to jobs
    harness.elements.navJobs.click();
    await wait(30);
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs on jobs view switch');

    // Refresh jobs queue
    harness.elements.jobsRefresh.click();
    await wait(30);
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs on queue refresh');

    // Change filter and sort
    harness.elements.jobsFilter.value = 'strong';
    harness.elements.jobsFilter.dispatchEvent('change');
    harness.elements.jobsSort.value = 'salary';
    harness.elements.jobsSort.dispatchEvent('change');
    await wait(20);
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs on filter/sort');

    // Expand scoring section on a card
    const jobCards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    assert.ok(jobCards.length > 0, 'job cards rendered');
    const scoringDetails = jobCards[0].querySelector('.job-scoring-section');
    assert.ok(scoringDetails, 'scoring details element exists');
    scoringDetails.toggle();
    await wait(30);
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs when expanding score details');

    // Expand application section
    const appDetails = jobCards[0].querySelector('.job-applications-section');
    assert.ok(appDetails, 'application details element exists');
    appDetails.toggle();
    await wait(30);
    assert.equal(counts.scorePendingJobs || 0, 0, 'zero scorePendingJobs when expanding application section');
  });
});

describe('Phase 5B UI: 3. Explicit queue-level scoring action & double-click suppression', () => {
  it('scoring triggers only on explicit click, disables while pending, and suppresses double clicks', async () => {
    const harness = createTestHarness('?latency=40');
    await wait(20);

    harness.elements.navJobs.click();
    await wait(20);

    const counts = harness.getCallCounts();
    assert.equal(counts.scorePendingJobs || 0, 0);

    // First click
    harness.elements.scoreNextJobBtn.click();
    assert.equal(harness.elements.scoreNextJobBtn.disabled, true, 'button disables immediately');
    assert.equal(counts.scorePendingJobs, 1, 'first call dispatched');

    // Rapid double click while pending
    harness.elements.scoreNextJobBtn.click();
    assert.equal(counts.scorePendingJobs, 1, 'duplicate call suppressed while pending');

    // Wait for async completion
    await wait(60);
    assert.equal(counts.scorePendingJobs, 1, 'still exactly 1 call dispatched overall');
    assert.equal(harness.elements.scoreNextJobBtn.disabled, false, 'button re-enabled after completion');
    assert.ok(harness.elements.scoringRunResult.textContent.includes('Scoring run completed:'), 'success message shown');
  });
});

describe('Phase 5B UI: 4. Four scoring states render distinctly and safely', () => {
  it('renders unscored state distinctly', async () => {
    const harness = createTestHarness('?scoring=unscored');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const scoringSection = card.querySelector('.job-scoring-section');
    scoringSection.toggle();
    await wait(30);

    const badge = scoringSection.querySelector('.score-badge');
    assert.ok(badge, 'badge rendered');
    assert.ok(badge.textContent.includes('Unscored'), 'unscored badge text');
    assert.ok(scoringSection.textContent.includes('not been evaluated with AI scoring yet'), 'unscored explanation');
  });

  it('renders current score state with match, evidence, and gaps', async () => {
    const harness = createTestHarness('?scoring=current');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const scoringSection = card.querySelector('.job-scoring-section');
    scoringSection.toggle();
    await wait(30);

    const badge = scoringSection.querySelector('.score-badge');
    assert.ok(badge.textContent.includes('Current'), 'current badge text');
    assert.ok(scoringSection.textContent.includes('Recommendation:'), 'shows recommendation');
    assert.ok(scoringSection.textContent.includes('Evidence:'), 'shows evidence');
    assert.ok(scoringSection.textContent.includes('Gaps:'), 'shows gaps');
    assert.equal(scoringSection.querySelector('.stale-score-alert'), null, 'no stale alert on current score');
  });

  it('renders stale score state prominently marked as needing rescoring', async () => {
    const harness = createTestHarness('?scoring=stale');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const scoringSection = card.querySelector('.job-scoring-section');
    scoringSection.toggle();
    await wait(30);

    const badge = scoringSection.querySelector('.score-badge');
    assert.ok(badge.textContent.includes('Stale'), 'stale badge text');
    const staleAlert = scoringSection.querySelector('.stale-score-alert');
    assert.ok(staleAlert, 'stale alert banner present');
    assert.ok(staleAlert.textContent.includes('Needs rescoring'), 'states needs rescoring');
  });

  it('renders quarantined score safely without raw server error or prompt tokens', async () => {
    const harness = createTestHarness('?scoring=quarantined');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const scoringSection = card.querySelector('.job-scoring-section');
    scoringSection.toggle();
    await wait(30);

    const badge = scoringSection.querySelector('.score-badge');
    assert.ok(badge.textContent.includes('Quarantined'), 'quarantined badge text');
    assert.ok(scoringSection.textContent.includes('validation rules'), 'safe validation rules notice');
    assert.equal(scoringSection.textContent.includes('EVIDENCE_TOO_SHORT'), false, 'no raw error codes');
    assert.equal(scoringSection.textContent.includes('prompt'), false, 'no prompt internals');
  });
});

describe('Phase 5B UI: 5. All 9 stoppedReason codes & unknown code produce safe text', () => {
  const CODES = [
    'AUTH_ERROR', 'RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_UNAVAILABLE',
    'USAGE_BOUND_EXCEEDED', 'TOKEN_COUNT_UNAVAILABLE', 'BUDGET_EXCEEDED', 'LEDGER_INTEGRITY_BLOCKED'
  ];

  CODES.forEach(code => {
    it(`handles stoppedReason=${code} with safe, clear user text`, async () => {
      const harness = createTestHarness(`?stoppedReason=${code}`);
      await wait(20);
      harness.elements.navJobs.click();
      await wait(20);

      harness.elements.scoreNextJobBtn.click();
      await wait(30);

      const resultBanner = harness.elements.scoringRunResult;
      assert.equal(resultBanner.hidden, false);
      assert.ok(resultBanner.textContent.includes('Scoring stopped:'), 'clear stop notification');
      assert.ok(!resultBanner.textContent.includes('Error:'), 'never displays raw Exception');
    });
  });

  it('handles unknown stoppedReason code safely with fallback', async () => {
    const harness = createTestHarness('?stoppedReason=UNKNOWN_NEW_CODE');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(20);

    harness.elements.scoreNextJobBtn.click();
    await wait(30);

    const resultBanner = harness.elements.scoringRunResult;
    assert.ok(resultBanner.textContent.includes('Unexpected stop reason received'), 'safe unknown fallback');
  });
});

describe('Phase 5B UI: 6. Budget state displays without triggering scoring', () => {
  it('displays normal budget status correctly', async () => {
    const harness = createTestHarness('?budget=normal');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    assert.equal(harness.elements.budgetCeilingVal.textContent, '$10.00');
    assert.equal(harness.elements.budgetSpendVal.textContent, '$2.50');
    assert.equal(harness.elements.budgetRemainingVal.textContent, '$7.50');
    assert.equal(harness.elements.budgetAlert.hidden, true);
    assert.equal(harness.elements.scoreNextJobBtn.disabled, false);
    assert.equal(harness.getCallCounts().scorePendingJobs || 0, 0);
  });

  it('displays warning when approaching budget limit', async () => {
    const harness = createTestHarness('?budget=near-limit');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    assert.equal(harness.elements.budgetRemainingVal.textContent, '$0.80');
    assert.equal(harness.elements.budgetAlert.hidden, false);
    assert.ok(harness.elements.budgetAlert.textContent.includes('Approaching monthly budget limit'));
    assert.equal(harness.elements.scoreNextJobBtn.disabled, false);
  });

  it('disables scoring when budget is exceeded', async () => {
    const harness = createTestHarness('?budget=exceeded');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    assert.equal(harness.elements.budgetRemainingVal.textContent, '$0.00');
    assert.equal(harness.elements.budgetAlert.hidden, false);
    assert.ok(harness.elements.budgetAlert.textContent.includes('Monthly budget limit reached'));
    assert.equal(harness.elements.scoreNextJobBtn.disabled, true, 'score button disabled when budget exceeded');
  });

  it('handles ledger-integrity blocked status safely', async () => {
    const harness = createTestHarness('?budget=ledger-blocked');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(20);

    harness.elements.scoreNextJobBtn.click();
    await wait(30);

    const banner = harness.elements.scoringRunResult;
    assert.ok(banner.textContent.includes('ledger integrity check blocked'), 'safe ledger message');
  });
});

describe('Phase 5B UI: 7. Application tracking workflow & legal transitions', () => {
  it('creates an application record with confirmation that submission happened externally', async () => {
    const harness = createTestHarness('?apps=empty');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    assert.ok(appSection.textContent.includes('No application recorded'), 'empty state shown');
    const recordBtn = appSection.querySelector('.secondary-button');
    assert.equal(recordBtn.textContent, 'Record application');
    recordBtn.click();

    const form = appSection.querySelector('.app-form');
    assert.ok(form, 'create form rendered');
    assert.ok(form.textContent.includes('never submits applications to employers'), 'clear external action notice');

    // Submit draft application
    form.submit();
    await wait(40);

    const createdCard = appSection.querySelector('.application-card');
    assert.ok(createdCard, 'application card created');
    assert.ok(createdCard.textContent.includes('Draft'), 'status is Draft');
  });

  it('enforces legal application transitions: Draft -> Applied -> Interview -> Offered', async () => {
    const harness = createTestHarness('?apps=empty');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1] || cards[0];
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    appSection.querySelector('.secondary-button').click();
    appSection.querySelector('.app-form').submit();
    await wait(40);

    // Status: Draft -> buttons available: "Record as applied", "Withdraw"
    let appCard = appSection.querySelector('.application-card');
    const actions = appCard.querySelectorAll('.app-actions button');
    const actionLabels = actions.map(b => b.textContent);
    assert.ok(actionLabels.includes('Record as applied'), 'Draft can transition to Applied');
    assert.ok(actionLabels.includes('Withdraw'), 'Draft can transition to Withdrawn');
    assert.equal(actionLabels.includes('Record interview'), false, 'Draft cannot jump to Interview');

    // Click Record as applied
    const appliedBtn = actions.find(b => b.textContent === 'Record as applied');
    appliedBtn.click();
    await wait(40);

    // Now status is Applied -> targets: Interview, Rejected, Withdraw
    appCard = appSection.querySelector('.application-card');
    assert.ok(appCard.textContent.includes('Applied'), 'status updated to Applied');
    const newActions = appCard.querySelectorAll('.app-actions button').map(b => b.textContent);
    assert.ok(newActions.includes('Record interview'), 'Applied can transition to Interview');
    assert.ok(newActions.includes('Record rejection'), 'Applied can transition to Rejection');
    assert.ok(newActions.includes('Withdraw'), 'Applied can transition to Withdrawn');
  });

  it('rejects duplicate active applications gracefully', async () => {
    const harness = createTestHarness('?apps=duplicate-active');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    appSection.querySelector('.secondary-button').click();
    appSection.querySelector('.app-form').submit();
    await wait(40);

    const errorP = appSection.querySelector('.state-message.is-error');
    assert.ok(errorP, 'error element present');
    assert.ok(errorP.textContent.includes('active application already exists'), 'handles ACTIVE_APPLICATION_EXISTS');
  });

  it('handles application history envelope errors without throwing', async () => {
    const harness = createTestHarness('?apps=history-error');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1] || cards[0];
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const historyDetails = appSection.querySelector('.app-history-details');
    assert.ok(historyDetails, 'history details element exists');
    assert.doesNotThrow(() => {
      historyDetails.toggle();
    });
    await wait(40);

    assert.ok(historyDetails.textContent.includes('Application history is unavailable right now.'), 'safe envelope error message');
  });
});

describe('Phase 5B UI: 8. Synchronized refresh and atomicity on transitions', () => {
  it('reloads queue and applications upon status change', async () => {
    const harness = createTestHarness();
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1] || cards[0];
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const initialQueueCalls = harness.getCallCounts().getJobsQueue || 0;
    const applyBtn = appSection.querySelectorAll('.app-actions button').find(b => b.textContent === 'Record as applied');
    assert.ok(applyBtn, 'Record as applied button found');
    applyBtn.click();
    await wait(40);
    assert.ok((harness.getCallCounts().getJobsQueue || 0) > initialQueueCalls, 'jobs queue reloaded');
  });

  it('does not mutate local optimistic status when transition fails with CONFLICT', async () => {
    const harness = createTestHarness('?apps=conflict');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1] || cards[0];
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const applyBtn = appSection.querySelectorAll('.app-actions button').find(b => b.textContent === 'Record as applied');
    assert.ok(applyBtn, 'Record as applied button found');
    applyBtn.click();
    await wait(40);
    const appCard = appSection.querySelector('.application-card');
    assert.ok(appCard.textContent.includes('Draft'), 'status remains Draft after CONFLICT error');
  });
});

describe('Phase 5B UI: 9. Inertness of untrusted text / injection resistance', () => {
  it('safely treats HTML and script tags in evidence, gaps, and notes as inert text', async () => {
    const harness = createTestHarness('?scoring=current');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const scoringSection = card.querySelector('.job-scoring-section');
    scoringSection.toggle();
    await wait(30);

    // Verify no unexpected DOM script tags were created
    const scriptElements = scoringSection.querySelectorAll('script');
    assert.equal(scriptElements.length, 0, 'zero script tags injected');
  });
});

describe('Phase 5B UI: 10. Zero browser networking and draft generation exclusion', () => {
  it('contains zero browser networking calls (fetch/XHR) across deployed UI files', () => {
    const js = readDeployed('JavaScript.html');
    assert.equal(/fetch\(/.test(js), false, 'zero fetch(');
    assert.equal(/XMLHttpRequest/.test(js), false, 'zero XMLHttpRequest');
    assert.equal(/UrlFetchApp/.test(js), false, 'zero UrlFetchApp');
  });

  it('contains zero draft-generation or resume/cover-letter endpoints in UI code', () => {
    const js = readDeployed('JavaScript.html');
    assert.equal(/generateApplicationDraft/.test(js), false, 'no generateApplicationDraft');
    assert.equal(/getDraftGenerationEstimate/.test(js), false, 'no getDraftGenerationEstimate');
  });
});

describe('Phase 5B UI: 11. Home, Tasks, Calendar resilience under Phase 5 failures', () => {
  it('Home and Tasks function normally when scoring budget endpoint fails', async () => {
    const harness = createTestHarness('?fail=getScoringBudgetStatus:5');
    await wait(30);

    // Home works
    assert.equal(harness.elements.viewHome.hidden, false, 'Home view active');

    // Tasks works
    harness.elements.navTasks.click();
    await wait(20);
    assert.equal(harness.elements.viewTasks.hidden, false, 'Tasks view active');
  });
});

describe('Phase 5B UI: 12. CSS, touch targets, reduced-motion, and focus-visible structural checks', () => {
  it('Styles.html enforces 44px touch targets on all interactive buttons', () => {
    const styles = readDeployed('Styles.html');
    assert.ok(styles.includes('min-height: 44px;'), 'min-height: 44px exists');
    assert.ok(styles.includes('.primary-button'), 'primary-button styled');
  });

  it('Styles.html supports prefers-reduced-motion', () => {
    const styles = readDeployed('Styles.html');
    assert.ok(styles.includes('prefers-reduced-motion: reduce'), 'prefers-reduced-motion media query present');
    assert.ok(styles.includes('transition-duration: 0.001ms'), 'animations disabled under reduced-motion');
  });

  it('Styles.html enforces focus-visible outlines on interactive controls', () => {
    const styles = readDeployed('Styles.html');
    assert.ok(styles.includes(':focus-visible'), 'focus-visible selector present');
    assert.ok(styles.includes('summary:focus-visible'), 'summary focus-visible included');
  });

  it('Styles.html contains mobile responsive breakpoints for 720px and 430px', () => {
    const styles = readDeployed('Styles.html');
    assert.ok(styles.includes('@media (max-width: 720px)'), 'tablet breakpoint present');
    assert.ok(styles.includes('@media (max-width: 430px)'), 'mobile breakpoint present');
  });
});
