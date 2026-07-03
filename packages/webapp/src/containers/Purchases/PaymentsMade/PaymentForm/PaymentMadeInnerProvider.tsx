import React, { createContext, useContext, useEffect } from 'react';
import { useFormikContext } from 'formik';
import { usePaymentMadeNewPageEntries } from '@/hooks/query';
import { usePaymentMadeFormContext } from './PaymentMadeFormProvider';
import { transformToNewPageEntries } from './utils';

type BillRow = {
  id?: string | number;
  billId?: string | number;
  dueAmount?: string | number;
  date?: string;
  amount?: string | number;
  currencyCode?: string;
  billNo?: string;
  branchId?: string | number;
  totalPaymentAmount?: string | number;
};

interface PaymentMadeInnerContextValue {
  newPageEntries: BillRow[] | undefined;
  isNewEntriesLoading: boolean;
  isNewEntriesFetching: boolean;
}

const PaymentMadeInnerContext = createContext<
  PaymentMadeInnerContextValue | undefined
>(undefined);

/**
 * Payment made inner form provider.
 */
function PaymentMadeInnerProvider({
  ...props
}: {
  children?: React.ReactNode;
}) {
  // Payment made form context.
  const { isNewMode } = usePaymentMadeFormContext();

  // Formik context.
  // Note: `vendor_id` is destructured to preserve historical runtime behavior;
  // the form values type uses `vendorId` (camelCase), so this reads undefined.
  const {
    values: { vendor_id: vendorId },
    setFieldValue,
  } = useFormikContext<{ vendor_id?: string | number }>();

  // `usePaymentMadeNewPageEntries` manages `enabled` internally based on vendorId.
  const {
    data: newPageEntries,
    isLoading: isNewEntriesLoading,
    isFetching: isNewEntriesFetching,
  } = usePaymentMadeNewPageEntries(vendorId as number | undefined);

  useEffect(() => {
    if (!isNewEntriesFetching && newPageEntries && isNewMode) {
      setFieldValue(
        'entries',
        transformToNewPageEntries(newPageEntries as BillRow[]),
      );
    }
  }, [isNewEntriesFetching, newPageEntries, isNewMode, setFieldValue]);

  const provider: PaymentMadeInnerContextValue = {
    newPageEntries: newPageEntries as BillRow[] | undefined,
    isNewEntriesLoading,
    isNewEntriesFetching,
  };

  return <PaymentMadeInnerContext.Provider value={provider} {...props} />;
}

const usePaymentMadeInnerContext = (): PaymentMadeInnerContextValue => {
  const ctx = useContext(PaymentMadeInnerContext);
  if (!ctx) {
    throw new Error(
      'usePaymentMadeInnerContext must be used within a PaymentMadeInnerProvider',
    );
  }
  return ctx;
};

export { PaymentMadeInnerProvider, usePaymentMadeInnerContext };
