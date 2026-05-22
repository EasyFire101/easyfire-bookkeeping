import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleCustomersBalanceSummaryFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithCustomersBalanceSummaryActionsProps {
  toggleCustomerBalanceFilterDrawer: (toggle?: boolean) => void;
}

const mapActionsToProps = (
  dispatch: Dispatch,
): WithCustomersBalanceSummaryActionsProps => ({
  toggleCustomerBalanceFilterDrawer: (toggle) =>
    dispatch(toggleCustomersBalanceSummaryFilterDrawer(toggle)),
});

export const withCustomersBalanceSummaryActions = connect(
  null,
  mapActionsToProps,
);
