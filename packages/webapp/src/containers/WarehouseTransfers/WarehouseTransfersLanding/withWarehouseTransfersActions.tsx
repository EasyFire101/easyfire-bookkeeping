import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import type { TableQuery } from '@/store/store.types';
import {
  setWarehouseTransferTableState,
  resetWarehouseTransferTableState,
} from '@/store/warehouse-transfer/warehouse-transfer.actions';

export interface WithWarehouseTransfersActionsProps {
  setWarehouseTransferTableState: (queries: Partial<TableQuery>) => void;
  resetWarehouseTransferTableState: () => void;
}

export const mapDipatchToProps = (dispatch: Dispatch): WithWarehouseTransfersActionsProps => ({
  setWarehouseTransferTableState: (queries: Partial<TableQuery>) =>
    dispatch(setWarehouseTransferTableState(queries)),
  resetWarehouseTransferTableState: () =>
    dispatch(resetWarehouseTransferTableState()),
});

export const withWarehouseTransfersActions = connect(null, mapDipatchToProps);
