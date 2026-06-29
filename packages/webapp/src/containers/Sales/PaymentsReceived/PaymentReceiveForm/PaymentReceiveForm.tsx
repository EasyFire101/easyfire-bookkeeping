import React from 'react';
import { isEmpty, defaultTo } from 'lodash';
import intl from 'react-intl-universal';
import { Formik, Form, type FormikHelpers } from 'formik';
import { useHistory } from 'react-router-dom';
import { Intent } from '@blueprintjs/core';
import { css } from '@emotion/css';
import type {
  CreatePaymentReceivedBody,
  EditPaymentReceivedBody,
} from '@bigcapital/sdk-ts';
import { PaymentReceiveFormHeader as PaymentReceiveHeader } from './PaymentReceiveFormHeader';
import { PaymentReceiveFormBody } from './PaymentReceiveFormBody';
import { PaymentReceiveFormFloatingActions as PaymentReceiveFloatingActions } from './PaymentReceiveFloatingActions';
import { PaymentReceiveFormFooter } from './PaymentReceiveFormFooter';
import { PaymentReceiveFormAlerts } from './PaymentReceiveFormAlerts';
import { PaymentReceiveFormDialogs } from './PaymentReceiveFormDialogs';
import { PaymentReceiveFormTopBar } from './PaymentReceiveFormTopBar';
import { PaymentReceiveInnerProvider } from './PaymentReceiveInnerProvider';
import { withSettings } from '@/containers/Settings/withSettings';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import {
  EditPaymentReceiveFormSchema,
  CreatePaymentReceiveFormSchema,
} from './PaymentReceiveForm.schema';
import { AppToaster } from '@/components';
import { transactionNumber, compose } from '@/utils';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { usePaymentReceiveFormContext } from './PaymentReceiveFormProvider';
import {
  defaultPaymentReceive,
  transformToEditForm,
  transformFormToRequest,
  transformErrors,
  resetFormState,
  getExceededAmountFromValues,
  type PaymentReceiveFormValues,
  type PaymentReceiveErrorResponse,
  type PaymentReceiveEditEntry,
} from './utils';
import { PaymentReceiveSyncIncrementSettingsToForm } from './components';
import { PageForm } from '@/components/PageForm';

type WithDialogActionsProps = {
  openDialog: (name: string, payload?: Record<string, unknown>) => void;
};

type WithSettingsProps = {
  preferredDepositAccount?: number | string;
  paymentReceiveNextNumber?: number;
  paymentReceiveNumberPrefix?: string;
  paymentReceiveAutoIncrement?: boolean;
};

type PaymentReceiveFormRootProps = WithDialogActionsProps & WithSettingsProps;

/**
 * Payment Receive form.
 */
function PaymentReceiveFormRoot({
  preferredDepositAccount,
  paymentReceiveNextNumber,
  paymentReceiveNumberPrefix,
  paymentReceiveAutoIncrement,
  openDialog,
}: PaymentReceiveFormRootProps) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const history = useHistory();

  const {
    isNewMode,
    paymentReceiveEditPage,
    paymentEntriesEditPage,
    paymentReceiveId,
    submitPayload,
    editPaymentReceiveMutate,
    createPaymentReceiveMutate,
    isExcessConfirmed,
    paymentReceivedState,
  } = usePaymentReceiveFormContext();

  const nextPaymentNumber = transactionNumber(
    paymentReceiveNumberPrefix,
    paymentReceiveNextNumber,
  );

  const initialValues: PaymentReceiveFormValues = {
    ...(!isEmpty(paymentReceiveEditPage)
      ? transformToEditForm(
          paymentReceiveEditPage,
          (paymentEntriesEditPage ?? []) as PaymentReceiveEditEntry[],
        )
      : {
          ...defaultPaymentReceive,
          ...(paymentReceiveAutoIncrement && {
            paymentReceiveNo: nextPaymentNumber,
          }),
          depositAccountId: defaultTo(preferredDepositAccount, ''),
          currencyCode: baseCurrency ?? '',
          pdfTemplateId: paymentReceivedState?.defaultTemplateId ?? '',
        }),
  };

  const handleSubmitForm = (
    values: PaymentReceiveFormValues,
    {
      setSubmitting,
      resetForm,
      setFieldError,
    }: FormikHelpers<PaymentReceiveFormValues>,
  ) => {
    setSubmitting(true);
    const exceededAmount = getExceededAmountFromValues(values);

    if (Number(values.amount) <= 0) {
      AppToaster.show({
        message: intl.get('you_cannot_make_payment_with_zero_total_amount'),
        intent: Intent.DANGER,
      });
      setSubmitting(false);
      return;
    }
    if (exceededAmount > 0 && !isExcessConfirmed) {
      setSubmitting(false);
      openDialog('payment-received-excessed-payment');
      return;
    }
    const form = transformFormToRequest(values);

    const onSaved = () => {
      setSubmitting(false);
      AppToaster.show({
        message: intl.get(
          paymentReceiveId
            ? 'the_payment_received_transaction_has_been_edited'
            : 'the_payment_received_transaction_has_been_created',
        ),
        intent: Intent.SUCCESS,
      });

      if (submitPayload.redirect) {
        history.push('/payments-received');
      }
      if (submitPayload.resetForm) {
        resetFormState({ resetForm, initialValues, values });
      }
    };
    const onError = ({
      data: { errors },
    }: {
      data: { errors?: PaymentReceiveErrorResponse[] };
    }) => {
      if (errors) {
        transformErrors(errors, { setFieldError });
      }
      setSubmitting(false);
    };

    if (paymentReceiveId) {
      return editPaymentReceiveMutate([
        paymentReceiveId,
        form as unknown as EditPaymentReceivedBody,
      ])
        .then(onSaved)
        .catch(onError);
    } else {
      return createPaymentReceiveMutate(
        form as unknown as CreatePaymentReceivedBody,
      )
        .then(onSaved)
        .catch(onError);
    }
  };

  return (
    <Formik
      initialValues={initialValues}
      onSubmit={handleSubmitForm}
      validationSchema={
        isNewMode
          ? CreatePaymentReceiveFormSchema
          : EditPaymentReceiveFormSchema
      }
    >
      <Form
        className={css({
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
        })}
      >
        <PageForm flex={1}>
          <PaymentReceiveInnerProvider>
            <PageForm.Body>
              <PaymentReceiveFormTopBar />
              <PaymentReceiveHeader />
              <PaymentReceiveFormBody />
              <PaymentReceiveFormFooter />
            </PageForm.Body>

            <PageForm.Footer>
              <PaymentReceiveFloatingActions />
            </PageForm.Footer>

            {/* ------- Effects ------- */}
            <PaymentReceiveSyncIncrementSettingsToForm />

            {/* ------- Alerts & Dialogs ------- */}
            <PaymentReceiveFormAlerts />
            <PaymentReceiveFormDialogs />
          </PaymentReceiveInnerProvider>
        </PageForm>
      </Form>
    </Formik>
  );
}

export const PaymentReceivedForm = compose(
  withSettings(({ paymentReceiveSettings }) => ({
    paymentReceiveSettings,
    paymentReceiveNextNumber: paymentReceiveSettings?.nextNumber,
    paymentReceiveNumberPrefix: paymentReceiveSettings?.numberPrefix,
    paymentReceiveAutoIncrement: paymentReceiveSettings?.autoIncrement,
    preferredDepositAccount: paymentReceiveSettings?.preferredDepositAccount,
  })),
  withDialogActions,
)(PaymentReceiveFormRoot);
