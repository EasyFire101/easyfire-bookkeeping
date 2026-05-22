import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleBalanceSheetFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithBalanceSheetActionsProps {
  toggleBalanceSheetFilterDrawer: (toggle?: boolean) => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithBalanceSheetActionsProps => ({
  toggleBalanceSheetFilterDrawer: (toggle) =>
    dispatch(toggleBalanceSheetFilterDrawer(toggle)),
});

export const withBalanceSheetActions = connect(null, mapDispatchToProps);
