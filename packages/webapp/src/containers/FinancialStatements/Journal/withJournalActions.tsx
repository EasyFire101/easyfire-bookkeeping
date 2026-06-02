import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleJournalSheeetFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithJournalActionsProps {
  toggleJournalSheetFilter: (toggle?: boolean) => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithJournalActionsProps => ({
  toggleJournalSheetFilter: (toggle?: boolean) =>
    dispatch(toggleJournalSheeetFilterDrawer(toggle)),
});

export const withJournalActions = connect(null, mapDispatchToProps);
