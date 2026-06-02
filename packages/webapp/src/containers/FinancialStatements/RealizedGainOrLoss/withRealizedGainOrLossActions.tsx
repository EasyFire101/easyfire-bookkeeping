import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleRealizedGainOrLossFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithRealizedGainOrLossActionsProps {
  toggleRealizedGainOrLossFilterDrawer: (toggle?: boolean) => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithRealizedGainOrLossActionsProps => ({
  toggleRealizedGainOrLossFilterDrawer: (toggle?: boolean) =>
    dispatch(toggleRealizedGainOrLossFilterDrawer(toggle)),
});

export const withRealizedGainOrLossActions = connect(null, mapDispatchToProps);
