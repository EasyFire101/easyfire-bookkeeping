// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import { Formik } from 'formik';
import { omit } from 'lodash';
import React from 'react';
import intl from 'react-intl-universal';
import { CreateQuickPaymentMadeFormSchema } from './QuickPaymentMade.schema';
import { QuickPaymentMadeFormContent } from './QuickPaymentMadeFormContent';
import { useQuickPaymentMadeContext } from './QuickPaymentMadeFormProvider';
import {
  defaultPaymentMade,
  transformBillToForm,
  transformErrors,
} from './utils';
import { AppToaster } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';


/**
 * Quick payment made form.
 */
function QuickPaymentMadeFormInner({
  // #withDialogActions
  closeDialog,
}) {
  const { bill, dialogName, createPaymentMadeMutate } =
    useQuickPaymentMadeContext();

  // Initial form values.
  const initialValues = {
    ...defaultPaymentMade,
    ...transformBillToForm(bill),
  };
  // Handles the form submit.
  const handleFormSubmit = (values, { setSubmitting, setFieldError }) => {
    const entries = [
      {
        payment_amount: values.amount,
        bill_id: values.bill_id,
      },
    ];
    const form = {
      ...omit(values, ['bill_id']),
      entries,
    };

    // Handle request response success.
    const onSuccess = () => {
      AppToaster.show({
        message: intl.get('the_payment_made_has_been_created_successfully'),
        intent: Intent.SUCCESS,
      });
      closeDialog(dialogName);
    };
    // Handle request response errors.
    const onError = ({ data: { errors } }) => {
      if (errors) {
        transformErrors(errors, { setFieldError });
      }
      setSubmitting(false);
    };
    createPaymentMadeMutate(form).then(onSuccess).catch(onError);
  };

  return (
    <Formik
      validationSchema={CreateQuickPaymentMadeFormSchema}
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
      component={QuickPaymentMadeFormContent}
    />
  );
}

export const QuickPaymentMadeForm = compose(withDialogActions)(
  QuickPaymentMadeFormInner,
);
