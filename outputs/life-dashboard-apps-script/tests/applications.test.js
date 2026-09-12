'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScriptContext_, hostify_ } = require('./gas-fakes');

const APP_FILES = ['Database.gs', 'Code.gs', 'Jobs.gs', 'Applications.gs'];

function schema_() {
  return loadAppsScriptContext_({ files: APP_FILES }).testExports.SCHEMA;
}

function initializedSheets_(schema) {
  const sheets = {};
  Object.keys(schema).forEach((name) => {
    sheets[name] = { header: schema[name].slice(), rows: [] };
  });
  return sheets;
}

function rowFor_(schema, sheetName, values) {
  return schema[sheetName].map((field) => (
    Object.prototype.hasOwnProperty.call(values, field) ? values[field] : ''
  ));
}

function jobRow_(schema, overrides) {
  const base = {
    id: 'job-1',
    external_id: 'src-1',
    source: 'JSearch',
    url: 'https://jobs.example.org/posting/1',
    title: 'Senior IT Specialist',
    company: 'TechCorp',
    location: 'Pittsburgh, PA',
    remote: false,
    salary_min: 65000,
    salary_max: 85000,
    currency: 'USD',
    posted_at: '2026-09-10T12:00:00.000Z',
    discovered_at: '2026-09-11T12:00:00.000Z',
    last_seen_at: new Date(),
    description: 'Provide IT systems and tier 2/3 hardware/software support',
    overall_match: 92,
    recommendation: 'Strong Match',
    why_matches: 'WGU degree and enterprise IT administration experience',
    gaps: 'None noted',
    status: 'Ready to Apply',
    notes: '',
    record_version: 0
  };
  return rowFor_(schema, 'Jobs', Object.assign(base, overrides || {}));
}

function appRow_(schema, overrides) {
  const base = {
    id: 'app-1',
    job_id: 'job-1',
    status: 'Draft',
    applied_at: '',
    follow_up_at: '',
    contact_name: 'Jane Recruiter',
    contact_email: 'jane@techcorp.com',
    interview_at: '',
    outcome: '',
    notes: '',
    created_at: new Date('2026-09-11T12:00:00.000Z'),
    updated_at: new Date('2026-09-11T12:00:00.000Z')
  };
  return rowFor_(schema, 'Applications', Object.assign(base, overrides || {}));
}

function context_(jobs, apps, appHistories, jobHistories, extra) {
  const schema = schema_();
  const sheets = initializedSheets_(schema);
  sheets.Jobs.rows = jobs || [];
  sheets.Applications.rows = apps || [];
  sheets.ApplicationHistory.rows = appHistories || [];
  sheets.JobHistory.rows = jobHistories || [];
  const ctx = loadAppsScriptContext_(Object.assign({
    files: APP_FILES,
    initialSheets: sheets
  }, extra || {}));
  ctx.schema = schema;
  return ctx;
}

function jobField_(ctx, rowIndex, field) {
  return ctx.sheetsByName.Jobs.data[rowIndex][ctx.schema.Jobs.indexOf(field)];
}

function appField_(ctx, rowIndex, field) {
  return ctx.sheetsByName.Applications.data[rowIndex][ctx.schema.Applications.indexOf(field)];
}

function appHistoryField_(ctx, rowIndex, field) {
  return ctx.sheetsByName.ApplicationHistory.data[rowIndex][ctx.schema.ApplicationHistory.indexOf(field)];
}

describe('Applications: State Machine Statuses & Transitions', () => {
  it('exposes the closed 6-status list', () => {
    const ctx = context_();
    const statuses = hostify_(ctx.sandbox.getApplicationStatuses_());
    assert.deepEqual(statuses, ['Draft', 'Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn']);
  });

  it('exposes the valid transitions matrix', () => {
    const ctx = context_();
    const transitions = hostify_(ctx.sandbox.getApplicationTransitions_());
    assert.deepEqual(transitions, {
      'Draft': ['Applied', 'Withdrawn'],
      'Applied': ['Interview', 'Rejected', 'Withdrawn'],
      'Interview': ['Offer', 'Rejected', 'Withdrawn'],
      'Offer': ['Rejected', 'Withdrawn'],
      'Rejected': [],
      'Withdrawn': []
    });
  });
});

