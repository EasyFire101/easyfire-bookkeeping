import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleVendorsBalanceSummaryFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithVendorsBalanceSummaryActionsProps {
  toggleVendorSummaryFilterDrawer: (toggle: boolean) => void;
}

export const mapActionsToProps = (dispatch: Dispatch): WithVendorsBalanceSummaryActionsProps => ({
  toggleVendorSummaryFilterDrawer: (toggle: boolean) =>
    dispatch(toggleVendorsBalanceSummaryFilterDrawer(toggle)),
});

export const withVendorsBalanceSummaryActions = connect(null, mapActionsToProps);
