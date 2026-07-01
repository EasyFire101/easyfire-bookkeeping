import React from 'react';
import '@/style/pages/VendorsCreditNote/List.scss';
import { DashboardPageContent } from '@/components';
import { VendorsCreditNoteActionsBar } from './VendorsCreditNoteActionsBar';
import { VendorsCreditNoteDataTable } from './VendorsCreditNoteDataTable';
import { withVendorsCreditNotes } from './withVendorsCreditNotes';
import type { WithVendorsCreditNotesProps } from './withVendorsCreditNotes';
import { withVendorsCreditNotesActions } from './withVendorsCreditNotesActions';
import { VendorsCreditNoteListProvider } from './VendorsCreditNoteListProvider';
import { VendorsCreditNotesListDrawers } from './VendorsCreditNotesListDrawers';
import { VendorsCreditNotesListDialogs } from './VendorsCreditNotesListDialogs';
import { transformTableStateToQuery, compose } from '@/utils';

interface WithVendorsCreditNotesActionsProps {
  resetVendorsCreditNoteTableState: () => void;
}

interface VendorsCreditNotesListProps
  extends Pick<
    WithVendorsCreditNotesProps,
    'vendorsCreditNoteTableState' | 'vendorsCreditNoteTableStateChanged'
  >,
    WithVendorsCreditNotesActionsProps {}

function VendorsCreditNotesListInner({
  vendorsCreditNoteTableState,
  vendorsCreditNoteTableStateChanged,
  resetVendorsCreditNoteTableState,
}: VendorsCreditNotesListProps) {
  React.useEffect(
    () => () => {
      resetVendorsCreditNoteTableState();
    },
    [resetVendorsCreditNoteTableState],
  );

  return (
    <VendorsCreditNoteListProvider
      query={transformTableStateToQuery(vendorsCreditNoteTableState)}
      tableStateChanged={vendorsCreditNoteTableStateChanged}
    >
      <VendorsCreditNoteActionsBar />
      <VendorsCreditNotesListDrawers />
      <VendorsCreditNotesListDialogs />

      <DashboardPageContent>
        <VendorsCreditNoteDataTable />
      </DashboardPageContent>
    </VendorsCreditNoteListProvider>
  );
}

export const VendorsCreditNotesList = compose(
  withVendorsCreditNotesActions,
  withVendorsCreditNotes(
    ({ vendorsCreditNoteTableState, vendorsCreditNoteTableStateChanged }) => ({
      vendorsCreditNoteTableState,
      vendorsCreditNoteTableStateChanged,
    }),
  ),
)(VendorsCreditNotesListInner);
