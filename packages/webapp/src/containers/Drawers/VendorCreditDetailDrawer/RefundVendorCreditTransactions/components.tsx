import React from 'react';
import intl from 'react-intl-universal';
import { Intent, MenuItem, Menu } from '@blueprintjs/core';
import { Can, FormatDateCell, Icon } from '@/components';
import { safeCallback } from '@/utils';
import { VendorCreditAction, AbilitySubject } from '@/constants/abilityOption';
import type { VendorCreditRefund } from '@bigcapital/sdk-ts';

interface ActionsMenuProps {
  payload: {
    onDelete: (row: { original: VendorCreditRefund }) => void;
  };
  row: { original: VendorCreditRefund };
}

/**
 * Actions menu.
 */
export function ActionsMenu({
  payload: { onDelete },
  row: { original },
}: ActionsMenuProps) {
  return (
    <Menu>
      <Can I={VendorCreditAction.Delete} a={AbilitySubject.VendorCredit}>
        <MenuItem
          icon={<Icon icon="trash-16" iconSize={16} />}
          text={intl.get('delete_transaction')}
          intent={Intent.DANGER}
          onClick={safeCallback(onDelete, original)}
        />
      </Can>
    </Menu>
  );
}

export function useRefundCreditTransactionsTableColumns() {
  return React.useMemo(
    () => [
      {
        Header: intl.get('date'),
        accessor: 'formattedDate',
        Cell: FormatDateCell,
        width: 100,
        className: 'date',
      },
      {
        Header: intl.get('refund_vendor_credit.column.amount'),
        accessor: 'formattedAmount',
        width: 100,
        className: 'amount',
        align: 'right',
      },
      {
        Header: intl.get('refund_vendor_credit.column.withdrawal_account'),
        accessor: (row: VendorCreditRefund) => row.depositAccount?.name,
        width: 100,
        className: 'deposit_account',
      },
      {
        id: 'referenceNo',
        Header: intl.get('reference_no'),
        accessor: 'referenceNo',
        width: 100,
        className: 'reference_no',
        textOverview: true,
      },
    ],
    [],
  );
}
