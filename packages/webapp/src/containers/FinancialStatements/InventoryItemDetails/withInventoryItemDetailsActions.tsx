import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { toggleInventoryItemDetailsFilterDrawer } from '@/store/financial-statement/financial-statements.actions';

export interface WithInventoryItemDetailsActionsProps {
  toggleInventoryItemDetailsFilterDrawer: (toggle?: boolean) => void;
}

const mapActionsToProps = (
  dispatch: Dispatch,
): WithInventoryItemDetailsActionsProps => ({
  toggleInventoryItemDetailsFilterDrawer: (toggle) =>
    dispatch(toggleInventoryItemDetailsFilterDrawer(toggle)),
});

export const withInventoryItemDetailsActions = connect(null, mapActionsToProps);
