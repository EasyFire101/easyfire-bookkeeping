import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import type { TableQuery } from '@/store/store.types';
import {
  setPaymentMadesTableState,
  resetPaymentMadesTableState,
} from '@/store/payment-mades/payment-mades.actions';

export interface WithPaymentMadeActionsProps {
  setPaymentMadesTableState: (state: Partial<TableQuery>) => void;
  resetPaymentMadesTableState: () => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithPaymentMadeActionsProps => ({
  setPaymentMadesTableState: (state: Partial<TableQuery>) =>
    dispatch(setPaymentMadesTableState(state)),

  resetPaymentMadesTableState: () => dispatch(resetPaymentMadesTableState()),
});
export const withPaymentMadeActions = connect(null, mapDispatchToProps);
