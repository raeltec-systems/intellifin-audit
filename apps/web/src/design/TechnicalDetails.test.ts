import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TECHNICAL_DETAILS_LABEL, TechnicalDetails } from './TechnicalDetails';

describe('the technical details disclosure', () => {
  it('is a native details element, closed, labelled with the one label', () => {
    const html = renderToStaticMarkup(
      React.createElement(TechnicalDetails, {
        items: [
          { label: 'Run identifier', value: '01a0b465-a21d-7fba-acbd-fc2abf4ea3e7', mono: true },
          { label: 'Read at', value: '2026-09-21T12:24:45.656Z', mono: true },
        ],
      }),
    );
    expect(html).toContain('<details class="ls-disclosure ls-technical">');
    expect(html).not.toContain(' open');
    expect(html).toContain(`<summary>${TECHNICAL_DETAILS_LABEL}</summary>`);
    expect(html).toContain('<dt>Run identifier</dt><dd class="ls-mono">01a0b465-a21d-7fba-acbd-fc2abf4ea3e7</dd>');
  });

  it('renders no empty list when it is given children alone', () => {
    const html = renderToStaticMarkup(
      React.createElement(TechnicalDetails, null, React.createElement('p', null, 'Only prose.')),
    );
    expect(html).not.toContain('<dl');
    expect(html).toContain('<p>Only prose.</p>');
  });
});
