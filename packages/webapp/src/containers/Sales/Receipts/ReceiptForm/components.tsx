import React, { useRef } from 'react';
import intl from 'react-intl-universal';
import { Button } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { ExchangeRateInputGroup } from '@/components';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { useReceiptIsForeignCustomer, useReceiptTotal } from './utils';
import { useUpdateEffect } from '@/hooks';
import { transactionNumber } from '@/utils';
import { withSettings } from '@/containers/Settings/withSettings';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import {
  useSyncExRateToForm,
  withExchangeRateFetchingLoading,
  withExchangeRateItemEntriesPriceRecalc,
} from '@/containers/Entries/withExRateItemEntriesPriceRecalc';
import { compose } from '@/utils';
import { DialogsName } from '@/constants/dialogs';
import type { ReceiptFormValues } from './utils';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';

type ReceiptExchangeRateInputFieldRootProps = React.ComponentProps<
  typeof ExchangeRateInputGroup
>;

/**
 * Receipt exchange rate input field.
 * @returns {JSX.Element}
 */
const ReceiptExchangeRateInputFieldRoot = ({
  ...props
}: ReceiptExchangeRateInputFieldRootProps) => {
  const baseCurrency = useCurrentOrganizationBaseCurrency();
  const { values } = useFormikContext<ReceiptFormValues>();
  const isForeignCustomer = useReceiptIsForeignCustomer();

  // Can't continue if the customer is not foreign.
  if (!isForeignCustomer) {
    return null;
  }
  return (
    <ExchangeRateInputGroup
      {...props}
      name={'exchangeRate'}
      fromCurrency={values.currencyCode}
      toCurrency={baseCurrency ?? ''}
      formGroupProps={{ label: ' ', inline: true }}
      withPopoverRecalcConfirm
    />
  );
};

export const ReceiptExchangeRateInputField = compose(
  withExchangeRateFetchingLoading,
  withExchangeRateItemEntriesPriceRecalc,
)(ReceiptExchangeRateInputFieldRoot);

/**
 * Receipt project select.
 * @returns {JSX.Element}
 */
export function ReceiptProjectSelectButton({ label }: { label?: string }) {
  return <Button text={label ?? intl.get('select_project')} />;
}

type ReceiptSyncIncrementSettingsToFormProps = {
  receiptAutoIncrement?: boolean;
  receiptNextNumber?: number;
  receiptNumberPrefix?: string;
};

/**
 * Syncs receipt auto-increment settings to form.
 * @return {React.ReactNode}
 */
export const ReceiptSyncIncrementSettingsToForm = compose(
  withSettings(({ receiptSettings }) => ({
    receiptAutoIncrement: receiptSettings?.autoIncrement,
    receiptNextNumber: receiptSettings?.nextNumber,
    receiptNumberPrefix: receiptSettings?.numberPrefix,
  })),
)(({
  receiptAutoIncrement,
  receiptNextNumber,
  receiptNumberPrefix,
}: ReceiptSyncIncrementSettingsToFormProps) => {
  const { setFieldValue } = useFormikContext<ReceiptFormValues>();

  useUpdateEffect(() => {
    // Do not update if the receipt auto-increment mode is disabled.
    if (!receiptAutoIncrement) return;

    setFieldValue(
      'receiptNumber',
      transactionNumber(receiptNumberPrefix, receiptNextNumber),
    );
  }, [
    setFieldValue,
    receiptNumberPrefix,
    receiptAutoIncrement,
    receiptNextNumber,
  ]);

  return null;
});

type ReceiptSyncAutoExRateToFormProps = {
  openDialog: WithDialogActionsProps['openDialog'];
};

/**
 * Syncs the auto exchange rate to the receipt form and shows up popup to user
 * as an indication the entries rates have been changed.
 * @returns {React.ReactNode}
 */
export const ReceiptSyncAutoExRateToForm = compose(withDialogActions)(({
  openDialog,
}: ReceiptSyncAutoExRateToFormProps) => {
  const total = useReceiptTotal();
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useSyncExRateToForm({
    onSynced: () => {
      // If the total bigger then zero show alert to the user after adjusting entries.
      if (total > 0) {
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => {
          openDialog(DialogsName.InvoiceExchangeRateChangeNotice);
        }, 500);
      }
    },
  });
  return null;
});
