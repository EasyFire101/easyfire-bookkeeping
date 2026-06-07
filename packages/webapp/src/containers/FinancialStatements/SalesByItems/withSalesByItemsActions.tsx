import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleSalesByItemsFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithSalesByItemsActionsProps {
  toggleSalesByItemsFilterDrawer: (toggle?: boolean) => void;
}

export const mapDispatchToProps = (
  dispatch: Dispatch,
): WithSalesByItemsActionsProps => ({
  toggleSalesByItemsFilterDrawer: (toggle?: boolean) =>
    dispatch(toggleSalesByItemsFilterDrawer(toggle)),
});

export const withSalesByItemsActions = connect(null, mapDispatchToProps);