describe('Applications: createApplication_', () => {
  it('creates an application in Draft status for an existing job and syncs Job', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1', status: 'Saved' })]);

    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_name: 'Alice Recruiter',
      contact_email: 'alice@company.com',
      notes: 'Initial drafting'
    }));

    assert.ok(app.id.startsWith('test-uuid-') || app.id.length > 0);
    assert.equal(app.job_id, 'job-1');
    assert.equal(app.status, 'Draft');
    assert.equal(app.applied_at, '');
    assert.equal(app.contact_name, 'Alice Recruiter');
    assert.equal(app.contact_email, 'alice@company.com');
    assert.ok(app.notes.includes('Initial drafting'));

    // Job should be synchronized from Saved -> Ready to Apply
    assert.equal(jobField_(ctx, 1, 'status'), 'Ready to Apply');
    assert.equal(jobField_(ctx, 1, 'record_version'), 1);

    // ApplicationHistory audit row
    assert.equal(ctx.sheetsByName.ApplicationHistory.data.length, 2);
    assert.equal(appHistoryField_(ctx, 1, 'application_id'), app.id);
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'create_application');
    assert.equal(appHistoryField_(ctx, 1, 'from_status'), '');
    assert.equal(appHistoryField_(ctx, 1, 'to_status'), 'Draft');

    // JobHistory audit row
    assert.equal(ctx.sheetsByName.JobHistory.data.length, 2);
    assert.equal(ctx.sheetsByName.JobHistory.data[1][ctx.schema.JobHistory.indexOf('to_status')], 'Ready to Apply');
  });

  it('creates an application in Applied status directly and sets applied_at', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })]);

    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Applied', {
      applied_at: '2026-09-12T14:00:00.000Z',
      contact_name: 'Bob Hiring Manager'
    }));

    assert.equal(app.status, 'Applied');
    assert.equal(app.applied_at, '2026-09-12T14:00:00.000Z');
    assert.equal(jobField_(ctx, 1, 'status'), 'Applied');

    // Audit logs verified
    assert.equal(appHistoryField_(ctx, 1, 'to_status'), 'Applied');
  });

  it('defaults to Draft status when initialStatus is omitted or empty', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })]);

    const app = hostify_(ctx.sandbox.createApplication_('job-1'));
    assert.equal(app.status, 'Draft');
  });

  it('rejects an invalid initial status with INVALID_STATUS without writing', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);
    const beforeApps = ctx.sheetsByName.Applications.data.length;

    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Interview');
    }, (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });

    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Rejected');
    }, (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });

    assert.equal(ctx.sheetsByName.Applications.data.length, beforeApps);
  });

  it('rejects a blank or invalid jobId with INVALID_ID', () => {
    const ctx = context_();
    assert.throws(() => ctx.sandbox.createApplication_(''), (err) => err.code === 'INVALID_ID');
    assert.throws(() => ctx.sandbox.createApplication_(null), (err) => err.code === 'INVALID_ID');
    assert.throws(() => ctx.sandbox.createApplication_('   '), (err) => err.code === 'INVALID_ID');
  });

  it('rejects a non-existent jobId with NOT_FOUND', () => {
    const ctx = context_();
    assert.throws(() => {
      ctx.sandbox.createApplication_('missing-job-id', 'Draft');
    }, (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
    assert.equal(ctx.sheetsByName.Applications.data.length, 1);
  });
});

