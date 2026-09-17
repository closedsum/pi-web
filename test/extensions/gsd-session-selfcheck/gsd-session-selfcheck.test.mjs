import assert from "node:assert/strict";
import test from "node:test";

function checkDeployment(checks = {}) {
  const problems = [];
  if (checks.junctionBroken) problems.push("junctions: ~/.gsd junction is broken or missing");
  if (checks.hooksDead) problems.push("hooks: dead registration found");
  if (checks.settingsDrift) problems.push("settings: template drift detected");
  if (checks.reviewerQuorum) problems.push("reviewers: quorum not configured");
  return problems;
}

function formatReport(problems) {
  if (!problems.length) return undefined;
  return {
    inject: `[GSD-SELFCHECK] ${problems.length} deployment problem(s) found at session start:\n${problems.map(p => `- ${p}`).join("\n")}`,
  };
}

test("reports junction problems", () => {
  const problems = checkDeployment({ junctionBroken: true });
  const result = formatReport(problems);
  assert.ok(result?.inject);
  assert.match(result.inject, /GSD-SELFCHECK/);
  assert.match(result.inject, /junction/);
});

test("reports multiple problems", () => {
  const problems = checkDeployment({ junctionBroken: true, hooksDead: true });
  assert.equal(problems.length, 2);
  const result = formatReport(problems);
  assert.match(result.inject, /2 deployment problem/);
});

test("returns undefined when no problems", () => {
  const problems = checkDeployment({});
  assert.equal(formatReport(problems), undefined);
});

test("reports settings drift", () => {
  const problems = checkDeployment({ settingsDrift: true });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /drift/);
});
