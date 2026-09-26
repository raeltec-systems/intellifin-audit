import { describe, expect, it } from 'vitest';
import { timelineRequest } from './timeline-request';
const id = '0195A323-0123-7000-8ABC-123456789ABC';
describe('Timeline decision selection', () => {
  it('canonicalizes the selected wait', () => expect(timelineRequest({ wait: id })).toEqual({ cursor: 0, waitId: id.toLowerCase() }));
  it('accepts only an explicit safe cursor or the unselected first page', () => {
    expect(timelineRequest({})).toEqual({ cursor: 0 });
    expect(timelineRequest({ decisionsAfter: '10' })).toEqual({ cursor: 10 });
    expect(timelineRequest({ pauseAfter: '50' })).toEqual({ cursor: 0 });
    expect(timelineRequest({ wait: id, pauseAfter: '50' })).toEqual({ cursor: 0, waitId: id.toLowerCase() });
  });
  it.each([{ wait: ['x', 'y'] }, { wait: 'bad' }, { wait: id, decisionsAfter: '0' }, { decisionsAfter: '-1' },
    { decisionsAfter: ['1', '2'] }, { decisionsAfter: '9007199254740992' }, { decisionsAfter: '1.5' }])('rejects invalid or ambiguous selection %j', query => {
    expect(timelineRequest(query)).toBeNull();
  });
});
