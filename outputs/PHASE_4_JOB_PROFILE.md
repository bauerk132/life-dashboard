# Life Dashboard — Phase 4 Job Profile

## Status and authority

This is the user-approved job-search profile for Phase 4 planning. Profile identifier:

`phase4-job-profile-v1-2026-09-11`

This file controls deterministic source queries and hard filters for the scheduled job-discovery pipeline. It does not authorize Phase 4 implementation, authentication, source calls, deployment, live-data changes, or Phase 5 AI scoring.

If an attached current résumé conflicts with this profile, Claude must preserve the résumé as the source of truth for the user's actual qualifications and must not invent experience, skills, education, certifications, metrics, or job history. The explicit search preferences and exclusions in this file still control which jobs are included.

## Employment sources

- Include LinkedIn-published and Indeed-published employment listings only.
- Use the existing subscribed JSearch/RapidAPI provider contract as the single technical adapter.
- Validate LinkedIn-published results first. Enable Indeed-published results through the same pipeline only after the LinkedIn path passes the Phase 4 acceptance gate.
- Do not add Craigslist, Zillow, Redfin, Remotive, USAJOBS, Adzuna, or another source in Phase 4.
- Do not schedule the undocumented LinkedIn guest endpoint from the older local program.

## Target-role priorities

### Priority 1 — primary IT support track

1. IT support / help desk
2. Desktop support
3. Technical support

Relevant title synonyms may include:

- IT Support Specialist
- IT Support Technician
- Help Desk Technician
- Help Desk Analyst
- Service Desk Technician
- Service Desk Analyst
- Desktop Support Technician
- Desktop Support Specialist
- Desktop Support Analyst
- Technical Support Specialist
- Technical Support Technician
- Technical Support Representative
- Technical Support Agent
- End User Support Specialist
- User Support Technician
- PC Support Technician
- Field Support Technician only when driving and heavy travel are not required

### Priority 2 — transferable coordination and administration track

4. Office administration
5. Operations coordinator
6. Logistics coordinator

Relevant title synonyms may include:

- Office Administrator
- Administrative Coordinator
- Administrative Assistant
- Office Coordinator
- Operations Coordinator
- Operations Support Specialist
- Operations Assistant
- Logistics Coordinator
- Logistics Support Specialist
- Dispatch or transportation roles only when driving is not a job duty and the position is not sales

### Priority 3 — non-sales customer support track

7. Customer support / store support
8. Customer success agent

Relevant title synonyms may include:

- Customer Support Representative
- Customer Support Specialist
- Customer Service Representative
- Customer Service Specialist
- Customer Care Representative
- Customer Success Agent
- Customer Success Representative
- Client Support Specialist
- Member Support Representative
- Store Support Specialist

Customer support and customer success roles must be excluded when the actual duties are primarily sales, account expansion, lead generation, business development, commission generation, cold calling, or quota-carrying revenue work.

## Geography and work arrangement

- Search center: Downtown Pittsburgh, Pennsylvania.
- On-site and hybrid jobs must be located less than 8 miles from Downtown Pittsburgh.
- Do not store or require the user's home address. Use a public Downtown Pittsburgh reference point for deterministic distance calculations.
- Remote is preferred.
- Hybrid and on-site work are also acceptable when they satisfy the distance rule.
- Work arrangement is a ranking preference, not a hard exclusion, except for the geographic limit on on-site and hybrid work.
- Remote jobs must permit work from Pennsylvania. Exclude listings that restrict employment to jurisdictions that do not include Pennsylvania.

## Compensation

- Minimum hourly base compensation: USD 19.00 per hour.
- Minimum annual base compensation: USD 38,000 per year.
- Use the hourly threshold for jobs represented primarily as hourly work.
- Use the annual threshold for jobs represented primarily as salaried work.
- Do not combine commission, tips, bonuses, overtime, equity, or speculative incentives with base compensation to satisfy the floor.

When a source provides compensation:

- Preserve the source-provided minimum, maximum, currency, pay period, and whether the value is publisher/employer supplied.
- Include a job when the source-provided minimum meets the applicable floor.
- Exclude a job when the entire source-provided range is below the applicable floor.
- Include and flag `COMPENSATION_RANGE_STRADDLES_MINIMUM` when a listed range crosses the applicable floor.
- Do not silently convert hourly and annual values unless the conversion basis is explicit and recorded.

When a listing has no source-provided salary:

- Include it.
- Mark the source salary as unavailable.
- If a deterministic estimate is available, store it separately from source-provided compensation and label it clearly as an estimate.
- Record the estimate basis, version, date, and confidence or uncertainty category.
- Never present an estimate as employer-provided compensation.
- Do not reject a job solely because an estimate is missing or falls below the floor. Estimated compensation is a review aid, not a Phase 4 hard filter.

## Employment types

Include:

- Full-time
- Contract-to-hire

Exclude unless the listing explicitly indicates a full-time or contract-to-hire conversion:

- Part-time
- Temporary
- Seasonal
- Internship
- Volunteer
- Contract-only engagements with no stated path to hire

If the source employment type is missing or ambiguous, include the job with `EMPLOYMENT_TYPE_REVIEW_REQUIRED` rather than guessing.

