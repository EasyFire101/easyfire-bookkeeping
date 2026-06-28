import React from 'react';
import { DataTable, TableSkeletonRows, Card } from '@/components';
import { useLocatedLandedCostColumns, ActionsMenu } from './components';
import { useBillDrawerContext } from './BillDrawerProvider';
import type { BillLandedCostTransaction } from '@bigcapital/sdk-ts';
import {
  withAlertActions,
  WithAlertActionsProps,
} from '@/containers/Alert/withAlertActions';
import {
  withDrawerActions,
  WithDrawerActionsProps,
} from '@/containers/Drawer/withDrawerActions';
import { TableStyle } from '@/constants';
import { compose } from '@/utils';
import { DRAWERS } from '@/constants/drawers';

interface LocatedLandedCostTableInnerProps
  extends WithAlertActionsProps,
    WithDrawerActionsProps {}

/**
 * Located landed cost table.
 */
function LocatedLandedCostTableInner({
  // #withAlertActions
  openAlert,

  // #withDrawerActions
  openDrawer,
}: LocatedLandedCostTableInnerProps) {
  // Located landed cost table columns.
  const columns = useLocatedLandedCostColumns();

  // Bill drawer context.
  const { transactions } = useBillDrawerContext();

  // Handle the transaction delete action.
  const handleDeleteTransaction = ({ id }: { id: number }) => {
    openAlert('bill-located-cost-delete', { BillId: id });
  };

  // Handle from transaction link click.
  const handleFromTransactionClick = (
    original: Pick<
      BillLandedCostTransaction,
      'fromTransactionType' | 'fromTransactionId'
    >,
  ) => {
    const { fromTransactionType, fromTransactionId } = original;

    switch (fromTransactionType) {
      case 'Expense':
        openDrawer(DRAWERS.EXPENSE_DETAILS, { expenseId: fromTransactionId });
        break;

      case 'Bill':
      default:
        openDrawer(DRAWERS.BILL_DETAILS, { billId: fromTransactionId });
        break;
    }
  };

  return (
    <div>
      <Card>
        <DataTable
          columns={columns}
          data={transactions}
          ContextMenu={ActionsMenu}
          TableLoadingRenderer={TableSkeletonRows}
          styleName={TableStyle.Constrant}
          payload={{
            onDelete: handleDeleteTransaction,
            onFromTranscationClick: handleFromTransactionClick,
          }}
        />
      </Card>
    </div>
  );
}

export const LocatedLandedCostTable = compose(
  withAlertActions,
  withDrawerActions,
)(LocatedLandedCostTableInner);
