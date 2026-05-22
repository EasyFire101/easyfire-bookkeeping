import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleGeneralLedgerFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithGeneralLedgerActionsProps {
  toggleGeneralLedgerFilterDrawer: (toggle?: boolean) => void;
}

const mapDispatchToProps = (
  dispatch: Dispatch,
): WithGeneralLedgerActionsProps => ({
  toggleGeneralLedgerFilterDrawer: (toggle) =>
    dispatch(toggleGeneralLedgerFilterDrawer(toggle)),
});

export const withGeneralLedgerActions = connect(null, mapDispatchToProps);
