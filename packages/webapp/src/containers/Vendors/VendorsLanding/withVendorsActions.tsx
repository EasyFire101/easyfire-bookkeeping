import { ComponentType } from 'react';
import { Dispatch } from 'redux';
import { connect } from 'react-redux';
import {
  setVendorsTableState,
  resetVendorsTableState,
  setVendorsSelectedRows,
  resetVendorsSelectedRows,
} from '@/store/vendors/vendors.actions';
import type { TableQuery } from '@/store/store.types';

export interface WithVendorsActionsProps {
  setVendorsTableState: (queries: Partial<TableQuery>) => void;
  resetVendorsTableState: () => void;
  setVendorsSelectedRows: (selectedRows: Array<unknown>) => void;
  resetVendorsSelectedRows: () => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithVendorsActionsProps => ({
  setVendorsTableState: (queries) => dispatch(setVendorsTableState(queries)),
  resetVendorsTableState: () => dispatch(resetVendorsTableState()),
  setVendorsSelectedRows: (selectedRows) =>
    dispatch(setVendorsSelectedRows(selectedRows)),
  resetVendorsSelectedRows: () => dispatch(resetVendorsSelectedRows()),
});

export function withVendorsActions<P>(
  WrappedComponent: ComponentType<P>,
): ComponentType<Omit<P, keyof WithVendorsActionsProps>> {
  const Connected = connect(null, mapDispatchToProps)(
    WrappedComponent as ComponentType<any>,
  );
  return Connected as unknown as ComponentType<
    Omit<P, keyof WithVendorsActionsProps>
  >;
}
