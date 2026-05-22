import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleTrialBalanceSheetFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithTrialBalanceActionsProps {
  toggleTrialBalanceFilterDrawer: (toggle: boolean) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithTrialBalanceActionsProps => ({
  toggleTrialBalanceFilterDrawer: (toggle: boolean) =>
    dispatch(toggleTrialBalanceSheetFilterDrawer(toggle)),
});

export const withTrialBalanceActions = connect(null, mapDispatchToProps);
