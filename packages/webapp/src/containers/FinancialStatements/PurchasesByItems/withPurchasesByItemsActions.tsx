import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { togglePurchasesByItemsFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithPurchasesByItemsActionsProps {
  togglePurchasesByItemsFilterDrawer: (toggle?: boolean) => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithPurchasesByItemsActionsProps => ({
  togglePurchasesByItemsFilterDrawer: (toggle?: boolean) =>
    dispatch(togglePurchasesByItemsFilterDrawer(toggle)),
});

export const withPurchasesByItemsActions = connect(null, mapDispatchToProps);