describe('Applications: Single Active Application Constraint', () => {
  it('blocks creating a duplicate active application for the same job_id', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [appRow_(schema, { id: 'app-existing', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft');
    }, (err) => {
      assert.equal(err.code, 'DUPLICATE_ACTIVE_APPLICATION');
      return true;
    });

    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'DUPLICATE_ACTIVE_APPLICATION');
      return true;
    });

    // Zero extra rows written
    assert.equal(ctx.sheetsByName.Applications.data.length, 2);
  });

  it('blocks creating an active application when an Interview or Offer app exists', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Interview' })],
      [appRow_(schema, { id: 'app-interview', job_id: 'job-1', status: 'Interview' })]
    );

    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft');
    }, (err) => {
      assert.equal(err.code, 'DUPLICATE_ACTIVE_APPLICATION');
      return true;
    });
  });

  it('allows re-application if all prior applications for that job are terminal (Rejected or Withdrawn)', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [
        appRow_(schema, { id: 'app-old-1', job_id: 'job-1', status: 'Rejected' }),
        appRow_(schema, { id: 'app-old-2', job_id: 'job-1', status: 'Withdrawn' })
      ]
    );

    const newApp = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      notes: 'Re-applying after 6-month cooling period'
    }));

    assert.ok(newApp.id);
    assert.notEqual(newApp.id, 'app-old-1');
    assert.notEqual(newApp.id, 'app-old-2');
    assert.equal(newApp.status, 'Draft');
    assert.equal(ctx.sheetsByName.Applications.data.length, 4); // header + 2 old + 1 new
  });

  it('blocks transitioning application B to active if application A for same job is active', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [
        appRow_(schema, { id: 'app-active', job_id: 'job-1', status: 'Draft' }),
        appRow_(schema, { id: 'app-withdrawn', job_id: 'job-1', status: 'Withdrawn' })
      ]
    );

    // Attempting to transition withdrawn app to active will fail transition matrix first
    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-withdrawn', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });
});

describe('Applications: updateApplicationStatus_ (Allowed Lifecycle Transitions)', () => {
  it('transitions Draft -> Applied with applied_at timestamp and job sync', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply', record_version: 1 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft', applied_at: '' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Applied', {
      applied_at: '2026-09-12T15:30:00.000Z',
      notes: 'Submitted resume via career portal'
    }));

    assert.equal(updated.status, 'Applied');
    assert.equal(updated.applied_at, '2026-09-12T15:30:00.000Z');
    assert.ok(updated.notes.includes('Submitted resume via career portal'));

    // Verify Jobs sync
    assert.equal(jobField_(ctx, 1, 'status'), 'Applied');
    assert.equal(jobField_(ctx, 1, 'record_version'), 2);

    // Verify ApplicationHistory
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'submit_application');
    assert.equal(appHistoryField_(ctx, 1, 'from_status'), 'Draft');
    assert.equal(appHistoryField_(ctx, 1, 'to_status'), 'Applied');
  });

  it('transitions Draft -> Withdrawn and sets linked Job to Rejected', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply', record_version: 0 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Withdrawn', {
      outcome: 'Decided not to apply'
    }));

    assert.equal(updated.status, 'Withdrawn');
    assert.equal(updated.outcome, 'Decided not to apply');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'withdraw_application');
  });

  it('transitions Applied -> Interview and sets linked Job to Interview', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied', record_version: 1 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied', applied_at: '2026-09-10T00:00:00.000Z' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Interview', {
      interview_at: '2026-09-20T14:00:00.000Z',
      notes: 'Initial screening call scheduled'
    }));

    assert.equal(updated.status, 'Interview');
    assert.equal(updated.interview_at, '2026-09-20T14:00:00.000Z');
    assert.equal(jobField_(ctx, 1, 'status'), 'Interview');
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'advance_to_interview');
  });

  it('transitions Applied -> Rejected and sets linked Job to Rejected', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied', record_version: 1 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Rejected', {
      outcome: 'Automated rejection email'
    }));

    assert.equal(updated.status, 'Rejected');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'reject_application');
  });

  it('transitions Applied -> Withdrawn and sets linked Job to Rejected', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied', record_version: 1 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Withdrawn', 'Found another role'));
    assert.equal(updated.status, 'Withdrawn');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
  });

  it('transitions Interview -> Offer and sets linked Job to Offer', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Interview', record_version: 2 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Interview' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Offer', {
      outcome: 'Offered $75,000/yr'
    }));

    assert.equal(updated.status, 'Offer');
    assert.equal(jobField_(ctx, 1, 'status'), 'Offer');
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'receive_offer');
  });

  it('transitions Interview -> Rejected', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Interview', record_version: 2 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Interview' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Rejected', 'Passed on candidate'));
    assert.equal(updated.status, 'Rejected');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
  });

  it('transitions Interview -> Withdrawn', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Interview', record_version: 2 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Interview' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Withdrawn', 'Candidate withdrew'));
    assert.equal(updated.status, 'Withdrawn');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
  });

  it('transitions Offer -> Withdrawn (declining offer)', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Offer', record_version: 3 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Offer' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Withdrawn', {
      outcome: 'Declined due to commute'
    }));

    assert.equal(updated.status, 'Withdrawn');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
  });

  it('transitions Offer -> Rejected (rescinded offer)', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Offer', record_version: 3 })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Offer' })]
    );

    const updated = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Rejected', {
      outcome: 'Budget freeze cancelled requisition'
    }));

    assert.equal(updated.status, 'Rejected');
    assert.equal(jobField_(ctx, 1, 'status'), 'Rejected');
  });
});

