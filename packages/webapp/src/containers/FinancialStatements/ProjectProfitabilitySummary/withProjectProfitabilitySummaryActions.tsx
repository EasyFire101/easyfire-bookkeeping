import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleProjectProfitabilitySummaryFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithProjectProfitabilitySummaryActionsProps {
  toggleProjectProfitabilitySummaryFilterDrawer: (toggle: boolean) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithProjectProfitabilitySummaryActionsProps => ({
  toggleProjectProfitabilitySummaryFilterDrawer: (toggle: boolean) =>
    dispatch(toggleProjectProfitabilitySummaryFilterDrawer(toggle)),
});

export const withProjectProfitabilitySummaryActions = connect(null, mapDispatchToProps);
