import { describe, expect, it } from 'vitest';
import { runSelfTest, samplePdf } from '@main/selfTest';

describe('packaged-app self-test', () => {
  it('builds a valid sample PDF', () => {
    const pdf = new TextDecoder().decode(samplePdf('Hello (world)'));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    expect(pdf).toContain('(Hello \\(world\\))');
  });

  it('passes every check in Node', async () => {
    const r = await runSelfTest();
    expect(r.lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(4);
  });
});