describe('Applications: updateApplicationStatus_ (Disallowed Transitions & Terminal Invariants)', () => {
  it('blocks stage-skipping forward from Draft -> Interview or Offer', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Interview');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Offer');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('blocks regressions backwards (e.g. Applied -> Draft, Interview -> Applied, Offer -> Interview)', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Draft');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('blocks transitions out of terminal Rejected state', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Rejected' })]
    );

    ['Draft', 'Applied', 'Interview', 'Offer', 'Withdrawn'].forEach((target) => {
      assert.throws(() => {
        ctx.sandbox.updateApplicationStatus_('app-1', target);
      }, (err) => {
        assert.equal(err.code, 'INVALID_TRANSITION');
        return true;
      });
    });
  });

  it('blocks transitions out of terminal Withdrawn state', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Withdrawn' })]
    );

    ['Draft', 'Applied', 'Interview', 'Offer', 'Rejected'].forEach((target) => {
      assert.throws(() => {
        ctx.sandbox.updateApplicationStatus_('app-1', target);
      }, (err) => {
        assert.equal(err.code, 'INVALID_TRANSITION');
        return true;
      });
    });
  });
});

describe('Applications: Idempotent Self-Transitions & Metadata Updates', () => {
  it('returns current record unchanged on idempotent transition without data', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' })]
    );

    const result = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Applied'));
    assert.equal(result.id, 'app-1');
    assert.equal(result.status, 'Applied');
    // Zero history entries logged
    assert.equal(ctx.sheetsByName.ApplicationHistory.data.length, 1);
  });

  it('updates metadata and logs update_metadata when self-transitioning with fields', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Interview' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Interview', contact_name: 'Old Contact' })]
    );

    const result = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Interview', {
      contact_name: 'New Contact Person',
      contact_email: 'newcontact@techcorp.com'
    }));

    assert.equal(result.contact_name, 'New Contact Person');
    assert.equal(result.contact_email, 'newcontact@techcorp.com');
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'update_metadata');
  });

  it('appends multiline timestamped notes on self-transition', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied', notes: '[2026-09-10T10:00:00.000Z] Prior note' })]
    );

    const result = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Applied', {
      notes: 'Second note added'
    }));

    assert.ok(result.notes.includes('Prior note'));
    assert.ok(result.notes.includes('Second note added'));
    assert.equal(appHistoryField_(ctx, 1, 'action'), 'add_note');
  });
});

describe('Applications: Input Validation & Formula Injection Safeguards', () => {
  it('validates contact email format', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    // Invalid email formats
    ['not-an-email', 'user@', '@domain.com', 'user@domain', 'user with spaces@domain.com'].forEach((bad) => {
      assert.throws(() => {
        ctx.sandbox.createApplication_('job-1', 'Draft', { contact_email: bad });
      }, (err) => {
        assert.equal(err.code, 'INVALID_FIELD');
        return true;
      });
    });

    // Valid email format succeeds
    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_email: 'recruiter.talent+leads@sub.example.com'
    }));
    assert.equal(app.contact_email, 'recruiter.talent+leads@sub.example.com');
  });

  it('enforces character length limits', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    // Contact name > 150 chars
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft', { contact_name: 'a'.repeat(151) });
    }, (err) => err.code === 'INVALID_FIELD');

    // Contact email > 254 chars
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft', { contact_email: 'a'.repeat(245) + '@domain.com' });
    }, (err) => err.code === 'INVALID_FIELD');

    // Outcome > 500 chars
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft', { outcome: 'a'.repeat(501) });
    }, (err) => err.code === 'INVALID_FIELD');

    // Notes > 2000 chars
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft', { notes: 'a'.repeat(2001) });
    }, (err) => err.code === 'INVALID_FIELD');
  });

  it('validates ISO-8601 date fields', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    // Malformed date
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft', { follow_up_at: 'invalid-date' });
    }, (err) => err.code === 'INVALID_FIELD');

    // Date out of bounds (prior to 2020)
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft', { follow_up_at: '2015-05-01T00:00:00.000Z' });
    }, (err) => err.code === 'INVALID_FIELD');
  });

  it('neutralizes spreadsheet formula injection in text fields', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_name: '=CMD|calc.exe',
      outcome: '+12345',
      notes: '-malicious-formula'
    }));

    assert.equal(app.contact_name, "'=CMD|calc.exe");
    assert.equal(app.outcome, "'+12345");
    assert.ok(app.notes.includes("'-malicious-formula"));
  });
});

