import { canonicalJson, decodePopulationUtf8, POPULATION_LIMITS, utf8Bytes, type JsonValue } from '@intellifin/domain';
import { PopulationAcquisitionError } from './execution-ports.js';

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/** Bounded chunks avoid arrays or regexp captures for every byte of a large snapshot. */
export function encodeAcquisitionEnvelope(acquired: { bytes: Uint8Array; mediaType: string; declaration: unknown }): Uint8Array {
  if (acquired.bytes.length > POPULATION_LIMITS.bytes) throw new PopulationAcquisitionError('contract');
  const chunks: string[] = [];
  for (let offset = 0; offset < acquired.bytes.length; offset += 4096) {
    const part: string[] = [];
    for (let index = offset; index < Math.min(offset + 4096, acquired.bytes.length); index++) part.push(HEX[acquired.bytes[index]!]!);
    chunks.push(part.join(''));
  }
  let declaration = (acquired.declaration ?? null) as JsonValue;
  let rejectedDeclarationJson: string | null = null;
  try { canonicalJson(declaration); }
  catch {
    // JSON's escaped string preserves malformed declaration content in object storage,
    // while null makes reconciliation fail without sending invalid text to PostgreSQL.
    try { rejectedDeclarationJson = JSON.stringify(acquired.declaration) ?? null; } catch { /* not a JSON declaration */ }
    declaration = null;
  }
  return utf8Bytes(canonicalJson({ schemaVersion: 1, rawHex: chunks.join(''), mediaType: acquired.mediaType, declaration,
    ...(rejectedDeclarationJson === null ? {} : { rejectedDeclarationJson }) }));
}

export function decodeAcquisitionEnvelope(envelope: Uint8Array): { bytes: Uint8Array; mediaType: string; declaration: unknown } {
  try {
    const value = JSON.parse(decodePopulationUtf8(envelope, 40 * 1024 * 1024)) as Record<string, unknown>;
    if (!value || value['schemaVersion'] !== 1 || typeof value['rawHex'] !== 'string' || typeof value['mediaType'] !== 'string') throw new Error();
    const hex = value['rawHex'];
    if (hex.length % 2 !== 0 || hex.length > 2 * POPULATION_LIMITS.bytes) throw new Error();
    const bytes = new Uint8Array(hex.length / 2);
    const digit = (code: number) => code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1;
    for (let index = 0; index < bytes.length; index++) {
      const high = digit(hex.charCodeAt(index * 2)), low = digit(hex.charCodeAt(index * 2 + 1));
      if (high < 0 || low < 0) throw new Error();
      bytes[index] = high * 16 + low;
    }
    return { bytes, mediaType: value['mediaType'], declaration: value['declaration'] };
  } catch { throw new PopulationAcquisitionError('integrity'); }
}
