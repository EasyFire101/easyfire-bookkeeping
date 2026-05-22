import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import type { TableQuery } from '@/store/store.types';
import {
  setVendorCreditTableState,
  resetVendorCreditTableState,
  setVendorCreditsSelectedRows,
} from '@/store/vendor-credit/vendor-credit.actions';

export interface WithVendorsCreditNotesActionsProps {
  setVendorsCreditNoteTableState: (queries: Partial<TableQuery>) => void;
  resetVendorsCreditNoteTableState: () => void;
  setVendorsCreditNoteSelectedRows: (selectedRows: Array<unknown>) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithVendorsCreditNotesActionsProps => ({
  setVendorsCreditNoteTableState: (queries: Partial<TableQuery>) =>
    dispatch(setVendorCreditTableState(queries)),
  resetVendorsCreditNoteTableState: () =>
    dispatch(resetVendorCreditTableState()),
  setVendorsCreditNoteSelectedRows: (selectedRows: Array<unknown>) =>
    dispatch(setVendorCreditsSelectedRows(selectedRows)),
});

export const withVendorsCreditNotesActions = connect(null, mapDispatchToProps);
