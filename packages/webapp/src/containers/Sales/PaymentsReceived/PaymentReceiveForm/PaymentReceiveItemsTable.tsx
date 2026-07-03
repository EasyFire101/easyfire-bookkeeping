import React, { useCallback } from 'react';
import classNames from 'classnames';
import { CloudLoadingIndicator, FormattedMessage as T } from '@/components';
import { useFormikContext } from 'formik';

import { CLASSES } from '@/constants/classes';
import { usePaymentReceiveInnerContext } from './PaymentReceiveInnerProvider';
import { DataTableEditable } from '@/components';
import { usePaymentReceiveEntriesColumns } from './components';
import { compose, updateTableCell } from '@/utils';
import type { PaymentReceiveEntry, PaymentReceiveFormValues } from './utils';

type PaymentReceiveItemsTableProps = {
  entries: PaymentReceiveEntry[];
  onUpdateData: (entries: PaymentReceiveEntry[]) => void;
  currencyCode: string;
};

/**
 * Payment receive items table.
 */
export function PaymentReceiveItemsTable({
  entries,
  onUpdateData,
  currencyCode,
}: PaymentReceiveItemsTableProps) {
  const { isDueInvoicesFetching } = usePaymentReceiveInnerContext();

  const columns = usePaymentReceiveEntriesColumns();

  const {
    values: { customerId },
    errors,
  } = useFormikContext<PaymentReceiveFormValues>();

  const noResultsMessage = customerId ? (
    <T id={'there_is_no_receivable_invoices_for_this_customer'} />
  ) : (
    <T id={'please_select_a_customer_to_display_all_open_invoices_for_it'} />
  );

  const handleUpdateData = useCallback(
    (rowIndex: number, columnId: string, value: unknown) => {
      const newRows = compose(updateTableCell(rowIndex, columnId, value))(
        entries,
      ) as PaymentReceiveEntry[];

      onUpdateData(newRows);
    },
    [entries, onUpdateData],
  );

  return (
    <CloudLoadingIndicator isLoading={isDueInvoicesFetching}>
      {/* @ts-expect-error DataTableEditable is untyped and infers required actions/name props that are unused at runtime */}
      <DataTableEditable
        progressBarLoading={isDueInvoicesFetching}
        className={classNames(CLASSES.DATATABLE_EDITOR_ITEMS_ENTRIES)}
        columns={columns}
        data={entries}
        spinnerProps={false}
        payload={{
          errors:
            (errors as { entries?: unknown[] } | undefined)?.entries || [],
          updateData: handleUpdateData,
          currencyCode,
        }}
        noResults={noResultsMessage}
      />
    </CloudLoadingIndicator>
  );
}
