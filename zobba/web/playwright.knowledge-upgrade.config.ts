import { defineConfig } from '@playwright/test';
import common from './playwright.config';

// Deliberate historical-producer proof, with independently built schema9
// binaries. It owns the same guarded disposable DB as the browser suite.
export default defineConfig({ ...common, testDir: './tests/upgrade' });
