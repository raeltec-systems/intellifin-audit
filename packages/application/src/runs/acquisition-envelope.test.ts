import { describe, expect, it } from 'vitest';
import { POPULATION_LIMITS, decodePopulationUtf8, parsePopulationCsv, utf8Bytes } from '@intellifin/domain';
import { decodeAcquisitionEnvelope, encodeAcquisitionEnvelope } from './acquisition-envelope.js';

describe('bounded acquisition envelope', () => {
  it('round-trips the maximum raw snapshot and parses a maximum-size CSV cell', () => {
    const text = `value\n${'x'.repeat(POPULATION_LIMITS.bytes - 7)}\n`;
    const bytes = utf8Bytes(text);
    expect(bytes.length).toBe(POPULATION_LIMITS.bytes);
    const envelope = encodeAcquisitionEnvelope({ bytes, mediaType: 'text/csv', declaration: null });
    const recovered = decodeAcquisitionEnvelope(envelope);
    expect(recovered.bytes.length).toBe(bytes.length);
    expect(recovered.bytes.every((byte, index) => byte === bytes[index])).toBe(true);
    const cell = parsePopulationCsv(text)[0]?.['value'];
    expect(typeof cell).toBe('string');
    expect((cell as string).length).toBe(POPULATION_LIMITS.bytes - 7);
  }, 30_000);
  it.each(['bad\0value','bad\ud800value'])('preserves bytes when a declaration cannot be canonicalized', invalid => {
    const bytes = utf8Bytes('id\n1\n');
    const envelope = encodeAcquisitionEnvelope({ bytes, mediaType: 'text/csv', declaration: { source: invalid } });
    expect(decodeAcquisitionEnvelope(envelope)).toEqual({ bytes, mediaType: 'text/csv', declaration: null });
    expect(JSON.parse(decodePopulationUtf8(envelope)).rejectedDeclarationJson).toBe(JSON.stringify({ source: invalid }));
  });
  it.each(['0','gg','00ffzz','AA'])('refuses malformed hex without regexp expansion: %s', rawHex => {
    expect(()=>decodeAcquisitionEnvelope(utf8Bytes(JSON.stringify({schemaVersion:1,rawHex,mediaType:'text/csv',declaration:null})))).toThrow();
  });
});
