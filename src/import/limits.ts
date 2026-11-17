// SPDX-License-Identifier: AGPL-3.0-or-later

/** What an import reads at once: a novel's chapters, not a disk. Past these it says so, in plain words. */
export const MAX_FILES = 2000
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024

export const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

/** A reason the import cannot go on, written for the author. */
export class ImportError extends Error {}

/** Too much to read at once: this stops the whole import (a file that cannot be read only goes in the report). */
export class ImportLimit extends ImportError {}
