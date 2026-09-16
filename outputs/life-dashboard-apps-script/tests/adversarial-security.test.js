'use strict';

/**
 * tests/adversarial-security.test.js
 *
 * Empirical Adversarial Verification Suite:
 * 1. Untrusted string injection & DOM XSS resistance across all free-text fields
 * 2. Double-click suppression under rapid sequential triggers across all stateful mutations
 * 3. Concurrency conflict (CONFLICT optimistic lock mismatch) and INVALID_TRANSITION recovery
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
 * Advanced DOM simulation tracking created elements, tag counts, and textContent
 */
function createAdversarialHarness(queryString = '', customMocks = null) {
  const elementsById = new Map();
  const allElements = [];
  const createdTags = [];

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
      this.type = '';
      this.parentNode = null;
      allElements.push(this);
      createdTags.push(this.tagName);
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
      if (name === 'type') {
        this.type = String(val);
      }
    }

    getAttribute(name) {
      if (name === 'id') return this.id;
      if (name === 'class') return this.className;
      if (name === 'type') return this.type || this.attributes.type || null;
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
    if (sel.includes('[') && sel.endsWith(']')) {
      const tag = sel.slice(0, sel.indexOf('['));
      if (tag && node.tagName && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const attrMatch = sel.match(/\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2];
        const currentVal = node.getAttribute(attrName);
        if (attrVal !== undefined) {
          return currentVal === attrVal;
        }
        return currentVal !== null;
      }
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

  // Pre-seed static markup
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

  // Apply custom overrides directly into window.__mockFNS before running JavaScript.html
  if (customMocks && typeof customMocks === 'function') {
    customMocks(context.window.__mockFNS, context);
  }

  const jsHtml = readDeployed('JavaScript.html');
  const scriptContent = jsHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(scriptContent, context);

  return {
    sandbox,
    context,
    createdTags,
    allElements,
    getCallCounts: () => (context.window.__mockCallCounts || {}),
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
// Suite 1: Untrusted String Injection & DOM XSS Resistance
// ===========================================================================
describe('Adversarial 1: Untrusted String Injection & DOM XSS Resistance', () => {
  const XSS_VECTORS = {
    scriptTag: '<script>window.__xss_executed = true; alert("pwned");</script>',
    imgError: '<img src="x" onerror="window.__xss_executed = true;">',
    svgOnload: '<svg/onload="window.__xss_executed = true;">',
    iframe: '<iframe src="javascript:alert(1)"></iframe>',
    breakout: '"><script>alert(1)</script><b id="xss_marker">test</b>',
    attrEvent: '" onmouseover="alert(1)" data-exploit="yes',
    jsUrl: 'javascript:alert(document.domain)'
  };

  it('renders XSS payloads in job title, company, recommendation, whyMatches, gaps, and notes as inert text', async () => {
    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.getJobsQueue = function () {
        return {
          status: 'ok',
          today: '2026-09-14',
          activeJobs: [
            {
              id: 'adv-job-1',
              title: XSS_VECTORS.scriptTag,
              company: XSS_VECTORS.imgError,
              location: XSS_VECTORS.svgOnload,
              remote: true,
              remoteLabel: 'Remote',
              overallMatch: 95,
              salaryMin: 120000,
              salaryMax: 150000,
              currency: 'USD',
              source: 'JSearch',
              sourceUrl: 'https://example.com/job/1',
              postedDate: '2026-09-10',
              discoveredDate: '2026-09-14',
              externalId: 'ext-999',
              lastSeenAt: '2026-09-14T10:00:00.000Z',
              freshness: 'recent',
              status: 'New',
              recommendation: XSS_VECTORS.iframe,
              whyMatches: XSS_VECTORS.breakout,
              gaps: XSS_VECTORS.attrEvent,
              notes: XSS_VECTORS.scriptTag,
              recordVersion: 1
            }
          ],
          rejectedJobs: [],
          quarantined: [],
          message: ''
        };
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const container = harness.elements.jobsContainer;
    const card = container.querySelector('.job-card');
    assert.ok(card, 'job card rendered');

    // 1. Assert ZERO executable tags were created in DOM
    const scripts = card.querySelectorAll('script');
    const images = card.querySelectorAll('img');
    const svgs = card.querySelectorAll('svg');
    const iframes = card.querySelectorAll('iframe');

    assert.equal(scripts.length, 0, 'ZERO <script> elements created in DOM');
    assert.equal(images.length, 0, 'ZERO <img> elements created in DOM');
    assert.equal(svgs.length, 0, 'ZERO <svg> elements created in DOM');
    assert.equal(iframes.length, 0, 'ZERO <iframe> elements created in DOM');

    // 2. Assert textContent contains verbatim payload unparsed
    const titleEl = card.querySelector('.job-card-title');
    assert.equal(titleEl.textContent, XSS_VECTORS.scriptTag, 'title preserved verbatim in textContent');

    const companyEl = card.querySelector('.job-company');
    assert.equal(companyEl.textContent, XSS_VECTORS.imgError, 'company preserved verbatim in textContent');

    const expEl = card.querySelector('.job-explanation');
    assert.ok(expEl.textContent.includes(XSS_VECTORS.iframe), 'recommendation rendered as inert text');
    assert.ok(expEl.textContent.includes(XSS_VECTORS.breakout), 'whyMatches rendered as inert text');
    assert.ok(expEl.textContent.includes(XSS_VECTORS.attrEvent), 'gaps rendered as inert text');

    const notesEl = card.querySelector('.job-notes');
    assert.ok(notesEl.textContent.includes(XSS_VECTORS.scriptTag), 'notes rendered as inert text');
  });

  it('renders XSS payloads in AI score evidence, gaps, and recommendation as inert text nodes', async () => {
    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.getJobScoringState = function (jobId) {
        return {
          jobId: jobId,
          state: 'current',
          score: {
            id: 'score-adv',
            overallMatch: 88,
            recommendation: XSS_VECTORS.scriptTag,
            evidence: XSS_VECTORS.imgError,
            gaps: XSS_VECTORS.svgOnload,
            validatedAt: '2026-09-14T12:00:00.000Z'
          }
        };
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const scoringSection = card.querySelector('.job-scoring-section');
    scoringSection.toggle();
    await wait(30);

    // Verify zero tags created from score payload
    assert.equal(scoringSection.querySelectorAll('script').length, 0, 'zero script tags');
    assert.equal(scoringSection.querySelectorAll('img').length, 0, 'zero img tags');
    assert.equal(scoringSection.querySelectorAll('svg').length, 0, 'zero svg tags');

    // Verify verbatim text present
    assert.ok(scoringSection.textContent.includes(XSS_VECTORS.scriptTag), 'recommendation is inert text');
    assert.ok(scoringSection.textContent.includes(XSS_VECTORS.imgError), 'evidence is inert text');
    assert.ok(scoringSection.textContent.includes(XSS_VECTORS.svgOnload), 'gaps is inert text');
  });

  it('renders XSS payloads in application records and application history as inert text', async () => {
    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.getApplicationsByJobId = function (jobId) {
        return [
          {
            id: 'app-adv-1',
            job_id: jobId,
            status: 'Applied',
            applied_at: '2026-09-14',
            contact_name: XSS_VECTORS.scriptTag,
            contact_email: 'hacker@example.com',
            notes: XSS_VECTORS.breakout,
            outcome: XSS_VECTORS.imgError,
            record_version: 1
          }
        ];
      };

      mockFns.getApplicationHistory = function (appId) {
        return {
          status: 'ok',
          entries: [
            {
              id: 'hist-adv-1',
              applicationId: appId,
              action: XSS_VECTORS.svgOnload,
              fromStatus: 'Draft',
              toStatus: 'Applied',
              note: XSS_VECTORS.iframe,
              createdAt: '2026-09-14T13:00:00.000Z'
            }
          ],
          quarantinedCount: 0,
          message: ''
        };
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const appCard = appSection.querySelector('.application-card');
    assert.ok(appCard, 'application card rendered');

    assert.equal(appCard.querySelectorAll('script').length, 0, 'zero script tags in app card');
    assert.equal(appCard.querySelectorAll('img').length, 0, 'zero img tags in app card');
    assert.ok(appCard.textContent.includes(XSS_VECTORS.scriptTag), 'contact name inert');
    assert.ok(appCard.textContent.includes(XSS_VECTORS.breakout), 'app notes inert');
    assert.ok(appCard.textContent.includes(XSS_VECTORS.imgError), 'app outcome inert');

    // Expand application history
    const historyDetails = appCard.querySelector('.app-history-details');
    historyDetails.toggle();
    await wait(30);

    assert.equal(historyDetails.querySelectorAll('svg').length, 0, 'zero svg in history');
    assert.equal(historyDetails.querySelectorAll('iframe').length, 0, 'zero iframe in history');
    assert.ok(historyDetails.textContent.includes(XSS_VECTORS.svgOnload), 'action inert');
    assert.ok(historyDetails.textContent.includes(XSS_VECTORS.iframe), 'history note inert');
  });

  it('backend validateSourceUrl_ strictly rejects javascript: and data: pseudo-protocols', () => {
    const jobsGs = readDeployed('Jobs.gs');
    const sandbox = {
      isNonBlankString_: (v) => typeof v === 'string' && v.trim().length > 0,
      UserError_: (msg, code) => {
        const err = new Error(msg);
        err.code = code;
        return err;
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(jobsGs, sandbox);

    assert.throws(() => {
      sandbox.validateSourceUrl_('javascript:alert(1)');
    }, (err) => err.code === 'INVALID_URL', 'javascript: URL rejected with INVALID_URL');

    assert.throws(() => {
      sandbox.validateSourceUrl_('data:text/html,<script>alert(1)</script>');
    }, (err) => err.code === 'INVALID_URL', 'data: URL rejected with INVALID_URL');

    assert.throws(() => {
      sandbox.validateSourceUrl_('vbscript:msgbox(1)');
    }, (err) => err.code === 'INVALID_URL', 'vbscript: URL rejected with INVALID_URL');

    assert.equal(sandbox.validateSourceUrl_('https://jobs.example.com/posting/123'), 'https://jobs.example.com/posting/123');
  });
});

// ===========================================================================
// Suite 2: Double-Click Suppression & Concurrency Invariants
// ===========================================================================
describe('Adversarial 2: Double-Click Suppression & Concurrency Invariants', () => {
  it('suppresses burst clicks (10 rapid sequential clicks) on score-next-job-btn and dispatches exactly 1 call', async () => {
    const harness = createAdversarialHarness('?latency=50');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(70); // wait for initial getJobsQueue with 50ms latency

    const btn = harness.elements.scoreNextJobBtn;
    assert.equal(btn.disabled, false, 'button initially enabled');
    assert.equal(harness.getCallCounts().scorePendingJobs || 0, 0, 'zero calls initially');

    // Rapid burst of 10 clicks synchronously while latency is 50ms
    for (let i = 0; i < 10; i++) {
      btn.click();
    }

    // Immediately after burst:
    assert.equal(btn.disabled, true, 'button immediately disabled');
    assert.equal(harness.getCallCounts().scorePendingJobs, 1, 'EXACTLY ONE scorePendingJobs call dispatched despite 10 clicks');
    assert.equal(harness.elements.scoringBudgetStatus.getAttribute('aria-busy'), 'true', 'aria-busy is true');
    assert.ok(harness.elements.scoringRunResult.textContent.includes('Scoring next eligible job'), 'in-flight indicator shown');

    // Wait for completion (50ms latency + processing)
    await wait(80);

    // After completion, exactly 1 call was made total
    assert.equal(harness.getCallCounts().scorePendingJobs, 1, 'still exactly 1 call dispatched after completion');
    assert.equal(btn.disabled, false, 'button re-enabled after run completes');

    // Subsequent single click after completion dispatches the second run
    btn.click();
    assert.equal(harness.getCallCounts().scorePendingJobs, 2, 'subsequent click dispatches second call as expected');
    await wait(80);
  });

  it('suppresses burst double-clicks on Job Status transition buttons', async () => {
    const harness = createAdversarialHarness('?latency=50');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(80); // wait for initial jobs queue load with 50ms latency

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    assert.ok(card, 'job card rendered');
    const actions = card.querySelectorAll('.job-actions button');
    const reviewBtn = actions.find(b => b.textContent === 'Mark reviewed');
    assert.ok(reviewBtn, 'Mark reviewed button exists');

    // Burst of 5 clicks on the button
    reviewBtn.click();
    // Subsequent clicks either on the old ref or current ref
    reviewBtn.click();
    const currentCard = harness.elements.jobsContainer.querySelector('.job-card');
    const currentReviewBtn = currentCard.querySelectorAll('.job-actions button').find(b => b.textContent === 'Mark reviewed');
    currentReviewBtn.click();
    currentReviewBtn.click();
    currentReviewBtn.click();

    assert.equal(harness.getCallCounts().setJobStatus, 1, 'EXACTLY 1 setJobStatus call dispatched on 5 rapid clicks');
    assert.equal(currentReviewBtn.disabled, true, 'currently mounted action button disabled while pending');

    await wait(80);
    assert.equal(harness.getCallCounts().setJobStatus, 1, 'remains 1 after completion');
  });

  it('suppresses duplicate note form submissions while save is in flight', async () => {
    const harness = createAdversarialHarness('?latency=50');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(80); // wait for jobs queue load with 50ms latency

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    assert.ok(card, 'job card rendered');
    const form = card.querySelector('.job-note-form');
    const textarea = form.querySelector('textarea');
    textarea.value = 'Adversarial note content';

    // Burst submit
    form.submit();
    const currentCard = harness.elements.jobsContainer.querySelector('.job-card');
    const currentForm = currentCard.querySelector('.job-note-form');
    currentForm.submit();
    currentForm.submit();

    assert.equal(harness.getCallCounts().addJobNote, 1, 'EXACTLY 1 addJobNote call dispatched on duplicate submit');
    const currentSaveBtn = currentForm.querySelector('button');
    assert.equal(currentSaveBtn.disabled, true, 'currently mounted submit button disabled while pending');

    await wait(80);
    assert.equal(harness.getCallCounts().addJobNote, 1, 'remains 1 after completion');
  });

  it('suppresses duplicate clicks on application status transition buttons', async () => {
    const harness = createAdversarialHarness('?latency=50');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(80);

    // Job 2 (demo-job-2) has demo-app-1 in Draft status
    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1];
    assert.ok(card, 'Demo Works job card found');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(90); // wait for getApplicationsByJobId with 50ms latency

    const appCard = appSection.querySelector('.application-card');
    assert.ok(appCard, 'application card found');
    const appliedBtn = appCard.querySelectorAll('.app-actions button').find(b => b.textContent === 'Record as applied');
    assert.ok(appliedBtn, 'Record as applied button found');

    // Rapid burst clicks
    appliedBtn.click();
    appliedBtn.click();
    appliedBtn.click();
    appliedBtn.click();
    appliedBtn.click();

    assert.equal(harness.getCallCounts().setApplicationStatus, 1, 'EXACTLY 1 setApplicationStatus call dispatched');

    await wait(80);
    assert.equal(harness.getCallCounts().setApplicationStatus, 1, 'remains 1 call after resolution');
  });
});

// ===========================================================================
// Suite 3: State Transitions and Error Recovery (CONFLICT & INVALID_TRANSITION)
// ===========================================================================
describe('Adversarial 3: State Transitions and Error Recovery', () => {
  it('recovers safely from CONFLICT (optimistic lock mismatch) without mutating local state', async () => {
    const harness = createAdversarialHarness('?apps=conflict');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1];
    assert.ok(card, 'Demo Works card found');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const appCard = appSection.querySelector('.application-card');
    assert.ok(appCard, 'appCard found');
    const initialCalls = harness.getCallCounts().getApplicationsByJobId || 0;

    const appliedBtn = appCard.querySelectorAll('.app-actions button').find(b => b.textContent === 'Record as applied');
    assert.ok(appliedBtn, 'button found');

    // Attempt transition under CONFLICT
    appliedBtn.click();
    await wait(80); // wait for failure callback and announceAlert 30ms timer

    // 1. Live alert announced
    assert.ok(harness.elements.liveAlert.textContent.includes('This application changed before the request completed'), 'alert announced');

    // 2. Local status was NOT optimistically changed to Applied
    const reloadedCard = appSection.querySelector('.application-card');
    assert.ok(reloadedCard.textContent.includes('Draft'), 'status remains Draft in UI');

    // 3. Application state was reloaded from server
    assert.ok((harness.getCallCounts().getApplicationsByJobId || 0) > initialCalls, 'getApplicationsByJobId reloaded after conflict');
  });

  it('recovers safely from INVALID_TRANSITION without crashing or corrupting state', async () => {
    const harness = createAdversarialHarness('?apps=invalid-transition');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1];
    assert.ok(card, 'Demo Works card found');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const appCard = appSection.querySelector('.application-card');
    assert.ok(appCard, 'appCard found');
    const appliedBtn = appCard.querySelectorAll('.app-actions button').find(b => b.textContent === 'Record as applied');

    appliedBtn.click();
    await wait(80); // wait for failure callback and announceAlert 30ms timer

    assert.ok(harness.elements.liveAlert.textContent.includes('That status transition is not permitted from the current state.'), 'invalid transition alerted');
    const currentCard = appSection.querySelector('.application-card');
    assert.ok(currentCard.textContent.includes('Draft'), 'status intact');
  });

  it('handles CONFLICT and FORBIDDEN_FIELD gracefully in editApplication details form', async () => {
    let errorCodeToReturn = 'CONFLICT';

    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.updateApplication = function (appId, updates) {
        const err = new Error('Failure');
        err.code = errorCodeToReturn;
        throw err;
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const cards = harness.elements.jobsContainer.querySelectorAll('.job-card');
    const card = cards.find(c => c.querySelector('.job-company')?.textContent === 'Demo Works') || cards[1];
    assert.ok(card, 'Demo Works card found');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    const appCard = appSection.querySelector('.application-card');
    assert.ok(appCard, 'app card found');
    const editBtn = appCard.querySelectorAll('.app-actions button').find(b => b.textContent === 'Edit details');
    assert.ok(editBtn, 'Edit details button found');
    editBtn.click();

    const form = appCard.querySelector('.app-form');
    assert.ok(form, 'app-form found');
    const saveBtn = form.querySelector('button');
    assert.ok(saveBtn, 'save button found');

    // Test CONFLICT
    form.submit();
    await wait(40);

    assert.equal(saveBtn.disabled, false, 'save button re-enabled after CONFLICT');
    const errorP = form.querySelector('.state-message.is-error');
    assert.equal(errorP.hidden, false, 'error message visible');
    assert.ok(errorP.textContent.includes('This application changed before the request completed'), 'conflict message shown');

    // Test FORBIDDEN_FIELD
    errorCodeToReturn = 'FORBIDDEN_FIELD';
    form.submit();
    await wait(40);

    assert.equal(saveBtn.disabled, false, 'save button re-enabled after FORBIDDEN_FIELD');
    assert.ok(errorP.textContent.includes('Attempted to modify a protected application field'), 'forbidden field message shown');
  });

  it('handles ACTIVE_APPLICATION_EXISTS gracefully on application creation', async () => {
    const harness = createAdversarialHarness('?apps=duplicate-active');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const appSection = card.querySelector('.job-applications-section');
    appSection.toggle();
    await wait(30);

    appSection.querySelector('.secondary-button').click();
    const form = appSection.querySelector('.app-form');
    assert.ok(form, 'app-form found');
    const submitBtn = form.querySelector('button');
    assert.ok(submitBtn, 'submit button found');

    form.submit();
    await wait(40);

    assert.equal(submitBtn.disabled, false, 'submit button re-enabled');
    const errorP = appSection.querySelector('.state-message.is-error');
    assert.ok(errorP, 'error element present');
    assert.ok(errorP.textContent.includes('active application already exists'));
  });

  it('clears stale error messages when a new status action or note save is retried', async () => {
    let succeedAction = false;

    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.setJobStatus = function (jobId, target) {
        if (!succeedAction) {
          const err = new Error('Network error on transition');
          throw err;
        }
        return { id: jobId, status: target };
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    const reviewBtn = card.querySelectorAll('.job-actions button').find(b => b.textContent === 'Mark reviewed');

    // First attempt fails
    reviewBtn.click();
    await wait(40);

    // Error banner should be mounted in container
    let containerBanner = harness.elements.jobsContainer.querySelector('.state-message.is-error');
    assert.ok(containerBanner, 'error banner displayed');
    assert.ok(containerBanner.textContent.includes('Network error on transition'), 'error banner message text');

    // Now retry with success: verify stale error is cleared immediately when starting action
    succeedAction = true;
    const reCard = harness.elements.jobsContainer.querySelector('.job-card');
    const reBtn = reCard.querySelectorAll('.job-actions button').find(b => b.textContent === 'Mark reviewed');
    reBtn.click();

    // Immediately after click, jobsState.errorMessage is cleared (verified by design pass change)
    const activeBanner = harness.elements.jobsContainer.querySelector('.state-message.is-error');
    assert.equal(activeBanner, null, 'stale error banner cleared immediately on retry click');
  });

  it('recovers cleanly from scoring failure without locking button permanently', async () => {
    let failScoring = true;

    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.scorePendingJobs = function () {
        if (failScoring) {
          const err = new Error('Rate limit reached');
          err.code = 'RATE_LIMIT';
          throw err;
        }
        return {
          runId: 'run-retry',
          attempted: 1, scored: 1, cached: 0, quarantined: 0, failed: 0
        };
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const btn = harness.elements.scoreNextJobBtn;
    assert.equal(btn.disabled, false);

    // Click and fail
    btn.click();
    await wait(40);

    // Error banner displayed with mapped text
    const banner = harness.elements.scoringRunResult;
    assert.equal(banner.hidden, false);
    assert.ok(banner.textContent.includes('Provider rate limit reached'));
    assert.equal(btn.disabled, false, 'scoring button not permanently locked after failure');

    // Retry succeeds
    failScoring = false;
    btn.click();
    await wait(40);

    assert.ok(banner.textContent.includes('Scoring run completed: 1 attempted, 1 scored'));
  });

  it('maintains pending suppression even if user navigates across tabs while scoring is in flight', async () => {
    const harness = createAdversarialHarness('?latency=60');
    await wait(20);
    harness.elements.navJobs.click();
    await wait(80);

    const btn = harness.elements.scoreNextJobBtn;
    btn.click();
    assert.equal(harness.getCallCounts().scorePendingJobs, 1);

    // Switch to Home then Tasks while scoring is in flight
    harness.elements.navHome.click();
    await wait(10);
    harness.elements.navTasks.click();
    await wait(10);

    // Switch back to Jobs while still in flight
    harness.elements.navJobs.click();
    await wait(10);

    // Click again while still in flight
    btn.click();
    assert.equal(harness.getCallCounts().scorePendingJobs, 1, 'duplicate call suppressed across view navigation');

    await wait(70);
    assert.equal(btn.disabled, false, 're-enabled after async resolution');
  });

  it('handles style tag injection and unicode payloads without breaking DOM structure', async () => {
    const UNICODE_PAYLOAD = '🚀 Engineer \u0000 <style>body{display:none !important;}</style> \u202Ereversed\u202C';

    const harness = createAdversarialHarness('', (mockFns) => {
      mockFns.getJobsQueue = function () {
        return {
          status: 'ok',
          today: '2026-09-14',
          activeJobs: [
            {
              id: 'adv-job-style',
              title: UNICODE_PAYLOAD,
              company: 'Acme Corp',
              location: 'Remote',
              remote: true,
              remoteLabel: 'Remote',
              overallMatch: 90,
              salaryMin: null,
              salaryMax: null,
              currency: '',
              source: 'Direct',
              sourceUrl: 'https://example.com/job/style',
              postedDate: '2026-09-10',
              discoveredDate: '2026-09-14',
              externalId: 'ext-style',
              lastSeenAt: '2026-09-14T10:00:00.000Z',
              freshness: 'recent',
              status: 'New',
              recordVersion: 1
            }
          ],
          rejectedJobs: [],
          quarantined: [],
          message: ''
        };
      };
    });

    await wait(20);
    harness.elements.navJobs.click();
    await wait(30);

    const card = harness.elements.jobsContainer.querySelector('.job-card');
    assert.ok(card, 'job card rendered');
    assert.equal(card.querySelectorAll('style').length, 0, 'zero style tags created');
    const titleEl = card.querySelector('.job-card-title');
    assert.equal(titleEl.textContent, UNICODE_PAYLOAD, 'verbatim unicode and style text rendered safely');
  });
});
