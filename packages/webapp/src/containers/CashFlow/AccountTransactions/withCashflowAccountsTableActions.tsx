import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import type { TableQuery } from '@/store/store.types';
import {
  setCashflowAccountsTableState,
  resetCashflowAccountsTableState,
} from '@/store/cashflow-accounts/cashflow-accounts.actions';

export interface WithCashflowAccountsTableActionsProps {
  setCashflowAccountsTableState: (queries: Partial<TableQuery>) => void;
  resetCashflowAccountsTableState: () => void;
}

export const mapActionsToProps = (dispatch: Dispatch): WithCashflowAccountsTableActionsProps => ({
  setCashflowAccountsTableState: (queries: Partial<TableQuery>) =>
    dispatch(setCashflowAccountsTableState(queries)),

  resetCashflowAccountsTableState: () =>
    dispatch(resetCashflowAccountsTableState()),
});

export const withCashflowAccountsTableActions = connect(null, mapActionsToProps);
