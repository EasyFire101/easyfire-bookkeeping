// @ts-nocheck
import React from 'react';
import moment from 'moment';
import intl from 'react-intl-universal';
import { omit, pick, first, sumBy } from 'lodash';
import { useFormikContext } from 'formik';
import { Intent } from '@blueprintjs/core';
import { AppToaster } from '@/components';
import { usePaymentReceiveFormContext } from './PaymentReceiveFormProvider';
import {
  defaultFastFieldShouldUpdate,
  transformToForm,
  safeSumBy,
  orderingLinesIndexes,
  formattedAmount,
} from '@/utils';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import {
  transformAttachmentsToForm,
  transformAttachmentsToRequest,
} from '@/containers/Attachments/utils';
import { convertBrandingTemplatesToOptions } from '@/containers/BrandingTemplates/BrandingTemplatesSelectFields';

// Default payment receive entry.
export const defaultPaymentReceiveEntry = {
  index: '',
  paymentAmount: '',
  invoiceId: '',
  invoiceNo: '',
  dueAmount: '',
  date: '',
  amount: '',
  currencyCode: '',
};

// Form initial values.
export const defaultPaymentReceive = {
  customerId: '',
  depositAccountId: '',
  paymentDate: moment(new Date()).format('YYYY-MM-DD'),
  referenceNo: '',
  paymentReceiveNo: '',
  // Holds the payment number that entered manually only.
  paymentReceiveNoManually: '',
  statement: '',
  amount: '',
  currencyCode: '',
  exchangeRate: 1,
  entries: [],
  attachments: [],
  branchId: '',
  pdfTemplateId: '',
};

export const defaultRequestPaymentEntry = {
  index: '',
  paymentAmount: '',
  invoiceId: '',
};

export const defaultRequestPayment = {
  customerId: '',
  depositAccountId: '',
  paymentDate: '',
  paymentReceiveNo: '',
  branchId: '',
  statement: '',
  entries: [],
};

/**
 * Transformes the edit payment receive to initial values of the form.
 */
export const transformToEditForm = (paymentReceive, paymentReceiveEntries) => ({
  ...transformToForm(paymentReceive, defaultPaymentReceive),
  entries: [
    ...paymentReceiveEntries.map((paymentReceiveEntry) => ({
      ...transformToForm(paymentReceiveEntry, defaultPaymentReceiveEntry),
      paymentAmount: paymentReceiveEntry.paymentAmount || '',
    })),
  ],
  attachments: transformAttachmentsToForm(paymentReceive),
});

/**
 * Transformes the given invoices to the new page receivable entries.
 */
export const transformInvoicesNewPageEntries = (invoices) => [
  ...invoices.map((invoice, index) => ({
    index: index + 1,
    invoiceId: invoice.id,
    entryType: 'invoice',
    dueAmount: invoice.due_amount,
    date: invoice.invoice_date,
    amount: invoice.balance,
    currencyCode: invoice.currency_code,
    paymentAmount: '',
    invoiceNo: invoice.invoice_no,
    branchId: invoice.branch_id,
    totalPaymentAmount: invoice.payment_amount,
  })),
];

export const transformEntriesToEditForm = (receivableEntries) => [
  ...transformInvoicesNewPageEntries([...(receivableEntries || [])]),
];

export const clearAllPaymentEntries = (entries) => [
  ...entries.map((entry) => ({ ...entry, paymentAmount: 0 })),
];

export const amountPaymentEntries = (amount, entries) => {
  let total = amount;

  return entries.map((item) => {
    const diff = Math.min(item.dueAmount, total);
    total -= Math.max(diff, 0);

    return {
      ...item,
      paymentAmount: diff,
    };
  });
};

export const fullAmountPaymentEntries = (entries) => {
  return entries.map((item) => ({
    ...item,
    paymentAmount: item.dueAmount,
  }));
};

/**
 * Detarmines the customers fast-field should update.
 */
export const customersFieldShouldUpdate = (newProps, oldProps) => {
  return (
    newProps.shouldUpdateDeps.items !== oldProps.shouldUpdateDeps.items ||
    defaultFastFieldShouldUpdate(newProps, oldProps)
  );
};

/**
 * Detarmines the accounts fast-field should update.
 */
export const accountsFieldShouldUpdate = (newProps, oldProps) => {
  return (
    newProps.items !== oldProps.items ||
    defaultFastFieldShouldUpdate(newProps, oldProps)
  );
};

/**
 * Tranformes form values to request.
 */
