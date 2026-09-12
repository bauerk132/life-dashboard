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
    description: 'IT Systems and hardware support',
    overall_match: 92,
    recommendation: 'Strong Match',
    why_matches: 'WGU degree and IT admin experience',
    gaps: 'None',
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

describe('Adversarial Challenge 1: State Machine Transitions', () => {
  it('rejects Draft -> Interview with INVALID_TRANSITION', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Interview');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('rejects Draft -> Rejected directly (must be Withdrawn)', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Rejected');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('rejects Rejected -> Applied (terminal resurrection) with INVALID_TRANSITION', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Rejected' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Applied');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('rejects Withdrawn -> Offer (terminal resurrection) with INVALID_TRANSITION', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Withdrawn' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'Offer');
    }, (err) => {
      assert.equal(err.code, 'INVALID_TRANSITION');
      return true;
    });
  });

  it('rejects invalid status string "ACCEPTED" with INVALID_STATUS', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Offer' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'ACCEPTED');
    }, (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });
  });

  it('rejects invalid status string "PENDING" with INVALID_STATUS', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'PENDING');
    }, (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });
  });

  it('rejects lowercase "applied" with INVALID_STATUS', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', 'applied');
    }, (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });
  });

  it('rejects status with whitespace like " Applied " or "Applied\\n" with INVALID_STATUS in updateApplicationStatus_', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    assert.throws(() => {
      ctx.sandbox.updateApplicationStatus_('app-1', ' Applied ');
    }, (err) => {
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    });
  });

  it('rejects prototype pollution and injection attempts in targetStatus', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    ['__proto__', 'constructor', 'toString', "' OR '1'='1", '; DROP TABLE Applications;', 'Αpplied'].forEach((bad) => {
      assert.throws(() => {
        ctx.sandbox.updateApplicationStatus_('app-1', bad);
      }, (err) => {
        assert.equal(err.code, 'INVALID_STATUS');
        return true;
      });
    });
  });

  it('rejects non-string targetStatus values (null, number, object, array)', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    [null, undefined, 123, {}, ['Applied'], () => 'Applied'].forEach((badStatus) => {
      assert.throws(() => {
        ctx.sandbox.updateApplicationStatus_('app-1', badStatus);
      }, (err) => {
        assert.equal(err.code, 'INVALID_STATUS');
        return true;
      });
    });
  });

  it('exhaustively asserts all invalid backward regressions in the state machine', () => {
    const schema = schema_();
    const invalidRegressions = [
      { from: 'Applied', to: 'Draft' },
      { from: 'Interview', to: 'Draft' },
      { from: 'Interview', to: 'Applied' },
      { from: 'Offer', to: 'Draft' },
      { from: 'Offer', to: 'Applied' },
      { from: 'Offer', to: 'Interview' },
      { from: 'Rejected', to: 'Withdrawn' },
      { from: 'Withdrawn', to: 'Rejected' }
    ];

    invalidRegressions.forEach(({ from, to }) => {
      const ctx = context_(
        [jobRow_(schema, { id: 'job-1', status: from === 'Draft' ? 'Ready to Apply' : from })],
        [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: from })]
      );

      assert.throws(() => {
        ctx.sandbox.updateApplicationStatus_('app-1', to);
      }, (err) => {
        assert.equal(err.code, 'INVALID_TRANSITION', `Expected INVALID_TRANSITION for ${from} -> ${to}`);
        return true;
      });
    });
  });

  it('identifies terminal state metadata mutation vulnerability via self-transition', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Rejected', notes: 'Old note' })]
    );

    // Testing whether updateApplicationStatus_ allows editing metadata on terminal Rejected state
    const result = hostify_(ctx.sandbox.updateApplicationStatus_('app-1', 'Rejected', {
      notes: 'New post-rejection note',
      outcome: 'Rejected after final round',
      contact_name: 'Hacked Contact'
    }));

    // Observe that metadata was mutated on a supposedly terminal immutable application
    assert.equal(result.status, 'Rejected');
    assert.equal(result.contact_name, 'Hacked Contact');
    assert.ok(result.notes.includes('New post-rejection note'));
    console.log('[FINDING TELEMETRY] Terminal application metadata mutated despite terminal state:', result.contact_name);
  });
});

