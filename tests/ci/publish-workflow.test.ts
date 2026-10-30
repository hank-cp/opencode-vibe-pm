/**
 * Publish workflow contract — npm Trusted Publishing (OIDC)
 *
 * CI publishing must go through OIDC: a long-lived npm token expires (90-day
 * cap) and the registry then answers the publish request with a misleading
 * `E404` instead of `401`. npm CLI >= 11.5.1 is required for OIDC support.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface PublishWorkflow {
  readonly permissions?: { readonly 'id-token'?: string };
  readonly jobs?: {
    readonly publish?: {
      readonly steps?: readonly {
        readonly name?: string;
        readonly run?: string;
        readonly env?: Readonly<Record<string, string>>;
      }[];
    };
  };
}

const workflowPath = path.join(import.meta.dir, '../../.github/workflows/publish.yml');
const raw = fs.readFileSync(workflowPath, 'utf-8');
const workflow = Bun.YAML.parse(raw) as PublishWorkflow;

describe('publish workflow', () => {
  it('requests an OIDC token for trusted publishing', () => {
    expect(workflow.permissions?.['id-token']).toBe('write');
  });

  it('does not publish with a long-lived npm token', () => {
    expect(raw).not.toContain('secrets.NPM_TOKEN');

    for (const step of workflow.jobs?.publish?.steps ?? []) {
      expect(step.env?.NODE_AUTH_TOKEN).toBeUndefined();
    }
  });

  it('publishes with an npm CLI that supports OIDC (>= 11.5.1)', () => {
    const publishStep = workflow.jobs?.publish?.steps?.find((step) => step.run?.includes('npm publish'));
    expect(publishStep).toBeDefined();

    const spec = publishStep?.run?.match(/--package npm@\^?(\d+)\.(\d+)\.(\d+)/);
    expect(spec).not.toBeNull();
    if (!spec) return;

    const [major = 0, minor = 0, patch = 0] = spec.slice(1).map(Number);
    const supportsOidc =
      major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
    expect(supportsOidc).toBe(true);
  });
});
