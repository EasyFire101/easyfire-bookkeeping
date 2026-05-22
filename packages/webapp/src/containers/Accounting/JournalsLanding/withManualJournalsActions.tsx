import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import {
  setManualJournalsTableState,
  setManualJournalsSelectedRows,
} from '@/store/manual-journals/manual-journals.actions';
import type { TableQuery } from '@/store/store.types';

export interface WithManualJournalsActionsProps {
  setManualJournalsTableState: (queries: Partial<TableQuery>) => void;
  setManualJournalsSelectedRows: (selectedRows: Array<unknown>) => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithManualJournalsActionsProps => ({
  setManualJournalsTableState: (queries) =>
    dispatch(setManualJournalsTableState(queries)),
  setManualJournalsSelectedRows: (selectedRows) =>
    dispatch(setManualJournalsSelectedRows(selectedRows)),
});

export const withManualJournalsActions = connect(null, mapDispatchToProps);