describe('Adversarial Challenge 2: Single Active Application Constraint', () => {
  it('blocks creating duplicate active applications when one is in Draft, Applied, Interview, or Offer', () => {
    const schema = schema_();
    const activeStatuses = ['Draft', 'Applied', 'Interview', 'Offer'];

    activeStatuses.forEach((status) => {
      const ctx = context_(
        [jobRow_(schema, { id: 'job-1', status: status === 'Draft' ? 'Ready to Apply' : status })],
        [appRow_(schema, { id: 'app-active', job_id: 'job-1', status: status })]
      );

      // Attempt create in Draft
      assert.throws(() => {
        ctx.sandbox.createApplication_('job-1', 'Draft');
      }, (err) => {
        assert.equal(err.code, 'DUPLICATE_ACTIVE_APPLICATION');
        return true;
      });

      // Attempt create in Applied
      assert.throws(() => {
        ctx.sandbox.createApplication_('job-1', 'Applied');
      }, (err) => {
        assert.equal(err.code, 'DUPLICATE_ACTIVE_APPLICATION');
        return true;
      });
    });
  });

  it('permits concurrent active applications across DIFFERENT jobs', () => {
    const schema = schema_();
    const ctx = context_([
      jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' }),
      jobRow_(schema, { id: 'job-2', status: 'Ready to Apply' }),
      jobRow_(schema, { id: 'job-3', status: 'Ready to Apply' })
    ]);

    const app1 = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft'));
    const app2 = hostify_(ctx.sandbox.createApplication_('job-2', 'Applied'));
    const app3 = hostify_(ctx.sandbox.createApplication_('job-3', 'Draft'));

    assert.equal(app1.status, 'Draft');
    assert.equal(app2.status, 'Applied');
    assert.equal(app3.status, 'Draft');
    assert.equal(ctx.sheetsByName.Applications.data.length, 4); // header + 3 apps
  });

  it('blocks resurrecting a terminal application (Rejected or Withdrawn) into an active state', () => {
    const schema = schema_();

    ['Rejected', 'Withdrawn'].forEach((termStatus) => {
      const ctx = context_(
        [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
        [appRow_(schema, { id: 'app-term', job_id: 'job-1', status: termStatus })]
      );

      ['Draft', 'Applied', 'Interview', 'Offer'].forEach((activeTarget) => {
        assert.throws(() => {
          ctx.sandbox.updateApplicationStatus_('app-term', activeTarget);
        }, (err) => {
          assert.equal(err.code, 'INVALID_TRANSITION');
          return true;
        });
      });
    });
  });

  it('allows creating a new application only when ALL prior applications for that job are terminal', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected' })],
      [
        appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Rejected' }),
        appRow_(schema, { id: 'app-2', job_id: 'job-1', status: 'Withdrawn' })
      ]
    );

    const newApp = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft'));
    assert.equal(newApp.status, 'Draft');
    assert.equal(ctx.sheetsByName.Applications.data.length, 4); // header + app-1 + app-2 + newApp

    // Now that newApp is active, a 4th application must be blocked
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-1', 'Draft');
    }, (err) => {
      assert.equal(err.code, 'DUPLICATE_ACTIVE_APPLICATION');
      return true;
    });
  });

  it('detects Job status desynchronization when re-applying to a Rejected job in Draft status', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Rejected', record_version: 2 })],
      [appRow_(schema, { id: 'app-old', job_id: 'job-1', status: 'Rejected' })]
    );

    // Re-apply in Draft
    ctx.sandbox.createApplication_('job-1', 'Draft');

    // Inspect Job status in the spreadsheet
    const jobStatusInDb = ctx.sheetsByName.Jobs.data[1][schema.Jobs.indexOf('status')];
    // Finding: The job remained 'Rejected' because syncJobStatusFromApplication_ only transitions
    // Draft to 'Ready to Apply' if currentJob.status === 'Saved'!
    assert.equal(jobStatusInDb, 'Rejected');
    console.log('[FINDING TELEMETRY] Job status after re-applying in Draft to Rejected job remains:', jobStatusInDb);
  });

  it('enforces optimistic concurrency conflict detection on concurrent application update', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Applied' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Applied' })]
    );

    // We simulate a race condition where the sheet row is changed after reading currentApp
    // but before updateRecordByIdInDb_ writes.
    // In gas-fakes, we can hook into getRange or inspect updateRecordByIdInDb_ precondition directly.
    assert.throws(() => {
      ctx.sandbox.updateRecordByIdInDb_(ctx.sandbox.getDb_(), 'Applications', 'app-1', { status: 'Interview' }, function (fresh) {
        // Precondition simulating a conflict check
        if (fresh.status === 'Applied') {
          throw ctx.sandbox.UserError_('This application changed before the request completed. Refresh and try again.', 'CONFLICT');
        }
      });
    }, (err) => {
      assert.equal(err.code, 'CONFLICT');
      return true;
    });
  });
});

