import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleCustomersTransactionsFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithCustomersTransactionsActionsProps {
  toggleCustomersTransactionsFilterDrawer: (toggle?: boolean) => void;
}

const mapActionsToProps = (
  dispatch: Dispatch,
): WithCustomersTransactionsActionsProps => ({
  toggleCustomersTransactionsFilterDrawer: (toggle) =>
    dispatch(toggleCustomersTransactionsFilterDrawer(toggle)),
});

export const withCustomersTransactionsActions = connect(
  null,
  mapActionsToProps,
);
