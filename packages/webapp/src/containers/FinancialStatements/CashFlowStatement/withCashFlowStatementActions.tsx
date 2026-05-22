import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleCashFlowStatementFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithCashFlowStatementActionsProps {
  toggleCashFlowStatementFilterDrawer: (toggle?: boolean) => void;
}

const mapDispatchToProps = (
  dispatch: Dispatch,
): WithCashFlowStatementActionsProps => ({
  toggleCashFlowStatementFilterDrawer: (toggle) =>
    dispatch(toggleCashFlowStatementFilterDrawer(toggle)),
});

export const withCashFlowStatementActions = connect(null, mapDispatchToProps);
