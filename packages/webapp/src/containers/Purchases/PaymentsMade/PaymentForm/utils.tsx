// @ts-nocheck
import React from 'react';
import moment from 'moment';
import intl from 'react-intl-universal';
import { pick, first, sumBy } from 'lodash';
import { useFormikContext } from 'formik';
import { Intent } from '@blueprintjs/core';
import { AppToaster } from '@/components';
import { usePaymentMadeFormContext } from './PaymentMadeFormProvider';
import {
  defaultFastFieldShouldUpdate,
  safeSumBy,
  transformToForm,
  orderingLinesIndexes,
  formattedAmount,
} from '@/utils';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { PAYMENT_MADE_ERRORS } from '../constants';
import {
  transformAttachmentsToForm,
  transformAttachmentsToRequest,
} from '@/containers/Attachments/utils';

export const ERRORS = {
  PAYMENT_NUMBER_NOT_UNIQUE: 'PAYMENT.NUMBER.NOT.UNIQUE',
};

// Default payment made entry values.
export const defaultPaymentMadeEntry = {
  billId: '',
  paymentAmount: '',
  currencyCode: '',
  id: null,
  dueAmount: null,
  amount: '',
};

// Default initial values of payment made.
export const defaultPaymentMade = {
  amount: '',
  vendorId: '',
  paymentAccountId: '',
  paymentDate: moment(new Date()).format('YYYY-MM-DD'),
  reference: '',
  paymentNumber: '',
  statement: '',
  currencyCode: '',
  branchId: '',
  exchangeRate: 1,
  entries: [],
  attachments: [],
};

export const transformToEditForm = (paymentMade, paymentMadeEntries) => {
  const attachments = transformAttachmentsToForm(paymentMade);

  return {
    ...transformToForm(paymentMade, defaultPaymentMade),
    entries: [
      ...paymentMadeEntries.map((paymentMadeEntry) => ({
        ...transformToForm(paymentMadeEntry, defaultPaymentMadeEntry),
        paymentAmount: paymentMadeEntry.paymentAmount || '',
      })),
    ],
    attachments,
  };
};

/**
 * Transform the new page entries.
 */
export const transformToNewPageEntries = (entries) => {
  return entries.map((entry) => ({
    ...transformToForm(entry, defaultPaymentMadeEntry),
    paymentAmount: '',
    currencyCode: entry.currency_code,
  }));
};

/**
 * Detarmines vendors fast field when update.
 */
export const vendorsFieldShouldUpdate = (newProps, oldProps) => {
  return (
    newProps.shouldUpdateDeps.items !== oldProps.shouldUpdateDeps.items ||
    defaultFastFieldShouldUpdate(newProps, oldProps)
  );
};

/**
 * Detarmines accounts fast field when update.
 */
export const accountsFieldShouldUpdate = (newProps, oldProps) => {
  return (
    newProps.items !== oldProps.items ||
    defaultFastFieldShouldUpdate(newProps, oldProps)
  );
};

/**
 * Transformes the form values to request body.
 */
export const transformFormToRequest = (form) => {
  // Filters entries that have no `billId` or `paymentAmount`.
  const entries = form.entries
    .filter((item) => item.billId && item.paymentAmount)
    .map((entry) => ({
      ...pick(entry, ['paymentAmount', 'billId']),
    }));

  const attachments = transformAttachmentsToRequest(form);

  return { ...form, entries: orderingLinesIndexes(entries), attachments };
};

export const useSetPrimaryBranchToForm = () => {
  const { setFieldValue } = useFormikContext();
  const { branches, isBranchesSuccess, isNewMode } =
    usePaymentMadeFormContext();

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

  if (getError(PAYMENT_MADE_ERRORS.PAYMENT_NUMBER_NOT_UNIQUE)) {
    setFieldError('paymentNumber', intl.get('payment_number_is_not_unique'));
  }
  if (getError(PAYMENT_MADE_ERRORS.WITHDRAWAL_ACCOUNT_CURRENCY_INVALID)) {
    AppToaster.show({
      message: intl.get(
        'payment_made.error.withdrawal_account_currency_invalid',
      ),
      intent: Intent.DANGER,
    });
  }
};

export const usePaymentMadeTotals = () => {
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

export const usePaymentmadeTotalAmount = () => {
  const {
    values: { amount },
  } = useFormikContext();

  return amount;
};

export const usePaymentMadeAppliedAmount = () => {
  const {
    values: { entries },
  } = useFormikContext();

  // Retrieves the invoice entries total.
  return React.useMemo(() => sumBy(entries, 'paymentAmount'), [entries]);
};

export const usePaymentMadeExcessAmount = () => {
  const appliedAmount = usePaymentMadeAppliedAmount();
  const totalAmount = usePaymentmadeTotalAmount();

  return Math.abs(totalAmount - appliedAmount);
};

/**
 * Detarmines whether the bill has foreign customer.
 * @returns {boolean}
 */
export const usePaymentMadeIsForeignCustomer = () => {
  const { values } = useFormikContext();
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const isForeignCustomer = React.useMemo(
    () => values.currencyCode !== baseCurrency,
    [values.currencyCode, baseCurrency],
  );
  return isForeignCustomer;
};

export const getPaymentExcessAmountFromValues = (values) => {
  const appliedAmount = sumBy(values.entries, 'paymentAmount');
  const totalAmount = values.amount;

  return Math.abs(totalAmount - appliedAmount);
};
