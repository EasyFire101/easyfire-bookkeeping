import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleProfitLossFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithProfitLossActionsProps {
  toggleProfitLossFilterDrawer: (toggle: boolean) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithProfitLossActionsProps => ({
  toggleProfitLossFilterDrawer: (toggle: boolean) =>
    dispatch(toggleProfitLossFilterDrawer(toggle)),
});

export const withProfitLossActions = connect(null, mapDispatchToProps);
