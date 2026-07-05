import { Intent } from '@blueprintjs/core';
import { css } from '@emotion/css';
import { Formik, Form, FormikHelpers } from 'formik';
import { defaultTo, isEmpty } from 'lodash';
import React from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import {
  CreditNoteExchangeRateSync,
  CreditNoteSyncIncrementSettingsToForm,
} from './components';
import { CreditNoteFloatingActions } from './CreditNoteFloatingActions';
import {
  CreateCreditNoteFormSchema,
  EditCreditNoteFormSchema,
} from './CreditNoteForm.schema';
import { CreditNoteFormDialogs } from './CreditNoteFormDialogs';
import { CreditNoteFormFooter } from './CreditNoteFormFooter';
import { CreditNoteFormHeader } from './CreditNoteFormHeader';
import { useCreditNoteFormContext } from './CreditNoteFormProvider';
import { CreditNoteFormTopbar as CreditNoteFormTopBar } from './CreditNoteFormTopBar';
import { CreditNoteItemsEntriesEditorField } from './CreditNoteItemsEntriesEditorField';
import {
  transformToEditForm,
  transformFormValuesToRequest,
  defaultCreditNote,
  type CreditNoteFormValues,
  type CreditNoteEntry,
} from './utils';
import { AppToaster } from '@/components';
import { PageForm } from '@/components/PageForm';
import { withSettings } from '@/containers/Settings/withSettings';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import {
  compose,
  orderingLinesIndexes,
  transactionNumber,
  safeSumBy,
} from '@/utils';




type CreditNoteFormInnerProps = {
  creditAutoIncrement?: boolean;
  creditNumberPrefix?: string;
  creditNextNumber?: number;
  creditCustomerNotes?: string;
  creditTermsConditions?: string;
};

/**
 * Credit note form.
 */
function CreditNoteFormInner({
  creditAutoIncrement,
  creditNumberPrefix,
  creditNextNumber,
  creditCustomerNotes,
  creditTermsConditions,
}: CreditNoteFormInnerProps) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const history = useHistory();

  // Credit note form context.
  const {
    isNewMode,
    submitPayload,
    creditNote,
    newCreditNote,
    createCreditNoteMutate,
    editCreditNoteMutate,
    creditNoteState,
  } = useCreditNoteFormContext();

  // Credit number.
  const creditNumber = transactionNumber(creditNumberPrefix, creditNextNumber);

  // Initial values.
  const initialValues: CreditNoteFormValues = !isEmpty(creditNote)
    ? transformToEditForm(creditNote)
    : {
        ...defaultCreditNote,
        ...(creditAutoIncrement && {
          creditNoteNumber: creditNumber,
        }),
        entries: orderingLinesIndexes(defaultCreditNote.entries),
        currencyCode: baseCurrency ?? '',
        termsConditions: defaultTo(creditTermsConditions, ''),
        note: defaultTo(creditCustomerNotes, ''),
        pdfTemplateId: creditNoteState?.defaultTemplateId ?? '',
        ...(Array.isArray(newCreditNote) ? {} : newCreditNote),
      };

  // Handles form submit.
  const handleFormSubmit = (
    values: CreditNoteFormValues,
    { setSubmitting, resetForm }: FormikHelpers<CreditNoteFormValues>,
  ) => {
    const entries = values.entries.filter(
      (item: CreditNoteEntry) => item.itemId && item.quantity,
    );
    const totalQuantity = safeSumBy(entries, 'quantity');

    if (totalQuantity === 0) {
      AppToaster.show({
        message: intl.get('quantity_cannot_be_zero_or_empty'),
        intent: Intent.DANGER,
      });
      setSubmitting(false);
      return;
    }
    const form = {
      ...transformFormValuesToRequest(values),
      open: submitPayload?.open ?? false,
    };
    // Handle the request success.
    const onSuccess = () => {
      AppToaster.show({
        message: intl.get(
          isNewMode
            ? 'credit_note.success_message'
            : 'credit_note.edit_success_message',
        ),
        intent: Intent.SUCCESS,
      });
      setSubmitting(false);

      if (submitPayload?.redirect) {
        history.push('/credit-notes');
      }
      if (submitPayload?.resetForm) {
        resetForm();
      }
    };
    // Handle the request error.
    const onError = () => {
      setSubmitting(false);
    };
    if (isNewMode) {
      createCreditNoteMutate(form).then(onSuccess).catch(onError);
    } else if (creditNote) {
      editCreditNoteMutate([creditNote.id, form])
        .then(onSuccess)
        .catch(onError);
    }
  };

  return (
    <Formik<CreditNoteFormValues>
      validationSchema={
        isNewMode ? CreateCreditNoteFormSchema : EditCreditNoteFormSchema
      }
      initialValues={initialValues}
      onSubmit={handleFormSubmit}
    >
      <Form
        className={css({
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
        })}
      >
        <PageForm flex="1">
          <PageForm.Body>
            <CreditNoteFormTopBar />
            <CreditNoteFormHeader />
            <CreditNoteItemsEntriesEditorField />
            <CreditNoteFormFooter />
          </PageForm.Body>

          <PageForm.Footer>
            <CreditNoteFloatingActions />
          </PageForm.Footer>
        </PageForm>

        {/*-------- Dialogs --------*/}
        <CreditNoteFormDialogs />

        {/*-------- Effects --------*/}
        <CreditNoteSyncIncrementSettingsToForm />
        <CreditNoteExchangeRateSync />
      </Form>
    </Formik>
  );
}
export const CreditNoteForm = compose(
  withSettings(({ creditNoteSettings }) => ({
    creditAutoIncrement: creditNoteSettings?.autoIncrement,
    creditNextNumber: creditNoteSettings?.nextNumber,
    creditNumberPrefix: creditNoteSettings?.numberPrefix,
    creditCustomerNotes: creditNoteSettings?.customerNotes,
    creditTermsConditions: creditNoteSettings?.termsConditions,
  })),
)(CreditNoteFormInner);
