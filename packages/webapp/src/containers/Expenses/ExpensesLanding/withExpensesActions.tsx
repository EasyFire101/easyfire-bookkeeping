import { ComponentType } from 'react';
import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import {
  setExpensesTableState,
  resetExpensesTableState,
  setExpensesSelectedRows,
} from '@/store/expenses/expenses.actions';
import type { RootState } from '@/store/reducers';
import type { TableQuery } from '@/store/store.types';

export interface WithExpensesActionsProps {
  setExpensesTableState: (state: Partial<TableQuery>) => void;
  resetExpensesTableState: () => void;
  setExpensesSelectedRows: (selectedRows: Array<unknown>) => void;
}

const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithExpensesActionsProps => ({
  setExpensesTableState: (state) => dispatch(setExpensesTableState(state)),
  resetExpensesTableState: () => dispatch(resetExpensesTableState()),
  setExpensesSelectedRows: (selectedRows) =>
    dispatch(setExpensesSelectedRows(selectedRows)),
});

export const withExpensesActions = connect(null, mapDispatchToProps);
