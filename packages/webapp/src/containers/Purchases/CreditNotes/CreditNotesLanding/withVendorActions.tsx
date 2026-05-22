import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import {
  setVendorCreditTableState,
  resetVendorCreditTableState,
} from '@/store/vendor-credit/vendor-credit.actions';
import type { RootState } from '@/store/reducers';
import type { TableQuery } from '@/store/store.types';

export interface WithVendorActionsProps {
  setVendorCreditsTableState: (queries: Partial<TableQuery>) => void;
  resetVendorCreditsTableState: () => void;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithVendorActionsProps => ({
  setVendorCreditsTableState: (queries) =>
    dispatch(setVendorCreditTableState(queries)),
  resetVendorCreditsTableState: () => dispatch(resetVendorCreditTableState()),
});

export const withVendorActions = connect(null, mapDispatchToProps);