describe('Applications: Query Methods & History Retrieval', () => {
  it('getApplicationById_ retrieves matching application', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-target', job_id: 'job-1', status: 'Applied' })]
    );

    const app = hostify_(ctx.sandbox.getApplicationById_('app-target'));
    assert.equal(app.id, 'app-target');
    assert.equal(app.status, 'Applied');
  });

  it('getApplicationById_ throws APPLICATION_NOT_FOUND for non-existent ID', () => {
    const ctx = context_();
    assert.throws(() => {
      ctx.sandbox.getApplicationById_('missing-app');
    }, (err) => {
      assert.equal(err.code, 'APPLICATION_NOT_FOUND');
      return true;
    });
  });

  it('getApplicationsByJobId_ returns matching applications sorted newest first', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [
        appRow_(schema, { id: 'app-older', job_id: 'job-1', status: 'Rejected', created_at: new Date('2026-08-01T00:00:00.000Z') }),
        appRow_(schema, { id: 'app-newer', job_id: 'job-1', status: 'Draft', created_at: new Date('2026-09-01T00:00:00.000Z') }),
        appRow_(schema, { id: 'app-other-job', job_id: 'job-2', status: 'Draft' })
      ]
    );

    const apps = hostify_(ctx.sandbox.getApplicationsByJobId_('job-1'));
    assert.equal(apps.length, 2);
    assert.equal(apps[0].id, 'app-newer');
    assert.equal(apps[1].id, 'app-older');
  });

  it('getApplicationsByJobId_ returns empty array for job with no applications', () => {
    const ctx = context_();
    const apps = hostify_(ctx.sandbox.getApplicationsByJobId_('job-none'));
    assert.deepEqual(apps, []);
  });

  it('getApplicationHistory_ returns chronological history records newest first', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1' })],
      [
        rowFor_(schema, 'ApplicationHistory', {
          id: 'hist-1', application_id: 'app-1', job_id: 'job-1', action: 'create_application',
          from_status: '', to_status: 'Draft', note: 'Created', created_at: new Date('2026-09-10T10:00:00.000Z')
        }),
        rowFor_(schema, 'ApplicationHistory', {
          id: 'hist-2', application_id: 'app-1', job_id: 'job-1', action: 'submit_application',
          from_status: 'Draft', to_status: 'Applied', note: 'Submitted', created_at: new Date('2026-09-11T10:00:00.000Z')
        })
      ]
    );

    const history = hostify_(ctx.sandbox.getApplicationHistory_('app-1'));
    assert.equal(history.length, 2);
    assert.equal(history[0].id, 'hist-2');
    assert.equal(history[1].id, 'hist-1');
  });
});

describe('Applications: Zero External Actions Compliance', () => {
  it('performs zero UrlFetchApp HTTP calls during any application lifecycle operation', () => {
    const schema = schema_();
    let urlFetchCalled = false;
    const ctx = context_([jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })], [], [], [], {
      urlFetch: {
        fetch: function () {
          urlFetchCalled = true;
          throw new Error('UrlFetchApp must not be called from Applications.gs');
        }
      }
    });

    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_name: 'Test Recruiter',
      contact_email: 'test@example.com'
    }));

    ctx.sandbox.updateApplicationStatus_(app.id, 'Applied');
    ctx.sandbox.updateApplicationStatus_(app.id, 'Interview');
    ctx.sandbox.getApplicationById_(app.id);
    ctx.sandbox.getApplicationsByJobId_('job-1');
    ctx.sandbox.getApplicationHistory_(app.id);

    assert.equal(urlFetchCalled, false, 'Expected 0 UrlFetchApp.fetch calls during all application operations');
  });
});
