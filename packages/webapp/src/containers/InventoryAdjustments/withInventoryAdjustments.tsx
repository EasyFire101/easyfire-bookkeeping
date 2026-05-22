import { connect } from 'react-redux';
import { getInventroyAdjsTableStateFactory } from '@/store/inventory-adjustments/inventory-adjustment.selector';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithInventoryAdjustmentsProps {
  inventoryAdjustmentTableState: ReturnType<ReturnType<typeof getInventroyAdjsTableStateFactory>>;
  inventoryAdjustmentsSelectedRows: unknown[];
}

export const withInventoryAdjustments = <
  Props extends { location?: { search: string } },
>(
  mapState?: MapState<WithInventoryAdjustmentsProps, Props>,
) => {
  const getInventoryAdjustmentTableState = getInventroyAdjsTableStateFactory();

  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithInventoryAdjustmentsProps = {
      inventoryAdjustmentTableState: getInventoryAdjustmentTableState(
        state,
        props,
      ),
      inventoryAdjustmentsSelectedRows: state.inventoryAdjustments.selectedRows,
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };
  return connect(mapStateToProps);
};
