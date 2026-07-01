import '@/style/pages/ManualJournal/List.scss';

import { DashboardPageContent } from '@/components';
import { transformTableStateToQuery, compose } from '@/utils';

import { ManualJournalsListProvider } from './ManualJournalsListProvider';
import { ManualJournalsDataTable } from './ManualJournalsDataTable';
import { ManualJournalActionsBar as ManualJournalsActionsBar } from './ManualJournalActionsBar';
import { ManualJournalsListDrawers } from './ManualJournalsListDrawers';
import { ManualJournalsListDialogs } from './ManualJournalsListDialogs';
import { withManualJournals } from './withManualJournals';
import type { WithManualJournalsProps } from './withManualJournals';

// The withManualJournals mapper below renames `manualJournalsTableState` →
// `journalsTableState` and `manualJournalTableStateChanged` →
// `journalsTableStateChanged`. Pick<...> can't rename, so re-typing is required.
interface ManualJournalsTableProps {
  journalsTableState: WithManualJournalsProps['manualJournalsTableState'];
  journalsTableStateChanged: WithManualJournalsProps['manualJournalTableStateChanged'];
}

/**
 * Manual journals table.
 */
function ManualJournalsTable({
  // #withManualJournals
  journalsTableState,
  journalsTableStateChanged,
}: ManualJournalsTableProps) {
  return (
    <ManualJournalsListProvider
      query={transformTableStateToQuery(journalsTableState)}
      tableStateChanged={journalsTableStateChanged}
    >
      <ManualJournalsActionsBar />
      <ManualJournalsListDrawers />
      <ManualJournalsListDialogs />

      <DashboardPageContent>
        <ManualJournalsDataTable />
      </DashboardPageContent>
    </ManualJournalsListProvider>
  );
}

export const ManualJournalsList = compose(
  withManualJournals(
    ({ manualJournalsTableState, manualJournalTableStateChanged }) => ({
      journalsTableState: manualJournalsTableState,
      journalsTableStateChanged: manualJournalTableStateChanged,
    }),
  ),
)(ManualJournalsTable);
