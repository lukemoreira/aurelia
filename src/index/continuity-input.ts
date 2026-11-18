// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ContinuityInput } from '@/domain/continuity'
import type { WorkspaceData } from '@/domain/workspace-data'
import type { WorkspaceIndex } from './workspace-index'

/**
 * What the continuity model of one book reads: the workspace, plus who is named in each scene and its
 * broken links, from the index. One definition for the app and the assistant server, so both find the
 * same findings.
 */
export const continuityInput = (
  data: WorkspaceData,
  index: Pick<WorkspaceIndex, 'foundNames' | 'linksTo'>,
  bookId: string,
): ContinuityInput => ({
  data,
  bookId,
  named: (id) =>
    index
      .foundNames(id)
      .filter((n) => n.target.kind === 'record')
      .map((n) => n.target.id),
  brokenLinks: (id) =>
    index
      .linksTo(id)
      .filter((l) => l.status !== 'ok')
      .map((l) => ({ text: l.text, status: l.status as 'missing' | 'ambiguous' })),
})
