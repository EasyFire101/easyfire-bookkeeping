// @ts-nocheck
import React from 'react';
import moment from 'moment';
import intl from 'react-intl-universal';
import * as R from 'ramda';
import { first, chain } from 'lodash';
import { Intent } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import { AppToaster } from '@/components';
import {
  defaultFastFieldShouldUpdate,
  transformToForm,
  repeatValue,
  orderingLinesIndexes,
  formattedAmount,
  toSafeNumber,
} from '@/utils';
import {
  updateItemsEntriesTotal,
  ensureEntriesHaveEmptyLine,
  assignEntriesTaxAmount,
  aggregateItemEntriesTaxRates,
} from '@/containers/Entries/utils';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import {
  isLandedCostDisabled,
  getEntriesTotal,
} from '@/containers/Entries/utils';
import { useBillFormContext } from './BillFormProvider';
import { TaxType } from '@/interfaces/TaxRates';
import {
  transformAttachmentsToForm,
  transformAttachmentsToRequest,
} from '@/containers/Attachments/utils';

export const MIN_LINES_NUMBER = 1;

// Default bill entry.
export const defaultBillEntry = {
  index: 0,
  itemId: '',
  rate: '',
  discount: '',
  quantity: '',
  description: '',
  amount: '',
  landedCost: false,
  taxRateId: '',
  taxRate: '',
  taxAmount: '',
};

// Default bill.
export const defaultBill = {
  vendorId: '',
  billNumber: '',
  billDate: moment(new Date()).format('YYYY-MM-DD'),
  dueDate: moment(new Date()).format('YYYY-MM-DD'),
  referenceNo: '',
  inclusiveExclusiveTax: TaxType.Inclusive,
  note: '',
  open: '',
  branchId: '',
  warehouseId: '',
  exchangeRate: 1,
  currencyCode: '',
  entries: [...repeatValue(defaultBillEntry, MIN_LINES_NUMBER)],
  attachments: [],

  // Adjustment
  adjustment: '',

  // Discount
  discount: '',
  discountType: 'amount',
};

export const ERRORS = {
  // Bills
  BILL_NUMBER_EXISTS: 'BILL.NUMBER.EXISTS',
  ENTRIES_ALLOCATED_COST_COULD_NOT_DELETED:
    'ENTRIES_ALLOCATED_COST_COULD_NOT_DELETED',
  BILL_AMOUNT_SMALLER_THAN_PAID_AMOUNT: 'BILL_AMOUNT_SMALLER_THAN_PAID_AMOUNT',
};
/**
 * Transformes the bill to initial values of edit form.
 */
export const transformToEditForm = (bill) => {
  const initialEntries = [
    ...bill.entries.map((entry) => ({
      ...transformToForm(entry, defaultBillEntry),
      landedCostDisabled: isLandedCostDisabled(entry.item),
    })),
    ...repeatValue(
      defaultBillEntry,
      Math.max(MIN_LINES_NUMBER - bill.entries.length, 0),
    ),
  ];
  const entries = R.compose(
    ensureEntriesHaveEmptyLine(defaultBillEntry),
    updateItemsEntriesTotal,
  )(initialEntries);

  const attachments = transformAttachmentsToForm(bill);

  return {
    ...transformToForm(bill, defaultBill),
    inclusiveExclusiveTax: bill.isInclusiveTax
      ? TaxType.Inclusive
      : TaxType.Exclusive,
    entries,
    attachments,
  };
};

/**
 * Transformes bill entries to submit request.
 */
export const transformEntriesToSubmit = (entries) => {
  const transformBillEntry = R.compose(
    R.omit(['amount']),
    R.curry(transformToForm)(R.__, defaultBillEntry),
  );
  return R.compose(orderingLinesIndexes, R.map(transformBillEntry))(entries);
};

/**
 * Filters the givne non-zero entries.
 */
export const filterNonZeroEntries = (entries) => {
  return entries.filter((item) => item.itemId && item.quantity);
};

/**
 * Transformes form values to request body.
 */
export const transformFormValuesToRequest = (values) => {
  const entries = filterNonZeroEntries(values.entries);
  const attachments = transformAttachmentsToRequest(values);

  return {
    ...values,
    entries: transformEntriesToSubmit(entries),
    open: false,
    attachments,
  };
};

/**
 * Handle delete errors.
 */