## Seniority and stretch-role default

The user did not set a narrower seniority boundary, so Phase 4 should use this conservative default:

- Include entry-level, associate, and mid-level individual-contributor roles.
- Include coordinator, specialist, technician, representative, agent, analyst, and support titles when the duties align with a target track.
- Include reasonable stretch roles for review when the listing is not clearly senior leadership and does not contain a hard exclusion.
- Do not claim the user satisfies a requirement merely because the listing was included.
- Exclude director, vice president, executive, head-of-function, and clearly senior leadership roles.
- Manager titles are not globally excluded, but General Manager and Kitchen Manager are hard exclusions below.

Phase 5 may score résumé fit later; Phase 4 must not perform AI scoring or fabricate qualifications.

## Hard exclusions

Reject listings whose title or substantive duties establish any of the following:

1. Sales of any kind, including direct sales, inside sales, outside sales, retail sales, commission sales, account executive, business development, lead generation, telemarketing, canvassing, or quota-carrying revenue work.
2. General Manager.
3. Kitchen Manager.
4. Heavy or frequent travel.
5. Required relocation.
6. Driving as a regular or essential job duty.
7. Delivery, route, courier, chauffeur, commercial-driver, or field roles whose core duty is driving.

Interpretation rules:

- A normal commute is not “driving as a job duty.”
- An incidental phrase such as “occasional travel” should be flagged for review unless the listing quantifies it as heavy or frequent.
- Exclude a listing when it requires a driver's license specifically because regular driving is an essential duty.
- Do not exclude an otherwise suitable desk-based position merely because a generic employer template mentions reliable transportation, unless the actual duties require driving.
- Non-sales customer support is allowed. A “customer success” title is not enough by itself; inspect duties for expansion, upselling, renewals quotas, or revenue ownership.
- Every rejection must retain an explainable reason code and the profile identifier.

Recommended reason codes:

- `EXCLUDED_SALES_ROLE`
- `EXCLUDED_GENERAL_MANAGER`
- `EXCLUDED_KITCHEN_MANAGER`
- `EXCLUDED_HEAVY_TRAVEL`
- `EXCLUDED_RELOCATION`
- `EXCLUDED_DRIVING_DUTY`
- `EXCLUDED_OUTSIDE_RADIUS`
- `EXCLUDED_REMOTE_NOT_AVAILABLE_IN_PA`
- `EXCLUDED_COMPENSATION_BELOW_MINIMUM`
- `EXCLUDED_EMPLOYMENT_TYPE`
- `EXCLUDED_SENIOR_LEADERSHIP`

## Résumé handling

- The user will include the current résumé with the Claude Phase 4 task.
- Prefer the résumé version most closely aligned with IT support and help-desk work.
- If multiple versions are supplied, Claude must identify which one it used.
- Use the résumé only to derive truthful skills, qualifications, and query synonyms.
- Do not add unsupported qualifications.
- Do not copy the full résumé, home address, phone number, email address, or other personal details into Sheets, Script Properties, source requests, logs, fixtures, or handoffs.
- Do not send résumé text to JSearch/RapidAPI. Source queries should contain only bounded job titles, location, remote preference, and other non-sensitive search parameters required by the provider.
- Phase 4 may create deterministic skill/query configuration from verified résumé facts, but résumé-to-job AI scoring belongs to Phase 5 and remains unauthorized.

## Schedule

- Run every morning at 7:00 a.m. in `America/New_York`.
- Include weekends.
- The scheduling system must remain correct across Eastern daylight-saving transitions by using the named time zone rather than a fixed UTC offset.
- Manual and scheduled runs must share the same lock, checkpoint, quota, filtering, and deduplication protections.
- Creation or verification of a live trigger requires the separately gated Phase 4 authorization.

## Match threshold

- The strong-match review threshold is 80%.
- The 80% threshold is intended to support a transition out of the user's current industry.
- It is not a Phase 4 source-ingestion cutoff.
- Phase 4 must first apply deterministic source, geography, employment-type, compensation, and hard-exclusion rules.
- AI résumé matching and score calibration are Phase 5 work and remain unauthorized.

## Open profile assumptions

These defaults were selected to avoid blocking profile creation. The user may revise them before authorizing Phase 4:

- Entry through mid-level individual-contributor roles are included.
- Reasonable stretch roles are included for review.
- The 7:00 a.m. schedule runs every day, including weekends.
- “Customer store support” is represented as customer support and store-support roles, with every sales-oriented role excluded.

Claude must not silently expand the profile beyond these assumptions.

## User attachment checklist

When starting the Claude Phase 4 task, the user should attach:

1. This profile file.
2. `outputs/CLAUDE_PHASE_4_CONTROLLED_HANDOFF.md`.
3. The current résumé, preferably the IT-support-oriented version.
4. Access to the project folder.

The user should not paste or send API keys, passwords, cookies, OAuth tokens, recovery codes, Sheet IDs, or Apps Script project IDs in chat. Authentication and exact private live-test targets must be handled through the approved secure environment.

**PHASE COMPLETE OR PAUSED. DO NOT GO FORWARD TO THE NEXT PHASE WITHOUT THE USER'S EXPLICIT PERMISSION.**
