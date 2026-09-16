const fs = require('fs');
const vm = require('vm');
const path = require('path');

const jobsSrc = fs.readFileSync(path.join(__dirname, 'Jobs.gs'), 'utf8');
const databaseSrc = fs.readFileSync(path.join(__dirname, 'Database.gs'), 'utf8').replace("SPREADSHEET_ID: ''", "SPREADSHEET_ID: 'dummy'");

function runBenchmark() {
  let data = [];
  const ctx = vm.createContext({
    Utilities: {
      getUuid: () => Math.random().toString()
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => {
          if (name !== 'Jobs') return null;
          return {
            getLastRow: () => data.length + 1,
            getDataRange: () => ({
              getValues: () => {
                if (data.length === 0) return [
                  ['id', 'title', 'company', 'location', 'remote', 'salary_min', 'salary_max',
                   'posted_at', 'source', 'url', 'description', 'skills_match', 'experience_match',
                   'location_match', 'salary_match', 'overall_match', 'recommendation', 'why_matches',
                   'gaps', 'status', 'saved_at', 'notes', 'external_id', 'last_seen_at']
                ];
                return data;
              }
            }),
            appendRow: (row) => {
              const start = performance.now();
              while(performance.now() - start < 2) {}
              if (data.length === 0) data.push(
                ['id', 'title', 'company', 'location', 'remote', 'salary_min', 'salary_max',
                 'posted_at', 'source', 'url', 'description', 'skills_match', 'experience_match',
                 'location_match', 'salary_match', 'overall_match', 'recommendation', 'why_matches',
                 'gaps', 'status', 'saved_at', 'notes', 'external_id', 'last_seen_at']
              );
              data.push(row);
            },
            getRange: () => ({
              setValues: (values) => {
                const start = performance.now();
                while(performance.now() - start < 10) {}
                values.forEach(row => {
                  if (data.length === 0) data.push(
                    ['id', 'title', 'company', 'location', 'remote', 'salary_min', 'salary_max',
                     'posted_at', 'source', 'url', 'description', 'skills_match', 'experience_match',
                     'location_match', 'salary_match', 'overall_match', 'recommendation', 'why_matches',
                     'gaps', 'status', 'saved_at', 'notes', 'external_id', 'last_seen_at']
                  );
                  data.push(row);
                });
              }
            })
          };
        }
      })
    }
  });

  vm.runInContext(databaseSrc + '\n' + jobsSrc, ctx);

  const postings = Array.from({length: 500}, (_, i) => ({
    externalId: `job_${i}`,
    title: `Job ${i}`,
    url: `http://example.com/job/${i}`
  }));

  const start = performance.now();
  ctx.upsertDiscoveredJobs(postings);
  const end = performance.now();

  return end - start;
}

const time = runBenchmark();
console.log(`Current approach (500 items): ${time.toFixed(2)} ms`);
