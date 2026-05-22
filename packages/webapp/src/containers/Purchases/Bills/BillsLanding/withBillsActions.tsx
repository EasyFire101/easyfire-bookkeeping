import { ComponentType } from 'react';
import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import {
  setBillsTableState,
  resetBillsTableState,
  setBillsSelectedRows,
} from '@/store/bills/bills.actions';
import type { RootState } from '@/store/reducers';
import type { TableQuery } from '@/store/store.types';

export interface WithBillsActionsProps {
  setBillsTableState: (queries: Partial<TableQuery>) => void;
  resetBillsTableState: () => void;
  setBillsSelectedRows: (selectedRows: Array<unknown>) => void;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithBillsActionsProps => ({
  setBillsTableState: (queries) => dispatch(setBillsTableState(queries)),
  resetBillsTableState: () => dispatch(resetBillsTableState()),
  setBillsSelectedRows: (selectedRows) =>
    dispatch(setBillsSelectedRows(selectedRows)),
});

export const withBillsActions = connect(null, mapDispatchToProps);
