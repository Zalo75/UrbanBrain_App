import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const routeSource = fs.readFileSync(path.join(process.cwd(), 'src/app/api/chat/route.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('V2 physical response flow', () => {
  it('keeps the V2 branch on neutral rendering and out of legacy composition', () => {
    const neutralStart = routeSource.indexOf('answer = renderValidatedClaimsNeutral');
    expect(neutralStart).toBeGreaterThan(-1);
    const responseBranch = routeSource.slice(routeSource.lastIndexOf('if (validation.validClaims.length === 0)', neutralStart));
    const postValidationEnd = responseBranch.indexOf("traceAnswerStage(requestId, expedienteId, 'post-validation'");
    const directBranch = responseBranch.slice(0, postValidationEnd);

    expect(directBranch).toContain('renderValidatedClaimsNeutral');
    expect(directBranch).not.toContain('composeSemanticAnswer');
    expect(directBranch).not.toContain('parameterFallback');
  });

  it('uses a V2-local technical fallback when no claims validate', () => {
    expect(routeSource).toContain("if (v2Entry) {");
    expect(routeSource).toContain('buildV2TechnicalFallback()');
    expect(routeSource).toContain('buildV2TechnicalFallback()');
  });

  it('builds the V2 context and user prompt directly from the single V2 entry', () => {
    expect(routeSource).toContain('let v2Entry = Boolean(v2Layer);');
    expect(routeSource).toContain('v2Entry = usedV2 && v2Candidates.length > 0;');
    expect(routeSource).toContain('if (v2Entry) {\n      const classification');
    expect(routeSource).toContain('userPrompt: v2Entry\n');
  });
});
