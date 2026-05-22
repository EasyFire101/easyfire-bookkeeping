import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import type { TableQuery } from '@/store/store.types';
import {
  setCreditNoteTableState,
  resetCreditNoteTableState,
  setCreditNotesSelectedRows,
} from '@/store/credit-note/credit-note.actions';

export interface WithCreditNotesActionsProps {
  setCreditNotesTableState: (queries: Partial<TableQuery>) => void;
  resetCreditNotesTableState: () => void;
  setCreditNotesSelectedRows: (selectedRows: Array<unknown>) => void;
}

export const mapDipatchToProps = (dispatch: Dispatch): WithCreditNotesActionsProps => ({
  setCreditNotesTableState: (queries: Partial<TableQuery>) =>
    dispatch(setCreditNoteTableState(queries)),
  resetCreditNotesTableState: () => dispatch(resetCreditNoteTableState()),
  setCreditNotesSelectedRows: (selectedRows: Array<unknown>) =>
    dispatch(setCreditNotesSelectedRows(selectedRows)),
});

export const withCreditNotesActions = connect(null, mapDipatchToProps);