export const transformFormToRequest = (form) => {
  // Filters entries that have no `invoiceId` and `paymentAmount`.
  const entries = form.entries
    .filter((entry) => entry.invoiceId && entry.paymentAmount)
    .map((entry) => ({
      ...pick(entry, Object.keys(defaultRequestPaymentEntry)),
    }));

  const attachments = transformAttachmentsToRequest(form);

  return {
    ...omit(form, ['paymentReceiveNoManually', 'paymentReceiveNo']),
    // The `paymentReceiveNoManually` will be presented just if the auto-increment
    // is disable, always both attributes hold the same value in manual mode.
    ...(form.paymentReceiveNoManually && {
      paymentReceiveNo: form.paymentReceiveNo,
    }),
    entries: orderingLinesIndexes(entries),
    attachments,
  };
};

export const useSetPrimaryBranchToForm = () => {
  const { setFieldValue } = useFormikContext();
  const { branches, isBranchesSuccess, isNewMode } =
    usePaymentReceiveFormContext();

  React.useEffect(() => {
    if (isBranchesSuccess && isNewMode) {
      const primaryBranch = branches.find((b) => b.primary) || first(branches);

      if (primaryBranch) {
        setFieldValue('branchId', primaryBranch.id);
      }
    }
  }, [isBranchesSuccess, setFieldValue, branches, isNewMode]);
};

/**
 * Transformes the response errors types.
 */
export const transformErrors = (errors, { setFieldError }) => {
  const getError = (errorType) => errors.find((e) => e.type === errorType);

  if (getError('PAYMENT_RECEIVE_NO_EXISTS')) {
    setFieldError(
      'paymentReceiveNo',
      intl.get('payment_number_is_not_unique'),
    );
  }
  if (getError('PAYMENT_RECEIVE_NO_REQUIRED')) {
    setFieldError(
      'paymentReceiveNo',
      intl.get('payment_received.field.error.payment_receive_no_required'),
    );
  }
  if (getError('PAYMENT_ACCOUNT_CURRENCY_INVALID')) {
    AppToaster.show({
      message: intl.get(
        'payment_Receive.error.payment_account_currency_invalid',
      ),
      intent: Intent.DANGER,
    });
  }
};

/**
 * Retreives the payment receive totals.
 */
export const usePaymentReceiveTotals = () => {
  const {
    values: { entries, currencyCode },
  } = useFormikContext();

  // Retrieves the invoice entries total.
  const total = React.useMemo(
    () => sumBy(entries, 'paymentAmount'),
    [entries],
  );

  // Retrieves the formatted total money.
  const formattedTotal = React.useMemo(
    () => formattedAmount(total, currencyCode),
    [total, currencyCode],
  );
  // Retrieves the formatted subtotal.
  const formattedSubtotal = React.useMemo(
    () => formattedAmount(total, currencyCode, { money: false }),
    [total, currencyCode],
  );

  return {
    total,
    formattedTotal,
    formattedSubtotal,
  };
};

export const usePaymentReceivedTotalAppliedAmount = () => {
  const {
    values: { entries },
  } = useFormikContext();

  // Retrieves the invoice entries total.
  return React.useMemo(() => sumBy(entries, 'paymentAmount'), [entries]);
};

export const usePaymentReceivedTotalAmount = () => {
  const {
    values: { amount },
  } = useFormikContext();

  return amount;
};

export const usePaymentReceivedTotalExceededAmount = () => {
  const totalAmount = usePaymentReceivedTotalAmount();
  const totalApplied = usePaymentReceivedTotalAppliedAmount();

  return Math.abs(totalAmount - totalApplied);
};

/**
 * Detarmines whether the payment has foreign customer.
 * @returns {boolean}
 */
export const useEstimateIsForeignCustomer = () => {
  const { values } = useFormikContext();
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const isForeignCustomer = React.useMemo(
    () => values.currencyCode !== baseCurrency,
    [values.currencyCode, baseCurrency],
  );
  return isForeignCustomer;
};

export const resetFormState = ({ initialValues, values, resetForm }) => {
  resetForm({
    values: {
      // Reset the all values except the brand id.
      ...initialValues,
      brandId: values.brandId,
    },
  });
};

export const getExceededAmountFromValues = (values) => {
  const totalApplied = sumBy(values.entries, 'paymentAmount');
  const totalAmount = values.amount;

  return totalAmount - totalApplied;
};

export const usePaymentReceivedFormBrandingTemplatesOptions = () => {
  const { brandingTemplates } = usePaymentReceiveFormContext();

  return React.useMemo(
    () => convertBrandingTemplatesToOptions(brandingTemplates),
    [brandingTemplates],
  );
};
