import React, { useEffect, useRef } from 'react';
import { useFormikContext } from 'formik';
import { ExchangeRateInputGroup } from '@/components';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import {
  useCreditNoteIsForeignCustomer,
  useCreditNoteSubtotal,
  type CreditNoteFormValues,
} from './utils';
import { withSettings } from '@/containers/Settings/withSettings';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import { transactionNumber, compose } from '@/utils';
import {
  useSyncExRateToForm,
  withExchangeRateFetchingLoading,
  withExchangeRateItemEntriesPriceRecalc,
} from '@/containers/Entries/withExRateItemEntriesPriceRecalc';
import { DialogsName } from '@/constants/dialogs';

type CreditNoteExchangeRateInputFieldRootProps = React.ComponentProps<
  typeof ExchangeRateInputGroup
>;

/**
 * Credit note exchange rate input field.
 */
const CreditNoteExchangeRateInputFieldRoot = ({
  ...props
}: CreditNoteExchangeRateInputFieldRootProps) => {
  const baseCurrency = useCurrentOrganizationBaseCurrency();
  const { values } = useFormikContext<CreditNoteFormValues>();
  const isForeignCustomer = useCreditNoteIsForeignCustomer();

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

export const CreditNoteExchangeRateInputField = compose(
  withExchangeRateFetchingLoading,
  withExchangeRateItemEntriesPriceRecalc,
)(CreditNoteExchangeRateInputFieldRoot);

type CreditNoteSyncIncrementSettingsProps = {
  creditAutoIncrement?: boolean;
  creditNextNumber?: number;
  creditNumberPrefix?: string;
};

/**
 * Syncs credit note auto-increment settings to form.
 */
export const CreditNoteSyncIncrementSettingsToForm = compose(
  withSettings(({ creditNoteSettings }) => ({
    creditAutoIncrement: creditNoteSettings?.autoIncrement,
    creditNextNumber: creditNoteSettings?.nextNumber,
    creditNumberPrefix: creditNoteSettings?.numberPrefix,
  })),
)(({
  creditAutoIncrement,
  creditNextNumber,
  creditNumberPrefix,
}: CreditNoteSyncIncrementSettingsProps) => {
  const { setFieldValue } = useFormikContext<CreditNoteFormValues>();

  useEffect(() => {
    // Do not update if the credit note auto-increment mode is disabled.
    if (!creditAutoIncrement) return;

    setFieldValue(
      'creditNoteNumber',
      transactionNumber(creditNumberPrefix, creditNextNumber),
    );
  }, [
    setFieldValue,
    creditNumberPrefix,
    creditNextNumber,
    creditAutoIncrement,
  ]);

  return null;
});

type CreditNoteExchangeRateSyncProps = {
  openDialog: WithDialogActionsProps['openDialog'];
};

/**
 * Syncs the realtime exchange rate to the credit note form and shows up popup to the user
 * as an indication the entries rates have been re-calculated.
 */
export const CreditNoteExchangeRateSync = compose(withDialogActions)(({
  openDialog,
}: CreditNoteExchangeRateSyncProps) => {
  const subtotal = useCreditNoteSubtotal();
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useSyncExRateToForm({
    onSynced: () => {
      // If the total bigger then zero show alert to the user after adjusting entries.
      if (subtotal > 0) {
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => {
          openDialog(DialogsName.InvoiceExchangeRateChangeNotice);
        }, 500);
      }
    },
  });
  return null;
});
