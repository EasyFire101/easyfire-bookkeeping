// @ts-nocheck
import React from 'react';
import '@/style/pages/VendorsCreditNote/List.scss';
import { DashboardPageContent } from '@/components';
import { VendorsCreditNoteActionsBar } from './VendorsCreditNoteActionsBar';
import { VendorsCreditNoteDataTable } from './VendorsCreditNoteDataTable';
import { withVendorsCreditNotes } from './withVendorsCreditNotes';
import { withVendorsCreditNotesActions } from './withVendorsCreditNotesActions';
import { VendorsCreditNoteListProvider } from './VendorsCreditNoteListProvider';
import { VendorsCreditNotesListDrawers } from './VendorsCreditNotesListDrawers';
import { VendorsCreditNotesListDialogs } from './VendorsCreditNotesListDialogs';
import { transformTableStateToQuery, compose } from '@/utils';

function VendorsCreditNotesListInner({
  // #withVendorsCreditNotes
  vendorsCreditNoteTableState,
  vendorsCreditNoteTableStateChanged,

  // #withVendorsCreditNotesActions
  resetVendorsCreditNoteTableState,
}) {
  // Resets the credit note table state once the page unmount.
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
