import { isEqual } from 'lodash';
import { createDeepEqualSelector } from '@/utils';
import { paginationLocationQuery } from '@/store/selectors';
import { defaultTableQuery } from './expenses.reducer';
import { createSelector } from 'reselect';
import type { RootState } from '@/store/reducers';

// Items table state selectors.
const expensesTableStateSelector = (state: RootState) => state.expenses.tableState;

// Retrive expenses table query.
export const getExpensesTableStateFactory = () =>
  createDeepEqualSelector(
    paginationLocationQuery,
    expensesTableStateSelector,
    (locationQuery, tableState) => {
      return {
        ...locationQuery,
        ...tableState,
      };
    },
  );

export const expensesTableStateChangedFactory = () =>
  createDeepEqualSelector(expensesTableStateSelector, (tableState) => {
    return !isEqual(tableState, defaultTableQuery);
  });

export const getExpensesSelectedRowsFactory = () =>
  createSelector(
    (state: RootState) => state.expenses.selectedRows,
    (selectedRows) => selectedRows,
  );

// Stub: the expenses slice doesn't store entities by id; this returns null.
// Kept to support legacy HOC consumers without changing their call sites.
export const getExpenseByIdFactory = () =>
  createSelector(
    (_state: RootState, props: { expenseId?: number | string }) => props?.expenseId,
    (_expenseId): unknown => null,
  );
