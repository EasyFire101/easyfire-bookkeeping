import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleAPAgingSummaryFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithAPAgingSummaryActionsProps {
  toggleAPAgingSummaryFilterDrawer: (toggle?: boolean) => void;
}

const mapActionsToProps = (
  dispatch: Dispatch,
): WithAPAgingSummaryActionsProps => ({
  toggleAPAgingSummaryFilterDrawer: (toggle) =>
    dispatch(toggleAPAgingSummaryFilterDrawer(toggle)),
});

export const withAPAgingSummaryActions = connect(null, mapActionsToProps);
