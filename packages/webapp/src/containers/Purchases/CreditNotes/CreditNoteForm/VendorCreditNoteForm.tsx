import React from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import { Formik, Form, FormikHelpers } from 'formik';
import { Intent } from '@blueprintjs/core';
import { isEmpty } from 'lodash';
import { css } from '@emotion/css';
import { PageForm } from '@/components/PageForm';
import {
  CreateCreditNoteFormSchema,
  EditCreditNoteFormSchema,
} from './VendorCreditNoteForm.schema';
import { VendorCreditNoteFormHeader } from './VendorCreditNoteFormHeader';
import { VendorCreditNoteItemsEntriesEditor } from './VendorCreditNoteItemsEntriesEditor';
import { VendorCreditNoteFormFooter } from './VendorCreditNoteFormFooter';
import { VendorCreditNoteFloatingActions } from './VendorCreditNoteFloatingActions';
import { VendorCreditNoteFormDialogs } from './VendorCreditNoteFormDialogs';
import { VendorCreditNoteFormTopBar } from './VendorCreditNoteFormTopBar';
import { useVendorCreditNoteFormContext } from './VendorCreditNoteFormProvider';
import { AppToaster, Box } from '@/components';
import { compose, safeSumBy, transactionNumber } from '@/utils';
import {
  defaultVendorCredit,
  filterNonZeroEntries,
  transformToEditForm,
  transformFormValuesToRequest,
  type VendorCreditFormValues,
} from './utils';
import { withSettings } from '@/containers/Settings/withSettings';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';

interface VendorCreditNoteFormInnerProps {
  vendorcreditAutoIncrement?: boolean;
  vendorcreditNumberPrefix?: string;
  vendorcreditNextNumber?: number;
}

/**
 * Vendor Credit note form.
 */
function VendorCreditNoteFormInner({
  vendorcreditAutoIncrement,
  vendorcreditNumberPrefix,
  vendorcreditNextNumber,
}: VendorCreditNoteFormInnerProps) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();

  const history = useHistory();

  // Vendor Credit note form context.
  const {
    isNewMode,
    submitPayload,
    vendorCredit,
    newVendorCredit,
    createVendorCreditMutate,
    editVendorCreditMutate,
  } = useVendorCreditNoteFormContext();

  // Credit number.
  const vendorCreditNumber = transactionNumber(
    vendorcreditNumberPrefix,
    vendorcreditNextNumber,
  );

  // Initial values.
  const initialValues: VendorCreditFormValues = React.useMemo(() => {
    if (!isEmpty(vendorCredit)) {
      return transformToEditForm(vendorCredit);
    }
    return {
      ...defaultVendorCredit,
      ...(vendorcreditAutoIncrement && {
        vendorCreditNumber,
      }),
      currencyCode: baseCurrency ?? '',
      ...(Array.isArray(newVendorCredit) ? {} : newVendorCredit),
    };
  }, [vendorCredit, baseCurrency]);

  // Handles form submit.
  const handleFormSubmit = (
    values: VendorCreditFormValues,
    { setSubmitting, resetForm }: FormikHelpers<VendorCreditFormValues>,
  ) => {
    const entries = filterNonZeroEntries(values.entries);
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
            ? 'vendor_credits.success_message'
            : 'vendor_credits.edit_success_message',
        ),
        intent: Intent.SUCCESS,
      });
      setSubmitting(false);

      if (submitPayload?.redirect) {
        history.push('/vendor-credits');
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
      createVendorCreditMutate(form).then(onSuccess).catch(onError);
    } else if (vendorCredit) {
      editVendorCreditMutate([vendorCredit.id, form])
        .then(onSuccess)
        .catch(onError);
    }
  };

  return (
    <Formik<VendorCreditFormValues>
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
        <PageForm flex={1}>
          <PageForm.Body>
            <VendorCreditNoteFormTopBar />
            <VendorCreditNoteFormHeader />

            <Box p="18px 32px 0">
              <VendorCreditNoteItemsEntriesEditor />
            </Box>

            <VendorCreditNoteFormFooter />
          </PageForm.Body>

          <PageForm.Footer>
            <VendorCreditNoteFloatingActions />
          </PageForm.Footer>

          {/* ---------- Dialogs ---------- */}
          <VendorCreditNoteFormDialogs />
        </PageForm>
      </Form>
    </Formik>
  );
}

export const VendorCreditNoteForm = compose(
  withSettings(({ vendorsCreditNoteSetting }) => ({
    vendorcreditAutoIncrement: vendorsCreditNoteSetting?.autoIncrement,
    vendorcreditNextNumber: vendorsCreditNoteSetting?.nextNumber,
    vendorcreditNumberPrefix: vendorsCreditNoteSetting?.numberPrefix,
  })),
)(VendorCreditNoteFormInner);
