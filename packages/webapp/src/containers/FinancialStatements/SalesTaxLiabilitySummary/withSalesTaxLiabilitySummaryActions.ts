import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleSalesTaxLiabilitySummaryFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithSalesTaxLiabilitySummaryActionsProps {
  toggleSalesTaxLiabilitySummaryFilterDrawer: (toggle: boolean) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithSalesTaxLiabilitySummaryActionsProps => ({
  toggleSalesTaxLiabilitySummaryFilterDrawer: (toggle: boolean) =>
    dispatch(toggleSalesTaxLiabilitySummaryFilterDrawer(toggle)),
});

export const withSalesTaxLiabilitySummaryActions = connect(null, mapDispatchToProps);