export const handleDeleteErrors = (errors) => {
  if (
    errors.find((error) => error.type === 'BILL_HAS_ASSOCIATED_PAYMENT_ENTRIES')
  ) {
    AppToaster.show({
      message: intl.get('cannot_delete_bill_that_has_payment_transactions'),
      intent: Intent.DANGER,
    });
  }
  if (
    errors.find((error) => error.type === 'BILL_HAS_ASSOCIATED_LANDED_COSTS')
  ) {
    AppToaster.show({
      message: intl.get(
        'cannot_delete_bill_that_has_associated_landed_cost_transactions',
      ),
      intent: Intent.DANGER,
    });
  }
  if (
    errors.find((error) => error.type === 'BILL_HAS_APPLIED_TO_VENDOR_CREDIT')
  ) {
    AppToaster.show({
      message: intl.get(
        'bills.error.you_couldn_t_delete_bill_has_reconciled_with_vendor_credit',
      ),
      intent: Intent.DANGER,
    });
  }
};

/**
 * Detarmines vendors fast field should update
 */
export const vendorsFieldShouldUpdate = (newProps, oldProps) => {
  return (
    newProps.shouldUpdateDeps.items !== oldProps.shouldUpdateDeps.items ||
    defaultFastFieldShouldUpdate(newProps, oldProps)
  );
};

/**
 * Detarmines entries fast field should update.
 */
export const entriesFieldShouldUpdate = (newProps, oldProps) => {
  return (
    newProps.items !== oldProps.items ||
    defaultFastFieldShouldUpdate(newProps, oldProps)
  );
};

// Transform response error to fields.
export const handleErrors = (errors, { setErrors }) => {
  if (errors.some((e) => e.type === ERRORS.BILL_NUMBER_EXISTS)) {
    setErrors({
      billNumber: intl.get('bill_number_exists'),
    });
  }
  if (
    errors.some(
      (e) => e.type === ERRORS.ENTRIES_ALLOCATED_COST_COULD_NOT_DELETED,
    )
  ) {
    setErrors(
      AppToaster.show({
        intent: Intent.DANGER,
        message: 'ENTRIES_ALLOCATED_COST_COULD_NOT_DELETED',
      }),
    );
  }
  if (
    errors.some((e) => e.type === ERRORS.BILL_AMOUNT_SMALLER_THAN_PAID_AMOUNT)
  ) {
    AppToaster.show({
      intent: Intent.DANGER,
      message: intl.get('bill.total_smaller_than_paid_amount'),
    });
  }
};

export const useSetPrimaryBranchToForm = () => {
  const { setFieldValue } = useFormikContext();
  const { branches, isBranchesSuccess, isNewMode } = useBillFormContext();

  React.useEffect(() => {
    if (isBranchesSuccess && isNewMode) {
      const primaryBranch = branches.find((b) => b.primary) || first(branches);

      if (primaryBranch) {
        setFieldValue('branchId', primaryBranch.id);
      }
    }
  }, [isBranchesSuccess, setFieldValue, branches, isNewMode]);
};

export const useSetPrimaryWarehouseToForm = () => {
  const { setFieldValue } = useFormikContext();
  const { warehouses, isWarehousesSuccess, isNewMode } = useBillFormContext();

  React.useEffect(() => {
    if (isWarehousesSuccess && isNewMode) {
      const primaryWarehouse =
        warehouses.find((b) => b.primary) || first(warehouses);

      if (primaryWarehouse) {
        setFieldValue('warehouseId', primaryWarehouse.id);
      }
    }
  }, [isWarehousesSuccess, setFieldValue, warehouses, isNewMode]);
};

/**
 * Detarmines whether the bill has foreign customer.
 * @returns {boolean}
 */
export const useBillIsForeignCustomer = () => {
  const { values } = useFormikContext();
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const isForeignCustomer = React.useMemo(
    () => values.currencyCode !== baseCurrency,
    [values.currencyCode, baseCurrency],
  );
  return isForeignCustomer;
};

/**
 * Re-calculates the entries tax amount when editing.
 * @returns {string}
 */
export const composeEntriesOnEditInclusiveTax = (
  inclusiveExclusiveTax: string,
  entries,
) => {
  return R.compose(
    assignEntriesTaxAmount(inclusiveExclusiveTax === 'inclusive'),
  )(entries);
};

/**
 * Retreives the bill aggregated tax rates.
 * @returns {Array}
 */