describe('Adversarial Challenge 3: Formula Injection & Boundary Escapes', () => {
  it('evaluates formula injection neutralization in Applications text fields (=CMD, +cmd, @sum)', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_name: "=CMD|' /C calc'!A0",
      outcome: "+cmd",
      notes: "@sum()"
    }));

    // In Applications sheet
    assert.equal(app.contact_name, "'=CMD|' /C calc'!A0");
    assert.equal(app.outcome, "'+cmd");
    assert.ok(app.notes.includes("'@sum()"));
  });

  it('detects formula injection vulnerability in contact_email starting with + or -', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    // An email starting with + or - is valid per regex but is an unsanitized formula character
    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_email: '+calc@example.com'
    }));

    // Stored without leading single quote!
    assert.equal(app.contact_email, '+calc@example.com');
    console.log('[FINDING TELEMETRY] Unsanitized contact_email stored value:', JSON.stringify(app.contact_email));
  });

  it('detects formula injection vulnerability in ApplicationHistory.note on transition', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    ctx.sandbox.updateApplicationStatus_('app-1', 'Applied', {
      notes: "=CMD|' /C calc'!A0"
    });

    const appHistNote = ctx.sheetsByName.ApplicationHistory.data[1][schema.ApplicationHistory.indexOf('note')];
    // In ApplicationHistory, note is stored RAW with leading '='
    assert.equal(appHistNote, "=CMD|' /C calc'!A0");
    console.log('[FINDING TELEMETRY] Unsanitized ApplicationHistory.note stored on transition:', JSON.stringify(appHistNote));
  });

  it('detects formula injection vulnerability in JobHistory.note on transition', () => {
    const schema = schema_();
    const ctx = context_(
      [jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })],
      [appRow_(schema, { id: 'app-1', job_id: 'job-1', status: 'Draft' })]
    );

    ctx.sandbox.updateApplicationStatus_('app-1', 'Applied', {
      notes: "=CMD|' /C calc'!A0"
    });

    const jobHistNote = ctx.sheetsByName.JobHistory.data[1][schema.JobHistory.indexOf('note')];
    // In JobHistory, note is stored RAW with leading '='
    assert.equal(jobHistNote, "=CMD|' /C calc'!A0");
    console.log('[FINDING TELEMETRY] Unsanitized JobHistory.note stored on transition:', JSON.stringify(jobHistNote));
  });

  it('detects multiline formula injection bypass in notes field', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    const multilinePayload = "Safe first line\n=CMD|' /C calc'!A0\n+secondFormula()";
    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      notes: multilinePayload
    }));

    // The second and third lines have raw = and + without single quote prefix!
    assert.ok(app.notes.includes('\n=CMD'));
    console.log('[FINDING TELEMETRY] Multiline note with raw formula line:', JSON.stringify(app.notes));
  });

  it('detects formula injection vulnerability in Jobs.gs addJobNote', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1', status: 'Ready to Apply' })]);

    const updatedJob = hostify_(ctx.sandbox.addJobNote('job-1', "=CMD|' /C calc'!A0"));
    assert.ok(updatedJob.notes.includes("=CMD|' /C calc'!A0"));

    const jobHistNote = ctx.sheetsByName.JobHistory.data[1][schema.JobHistory.indexOf('note')];
    assert.equal(jobHistNote, "=CMD|' /C calc'!A0");
    console.log('[FINDING TELEMETRY] Raw formula in Jobs.notes and JobHistory via addJobNote:', JSON.stringify(jobHistNote));
  });

  it('evaluates boundary length handling with formula prefix', () => {
    const schema = schema_();
    const ctx = context_([
      jobRow_(schema, { id: 'job-1' }),
      jobRow_(schema, { id: 'job-2' })
    ]);

    // Outcome exactly 500 chars starting with =
    const exact500 = '=' + 'a'.repeat(499);
    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      outcome: exact500
    }));

    // Should become 501 chars with leading quote
    assert.equal(app.outcome.length, 501);
    assert.equal(app.outcome[0], "'");

    // 501 chars before sanitization should throw INVALID_FIELD
    assert.throws(() => {
      ctx.sandbox.createApplication_('job-2', 'Draft', {
        outcome: '=' + 'a'.repeat(500)
      });
    }, (err) => err.code === 'INVALID_FIELD');
  });

  it('evaluates null bytes and special character handling in notes and names', () => {
    const schema = schema_();
    const ctx = context_([jobRow_(schema, { id: 'job-1' })]);

    const app = hostify_(ctx.sandbox.createApplication_('job-1', 'Draft', {
      contact_name: "Jane O'Connor <recruiter@tech.com>",
      notes: "Testing null \0 byte & special chars: ' \" < > & / \\"
    }));

    assert.equal(app.contact_name, "Jane O'Connor <recruiter@tech.com>");
    assert.ok(app.notes.includes("Testing null \0 byte & special chars: ' \" < > & / \\"));
  });
});
