import { expect, it } from 'vitest';

import { runFolderName } from '../src/storage/run-folder';

it('names run folders by sortable local date and time', () => {
  expect(runFolderName(new Date(2026, 9, 3, 1, 4, 5))).toBe('2026-10-03_010405');
  expect(runFolderName(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31_235959');
});