export const useBillAggregatedTaxRates = () => {
  const { values } = useFormikContext();
  const { taxRates } = useBillFormContext();

  const aggregateTaxRates = React.useMemo(
    () => aggregateItemEntriesTaxRates(values.currencyCode, taxRates),
    [values.currencyCode, taxRates],
  );
  // Calculate the total tax amount of bill entries.
  return React.useMemo(() => {
    return aggregateTaxRates(values.entries);
  }, [aggregateTaxRates, values.entries]);
};

/**
 * Retrieves the bill subtotal.
 * @returns {number}
 */
export const useBillSubtotal = () => {
  const {
    values: { entries },
  } = useFormikContext();

  // Calculate the total due amount of bill entries.
  return React.useMemo(() => getEntriesTotal(entries), [entries]);
};

/**
 * Retrieves the bill subtotal formatted.
 * @returns {string}
 */
export const useBillSubtotalFormatted = () => {
  const subtotal = useBillSubtotal();
  const { values } = useFormikContext();

  return formattedAmount(subtotal, values.currencyCode);
};

/**
 * Retrieves the bill discount amount.
 * @returns {number}
 */
export const useBillDiscountAmount = () => {
  const { values } = useFormikContext();
  const subtotal = useBillSubtotal();
  const discount = toSafeNumber(values.discount);

  return values?.discountType === 'percentage'
    ? (subtotal * discount) / 100
    : discount;
};

/**
 * Retrieves the bill discount amount formatted.
 * @returns {string}
 */
export const useBillDiscountAmountFormatted = () => {
  const discountAmount = useBillDiscountAmount();
  const { values } = useFormikContext();

  return formattedAmount(discountAmount, values.currencyCode);
};

/**
 * Retrieves the bill adjustment amount.
 * @returns {number}
 */
export const useBillAdjustmentAmount = () => {
  const { values } = useFormikContext();

  return toSafeNumber(values.adjustment);
};

/**
 * Retrieves the bill adjustment amount formatted.
 * @returns {string}
 */
export const useBillAdjustmentAmountFormatted = () => {
  const adjustmentAmount = useBillAdjustmentAmount();
  const { values } = useFormikContext();

  return formattedAmount(adjustmentAmount, values.currencyCode);
};

/**
 * Retrieves the bill total tax amount.
 * @returns {number}
 */
export const useBillTotalTaxAmount = () => {
  const { values } = useFormikContext();

  return React.useMemo(() => {
    return chain(values.entries)
      .filter((entry) => entry.taxAmount)
      .sumBy('taxAmount')
      .value();
  }, [values.entries]);
};

/**
 * Detarmines whether the tax is exclusive.
 * @returns {boolean}
 */
export const useIsBillTaxExclusive = () => {
  const { values } = useFormikContext();

  return values.inclusiveExclusiveTax === TaxType.Exclusive;
};

/**
 * Retrieves the bill total.
 * @returns {number}
 */
export const useBillTotal = () => {
  const subtotal = useBillSubtotal();
  const totalTaxAmount = useBillTotalTaxAmount();
  const isExclusiveTax = useIsBillTaxExclusive();
  const discountAmount = useBillDiscountAmount();
  const adjustmentAmount = useBillAdjustmentAmount();

  return R.compose(
    R.when(R.always(isExclusiveTax), R.add(totalTaxAmount)),
    R.subtract(R.__, discountAmount),
    R.add(R.__, adjustmentAmount),
  )(subtotal);
};

/**
 * Retrieves the bill total formatted.
 * @returns {string}
 */
export const useBillTotalFormatted = () => {
  const total = useBillTotal();
  const { values } = useFormikContext();

  return formattedAmount(total, values.currencyCode);
};

/**
 * Retrieves the bill paid amount.
 * @returns {number}
 */
export const useBillPaidAmount = () => {
  const { values } = useFormikContext();

  return toSafeNumber(0);
};

/**
 * Retrieves the bill paid amount formatted.
 * @returns {string}
 */
export const useBillPaidAmountFormatted = () => {
  const paidAmount = useBillPaidAmount();
  const { values } = useFormikContext();

  return formattedAmount(paidAmount, values.currencyCode);
};

/**
 * Retrieves the bill due amount.
 * @returns {number}
 */
export const useBillDueAmount = () => {
  const total = useBillTotal();
  const paidAmount = useBillPaidAmount();

  return total - paidAmount;
};

/**
 * Retrieves the bill due amount formatted.
 * @returns {string}
 */
export const useBillDueAmountFormatted = () => {
  const dueAmount = useBillDueAmount();
  const { values } = useFormikContext();

  return formattedAmount(dueAmount, values.currencyCode);
};
