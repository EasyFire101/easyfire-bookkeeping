import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleARAgingSummaryFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithARAgingSummaryActionsProps {
  toggleARAgingSummaryFilterDrawer: (toggle?: boolean) => void;
}

const mapActionsToProps = (
  dispatch: Dispatch,
): WithARAgingSummaryActionsProps => ({
  toggleARAgingSummaryFilterDrawer: (toggle) =>
    dispatch(toggleARAgingSummaryFilterDrawer(toggle)),
});

export const withARAgingSummaryActions = connect(null, mapActionsToProps);
