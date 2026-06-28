// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import moment from 'moment';
import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import { omit, get } from 'lodash';

import '@/style/pages/Items/ItemAdjustmentDialog.scss';

import { AppToaster } from '@/components';
import { CreateInventoryAdjustmentFormSchema } from './InventoryAdjustmentForm.schema';

import { InventoryAdjustmentFormContent } from './InventoryAdjustmentFormContent';
import { useInventoryAdjContext } from './InventoryAdjustmentFormProvider';

import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';

const defaultInitialValues = {
  date: moment(new Date()).format('YYYY-MM-DD'),
  type: 'decrement',
  adjustmentAccountId: '',
  itemId: '',
  reason: '',
  cost: '',
  quantity: '',
  referenceNo: '',
  quantityOnHand: '',
  publish: '',
  branchId: '',
  warehouseId: '',
};

/**
 * Inventory adjustment form.
 */
function InventoryAdjustmentFormInner({
  // #withDialogActions
  closeDialog,
}) {
  const { dialogName, item, itemId, submitPayload, createInventoryAdjMutate } =
    useInventoryAdjContext();

  // Initial form values.
  const initialValues = {
    ...defaultInitialValues,
    itemId: itemId,
    quantityOnHand: get(item, 'quantity_on_hand', 0),
  };

  // Handles the form submit.
  const handleFormSubmit = (values, { setSubmitting, setErrors }) => {
    const form = {
      ...omit(values, ['quantityOnHand', 'newQuantity', 'action']),
      publish: submitPayload.publish,
    };
    setSubmitting(true);
    createInventoryAdjMutate(form)
      .then(() => {
        closeDialog(dialogName);

        AppToaster.show({
          message: intl.get(
            'the_adjustment_transaction_has_been_created_successfully',
          ),
          intent: Intent.SUCCESS,
        });
      })
      .finally(() => {
        setSubmitting(true);
      });
  };

  return (
    <Formik
      validationSchema={CreateInventoryAdjustmentFormSchema}
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
    >
      <InventoryAdjustmentFormContent />
    </Formik>
  );
}

export const InventoryAdjustmentForm = compose(withDialogActions)(
  InventoryAdjustmentFormInner,
);
